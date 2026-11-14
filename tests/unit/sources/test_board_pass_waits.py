"""Standalone judging rounds use the search clock and fictional model responses; production search startup is not enabled here."""
import threading
import time
import unittest
from unittest import mock

from src import geo, run_counts, time_budget
from src.ai import engine, title_triage
from src.sources import board_pass, feed_places, feeds
from tests.unit.ai.test_titles_with_places import Model
from tests.unit.sources import test_board_pass as fixtures


class JudgingRounds(unittest.TestCase):
    def setUp(self):
        fixtures.BoardPassAccounting.setUp(self)
        self.model, self.lines = Model(), []
        self.model.gate.set()
        for target, name, value in ((engine, 'ready', lambda: True), (engine, 'client', lambda **kwargs: self.model),
                                    (engine, 'PARALLEL', 4), (title_triage, 'STORE', geo.STORE.parent / 'titles.json'),
                                    (geo, 'verdicts', lambda *args, **kwargs: {})):
            self.enterContext(mock.patch.object(target, name, value))
        self.enterContext(mock.patch('builtins.print', lambda *args, **kwargs: self.lines.append(' '.join(map(str, args)))))
        feeds.placed()['known town'] = 'in'
        feeds._triaged()[feeds.ASKED] = True
        run_counts.reset()
        self.addCleanup(run_counts.reset)
        self.addCleanup(time_budget.start, 0)

    def test_owed_jobs_are_placed_and_title_judged_with_the_real_round_interfaces(self):
        time_budget.start(180, now=time.monotonic() - 100)
        done = board_pass.judge(self.jobs + [dict(self.jobs[1])])
        self.assertEqual((done.places, done.titles, len(done.answered)), (1, 3, 3))
        self.assertIsNone(done.got)
        self.assertIn('place answered', self.model.log)
        self.assertEqual(len([entry for entry in self.model.log if entry.startswith('titles ')]), 3)
        self.assertEqual(set(board_pass.settled(done, {job['url'] for job in self.jobs})), {job['url'] for job in self.jobs})
        self.assertTrue(any('places asked 2 · inside 2' in line for line in self.lines))

    def test_title_answers_arrive_while_the_place_round_is_held(self):
        time_budget.start(180, now=time.monotonic() - 100)
        self.model.gate.clear()
        answered = threading.Event()
        original = board_pass._titles
        def titles(jobs):
            original(jobs)
            answered.set()
        with mock.patch.object(board_pass, '_titles', titles):
            judging = threading.Thread(target=lambda: board_pass.judge(self.jobs), daemon=True)
            judging.start()
            try:
                self.assertTrue(answered.wait(timeout=30))
                self.assertNotIn('place answered', self.model.log)
            finally:
                self.model.gate.set()
                judging.join(timeout=30)
                self.assertFalse(judging.is_alive())

    def test_each_round_join_ends_on_the_search_clock_when_its_call_never_returns(self):
        for target, name in ((board_pass, '_titles'), (feed_places, 'place_jobs')):
            with self.subTest(round=name):
                time_budget.start(180, now=time.monotonic() - 164.9)
                held, workers, result = threading.Event(), [], []
                def hung(*args, **kwargs):
                    workers.append(threading.current_thread())
                    held.wait(timeout=30)
                with mock.patch.object(target, name, hung):
                    judging = threading.Thread(target=lambda: result.append(board_pass.judge(self.jobs)), daemon=True)
                    judging.start()
                    try:
                        judging.join(timeout=10)
                        self.assertFalse(judging.is_alive(), 'the existing clock bounds either held round')
                        self.assertIsNotNone(result[0].got)
                        self.assertTrue(any('board.example.test places asked' in line for line in self.lines))
                    finally:
                        held.set()
                        judging.join(timeout=30)
                        for worker in workers:
                            worker.join(timeout=30)

    def test_a_worker_finishing_after_the_snapshot_cannot_label_partial_answers_complete(self):
        time_budget.start(180, now=time.monotonic() - 164.9)
        held, workers, reads = threading.Event(), [], []
        measure = board_pass.counts
        def titles(jobs):
            workers.append(threading.current_thread())
            held.wait(timeout=30)
        def snapshot(*args, **kwargs):
            result = measure(*args, **kwargs)
            reads.append(result)
            if len(reads) == 2:
                held.set()
                workers[0].join(timeout=30)
            return result
        with mock.patch.object(board_pass, '_titles', titles), mock.patch.object(board_pass, 'counts', side_effect=snapshot):
            try:
                done = board_pass.judge(self.jobs)
                self.assertIsNotNone(done.got, 'the result remains partial even though its worker has now ended')
            finally:
                held.set()
                for worker in workers:
                    worker.join(timeout=30)

    def test_untimed_and_expired_calls_start_no_rounds(self):
        time_budget.start(180, now=time.monotonic() - 100)
        self.assertIn('no board job', board_pass.judge([]).why)
        for seconds in (0, 170):
            with self.subTest(seconds=seconds):
                time_budget.start(180 if seconds else 0, now=time.monotonic() - seconds)
                done = board_pass.judge(self.jobs)
                self.assertTrue(done.why)
                self.assertEqual(self.model.log, [])

    def test_a_known_title_refusal_is_not_owed_even_with_an_unknown_place(self):
        feeds._triaged()['late role 0'] = False
        self.assertEqual([job['url'] for job in board_pass.owed(self.jobs)], [self.jobs[0]['url'], self.jobs[2]['url']])
