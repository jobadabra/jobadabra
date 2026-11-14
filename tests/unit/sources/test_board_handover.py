"""Direct hand-over calls preserve waiting rows, recover published answers, and obey the shared search clock."""
import sqlite3
import threading
import time
import unittest
from unittest import mock

from src import time_budget
from src.sources import aggregators, board_pass, boards_first, feeds, waiting_jobs
from tests.unit.sources import test_board_pass_waits as fixtures


class HandOver(unittest.TestCase):
    def setUp(self):
        fixtures.JudgingRounds.setUp(self)
        self.db = sqlite3.connect(':memory:', check_same_thread=False)
        self.addCleanup(self.db.close)
        self.db.execute('CREATE TABLE feed_jobs (board TEXT, id TEXT, fingerprint TEXT, first_seen TEXT, last_seen TEXT, PRIMARY KEY(board,id))')
        for n, job in enumerate(self.jobs):
            job.update(id=str(n), company='Fictional employer', date_posted='', description='', remote=False, salary='')
        for name in ('fill_missing', 'note'):
            self.enterContext(mock.patch.object(aggregators.board_employers, name))
        self.enterContext(mock.patch('src.run_details.failed'))
        self.enterContext(mock.patch.object(feeds, 'triage'))
        time_budget.start(180, now=time.monotonic() - 100)
        with mock.patch.object(boards_first.Beside, '_known', lambda lane, wait: lane._put(self.jobs)), \
                mock.patch('src.sources.read_budget.run_end', return_value=None):
            self.lane = boards_first.Beside({})
            self.assertTrue(self.lane.done.wait(timeout=10))
        self.shown = []
        self.lane.deliver(self.db, self.shown.extend)
        self.assertEqual(self.rows(), {job['url'] for job in self.jobs})

    def rows(self):
        return {row[0] for row in self.db.execute('SELECT url FROM waiting_jobs')}

    def answer(self):
        feeds.placed()['late town'] = 'in'
        feeds._triaged().update({feeds.title_key(job['title']): True for job in self.jobs})

    def test_direct_handover_settles_once(self):
        self.assertIsNone(self.lane.track)
        self.lane.now.set()
        self.lane._pass()
        self.lane.last_pass(self.db, self.shown.extend)
        self.lane._queue(self.jobs + self.jobs)
        self.lane.deliver(self.db, self.shown.extend)
        self.assertEqual(len(self.shown), 3)
        self.assertEqual(self.rows(), set())

    def test_every_judge_exit_without_done_recovers_its_published_answers(self):
        for outcome, reason in ((RuntimeError(), 'RuntimeError'), (SystemExit(), 'SystemExit'), (None, 'no result')):
            with self.subTest(reason=reason):
                def broken(read, track):
                    track.plan = (read, read[1:], int(time_budget.now() - time_budget.BEGAN))
                    self.answer()
                    if outcome is not None:
                        raise outcome
                self.lane.now.set()
                self.lane.done_pass = None
                with mock.patch.object(board_pass, 'judge', broken):
                    if isinstance(outcome, SystemExit):
                        with self.assertRaises(SystemExit):
                            self.lane._pass()
                    else:
                        self.lane._pass()
                self.assertTrue(self.lane.passed.is_set())
                self.lane.last_pass(self.db, self.shown.extend)
                self.assertEqual(len(self.shown), 3)
                self.assertEqual(self.rows(), set())
                self.assertEqual([line for line in self.lines if 'board pass failed' in line][-1], 'Warning: the board pass failed: ' + reason)

    def test_unanswered_title_or_place_is_never_settled_and_stays_in_the_database(self):
        feeds._triaged()['late role 0'] = True  # its place is unanswered; Known role has a place but no title answer
        self.lane.track = self.track
        self.lane.done_pass = board_pass.cut(self.track)
        self.lane.passed.set()
        with mock.patch.object(waiting_jobs, 'listed', wraps=waiting_jobs.listed) as listed:
            self.lane.last_pass(self.db, self.shown.extend)
        self.assertEqual(listed.call_args.args[1], [])
        self.assertEqual(self.rows(), {job['url'] for job in self.jobs})

    def test_a_database_error_during_settlement_rolls_back_every_waiting_row(self):
        self.answer()
        self.lane.track = self.track
        self.lane.done_pass = board_pass.cut(self.track)
        self.lane.passed.set()
        self.db.execute("CREATE TRIGGER fail_delete BEFORE DELETE ON waiting_jobs WHEN old.url LIKE '%/2' BEGIN SELECT RAISE(ABORT, 'fictional delete failure'); END")
        self.lane.last_pass(self.db, self.shown.extend)
        self.assertEqual(len(self.shown), 3)
        self.assertEqual(self.rows(), {job['url'] for job in self.jobs})
        self.assertTrue(any('still wait for the queue' in line for line in self.lines))

    def test_a_group_landing_during_the_pass_wait_is_not_listed_twice(self):
        self.answer()
        self.lane.track = self.track
        self.lane.done_pass = board_pass.cut(self.track)
        def land(timeout):
            self.lane._queue(self.jobs)
        with mock.patch.object(self.lane.passed, 'wait', side_effect=land):
            self.lane.last_pass(self.db, self.shown.extend)
        self.assertEqual(len(self.shown), 3)
        self.assertTrue(any('owed 3 · listed 3' in line for line in self.lines))
        self.assertTrue(any('by the deadline, listed 3' in line for line in self.lines))

    def test_a_hung_judge_cannot_hold_the_hand_over_past_the_search_clock(self):
        held, begun = threading.Event(), threading.Event()
        def hung(read, track):
            track.plan = (read, read[1:], int(time_budget.now() - time_budget.BEGAN))
            begun.set()
            held.wait(timeout=30)
        self.lane.now.set()
        with mock.patch.object(board_pass, 'judge', hung):
            worker = threading.Thread(target=self.lane._pass, daemon=True)
            worker.start()
            self.assertTrue(begun.wait(timeout=10))
            time_budget.start(0.1)
            hand = threading.Thread(target=self.lane.last_pass, args=(self.db, self.shown.extend), daemon=True)
            hand.start()
            try:
                hand.join(timeout=10)
                self.assertFalse(hand.is_alive())
                self.assertFalse(self.lane.passed.is_set())
                self.assertEqual(len(self.rows()), 3)
            finally:
                held.set()
                worker.join(timeout=10)
                hand.join(timeout=10)

    def test_reader_and_pass_start_waits_share_the_search_deadline(self):
        for seconds, finished in ((0.1, False), (0.1, True), (0, False)):
            with self.subTest(seconds=seconds, pass_finished=finished):
                held, begun = threading.Event(), threading.Event()
                def read(lane, wait):
                    begun.set()
                    held.wait(timeout=30)
                time_budget.start(seconds)
                with mock.patch.object(boards_first.Beside, '_known', read), \
                        mock.patch('src.sources.read_budget.run_end', return_value=None):
                    lane = boards_first.Beside({})
                self.assertTrue(begun.wait(timeout=10))
                hand = threading.Thread(target=lane.last_pass, args=(self.db, self.shown.extend), daemon=True)
                worker = threading.Thread(target=lane._pass, daemon=True)
                if finished:
                    lane.passed.set()  # the remaining read-tail wait must also end on the clock
                worker.start()
                hand.start()
                try:
                    hand.join(timeout=10)
                    worker.join(timeout=10)
                    self.assertFalse(hand.is_alive())
                    self.assertFalse(worker.is_alive())
                    self.assertFalse(lane.done.is_set())
                finally:
                    held.set()
                    for thread in lane.threads:
                        thread.join(timeout=10)

    def test_an_untimed_pass_never_calls_the_judge_or_settles_rows(self):
        time_budget.start(0)
        with mock.patch.object(board_pass, 'judge', wraps=board_pass.judge) as judge:
            self.lane._pass()
        self.assertFalse(judge.called)
        self.lane.last_pass(self.db, self.shown.extend)
        self.assertEqual(len(self.rows()), 3)
        self.assertIn('Board pass: not run: the search has no time budget', self.lines)

    def test_a_completion_wait_reserves_the_existing_search_tail(self):
        from src.sources import read_budget
        now = time_budget.now()
        with mock.patch.object(time_budget, 'now', return_value=now), mock.patch.object(self.lane.passed, 'wait') as wait:
            self.lane.last_pass(self.db, self.shown.extend)
        self.assertEqual(wait.call_args.args[0], max(0, read_budget.run_end() - now))

    def test_delivery_drops_linkless_jobs_and_retries_only_unlisted_urls(self):
        self.answer()
        group = [dict(self.jobs[0], url=None), self.jobs[0], dict(self.jobs[0]), dict(self.jobs[0], url='')]
        self.lane._queue(group)
        with mock.patch.object(aggregators, 'kept', wraps=aggregators.kept) as keep:
            self.lane.deliver(self.db, self.shown.extend)
        self.assertEqual(keep.call_args.args[2], [self.jobs[0]])
        self.lane._queue(self.jobs)
        self.lane.deliver(self.db, self.shown.extend)
        self.assertEqual(len(self.shown), 3, 'previously unanswered URLs can now be listed; a listed URL is not listed twice')

    def test_an_untimed_handover_does_not_settle_a_previous_result(self):
        self.answer()
        self.lane.done_pass = board_pass.cut(self.track)
        time_budget.start(0)
        self.lane.last_pass(self.db, self.shown.extend)
        self.assertEqual(len(self.rows()), 3)
        self.assertIn('Board pass: not run: the search has no time budget', self.lines)
