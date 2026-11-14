"""Fictional board-job accounting and activation: real hand-over and SQLite, temporary answer stores and model replies."""
from pathlib import Path
from tempfile import TemporaryDirectory
import threading
import time
import unittest
from unittest import mock

from src import daily_search, geo, run_counts, time_budget
from src.ai import place_triage, slots
from src.sources import aggregators, board_pass, boards_first, feeds, read_budget, waiting_jobs


def board():
    """Three fictional board jobs, two sharing a town."""
    return [{'title': title, 'location': town, 'url': f'https://board.example.test/job/{n}'}
            for n, (title, town) in enumerate([('Known role', 'Known town'), ('Late role 0', 'Late town'), ('Late role 1', 'Late town')])]


class BoardPassAccounting(unittest.TestCase):
    def setUp(self):
        tmp = Path(self.enterContext(TemporaryDirectory()))
        for target, name, value in ((feeds, '_SEARCH', {}), (feeds, 'PLACED', {}), (feeds, 'TRIAGED', {}), (feeds, 'READ', {}),
                                    (geo, 'STORE', tmp / 'geo.json'), (place_triage, 'STORE', tmp / 'places.json')):
            self.enterContext(mock.patch.object(target, name, value))
        self.jobs = board()
        self.track = board_pass.Track()
        self.track.plan = (self.jobs, self.jobs[1:], 100)

    def test_a_repeated_url_is_read_and_counted_once(self):
        feeds.placed().update({'known town': 'in', 'late town': 'out:vague'})
        feeds._triaged().update({'known role': True, 'late role 0': False})
        with mock.patch.object(feeds, 'place_of', wraps=feeds.place_of) as places, mock.patch.object(feeds, 'judged_title', wraps=feeds.judged_title) as titles:
            measured = board_pass.counts(self.jobs + [dict(self.jobs[0])], self.jobs[1:], {self.jobs[0]['url']})
        self.assertEqual((places.call_count, titles.call_count), (3, 3))
        self.assertEqual([measured[key] for key in ('owed', 'listed', 'refused', 'waiting', 'posting not read', 'no answer by the deadline')], [3, 1, 1, 1, 1, 0])
        self.assertEqual((measured['places'], measured['titles'], measured['got']), (1, 3, (0, 2)))
        self.assertEqual(measured['boards']['board.example.test']['titles asked'], 3)

    def test_both_reports_include_a_job_listed_before_the_handover(self):
        feeds.placed().update({'known town': 'in', 'late town': 'in'})
        feeds._triaged().update({feeds.title_key(job['title']): True for job in self.jobs})
        done = board_pass.cut(self.track)
        with mock.patch.object(board_pass, 'counts', wraps=board_pass.counts) as measure:
            settled, lines = done.report({job['url'] for job in self.jobs})
        self.assertEqual(measure.call_count, 1)
        self.assertEqual(set(settled), {job['url'] for job in self.jobs})
        self.assertIn('owed 3 · listed 3 · refused 0 · waiting 0', lines[0])
        self.assertIn('answered 1 of 1 place(s), 3 of 3 title(s) by the deadline, listed 3', lines[1])

    def test_a_vague_place_waits_for_a_posting_even_with_a_yes_title(self):
        job = self.jobs[1]
        self.track.plan = ([job], [job], 100)
        feeds.placed()['late town'] = 'out:vague'
        feeds._triaged()['late role 0'] = True
        done = board_pass.cut(self.track)
        self.assertEqual(done.got, (0, 1))
        self.assertEqual(board_pass.listable(done), [])
        self.assertEqual(board_pass.settled(done, set()), [])
        settled, lines = done.report(set())
        self.assertEqual(settled, [])
        self.assertIn('waiting 1 (posting not read 1 · no answer by the deadline 0)', lines[0])

    def test_outside_is_final_only_when_the_result_has_ended(self):
        job = self.jobs[1]
        self.track.plan = ([job], [job], 100)
        feeds.placed()['late town'] = 'out'
        cut = board_pass.cut(self.track)
        self.assertEqual(board_pass.settled(cut, set()), [])
        ended = board_pass.Done(cut.answered, 100, 1, 1, None, owed=[job], unplaced=[job])
        self.assertEqual(board_pass.settled(ended, set()), [job['url']])
        feeds.placed()['late town'] = 'out:vague'
        feeds._triaged()['late role 0'] = False
        self.assertEqual(board_pass.settled(cut, set()), [job['url']], 'title no is final even at a vague place')

    def test_no_plan_and_empty_or_linkless_input_cannot_invent_work(self):
        self.assertIsNone(board_pass.cut(board_pass.Track()))
        measured = board_pass.counts([{'title': 'Unlinked', 'location': 'Unknown'}])
        self.assertEqual([measured[key] for key in ('owed', 'listed', 'refused', 'waiting', 'places', 'titles')], [0] * 6)
        self.assertEqual(measured['answered'], [])
        self.assertEqual(board_pass.Done([], 0, 0, 0, 'no jobs').report(set()), ([], ['Board pass: not run: no jobs']))

    def test_unanswered_jobs_remain_waiting_and_a_second_read_does_not_mutate_a_snapshot(self):
        first = board_pass.counts(self.jobs, self.jobs[1:])
        self.assertEqual((first['waiting'], first['got']), (3, (0, 0)))
        feeds.placed()['late town'] = 'in'
        feeds._triaged()['late role 0'] = False
        second = board_pass.counts(self.jobs, self.jobs[1:])
        self.assertEqual((second['refused'], second['waiting']), (1, 2))
        self.assertEqual((first['waiting'], first['got']), (3, (0, 0)))

    def test_settlement_and_reports_share_the_full_plan_after_partial_answers(self):
        done = board_pass.cut(self.track)
        self.assertEqual(done.answered, [], 'the result predates every answer')
        listed = {self.jobs[0]['url'], 'https://other.example.test/unrelated'}
        self.assertEqual(board_pass.settled(done, listed), [self.jobs[0]['url']])
        self.assertEqual(board_pass.settled(done, listed), done.report(listed)[0])
        feeds._triaged()['late role 0'] = False
        self.assertEqual(board_pass.settled(done, listed), [self.jobs[0]['url'], self.jobs[1]['url']])
        self.assertEqual(board_pass.settled(done, listed), done.report(listed)[0], 'late refusals also agree')

    def test_place_counts_use_the_answer_stores_normalized_key(self):
        jobs = [{**self.jobs[0], 'location': where, 'url': f'https://board.example.test/variant/{n}'}
                for n, where in enumerate(('Known Town', 'known town', '  KNOWN   TOWN  ', '   '))]
        feeds.placed()[place_triage.norm('Known Town')] = 'in'
        measured = board_pass.counts(jobs, jobs)
        self.assertEqual((measured['places'], measured['got'][0]), (1, 1), 'one stored place answer, not three spellings or an empty key')

    def test_title_totals_use_the_same_key_as_the_title_answer_store(self):
        jobs = [{**self.jobs[0], 'title': title, 'url': f'https://board.example.test/title/{n}'}
                for n, title in enumerate(('Known Role', 'known role', '  KNOWN   ROLE  '))]
        feeds._triaged()[feeds.title_key('Known Role')] = True
        measured = board_pass.counts(jobs)
        self.assertEqual((measured['titles'], measured['got'][1]), (1, 1), 'one title answer covers all three spellings')

    def test_a_role_word_without_an_ai_answer_is_still_owed(self):
        feeds.placed()['known town'] = 'in'
        feeds._triaged()[feeds.ASKED] = False
        with mock.patch.object(feeds, 'TITLES', feeds.keyword_regex(['known role'])), \
                mock.patch.object(feeds, 'EXCLUDED_TITLES', feeds.keyword_regex(['never-match'])):
            self.assertTrue(feeds.wanted_title('Known role'), 'the no-answer word floor is the positive control')
            self.assertEqual(board_pass.owed(self.jobs[:1]), self.jobs[:1])


class Activation(unittest.TestCase):
    def setUp(self):
        from tests.unit.sources import test_board_handover
        test_board_handover.HandOver.setUp(self)
        self.db.execute('DELETE FROM waiting_jobs')
        self.enterContext(mock.patch.object(time_budget, '_paces', return_value={'place_rounds': 8.0, 'title_rounds': 7.0}))

    def rows(self):
        return {row[0] for row in self.db.execute('SELECT url FROM waiting_jobs')}

    def at(self, second):
        time_budget.start(180, now=time.monotonic() - second)

    def lane_with(self, read):
        with mock.patch.object(boards_first.Beside, '_known', read):
            lane = boards_first.Beside({})
        def finish():
            lane.now.set()
            lane.woken.set()
            for thread in lane.threads:
                thread.join(timeout=10)
        self.addCleanup(finish)
        return lane

    def hand_over(self, lane):
        from types import SimpleNamespace
        so_far = SimpleNamespace(listener=lambda name: self.shown.extend, flush=lambda: None)
        with mock.patch.object(feeds, 'database', return_value=self.db):
            daily_search.keep_late_boards(lane, so_far, wait=True)

    def test_a_board_job_read_before_the_pass_is_placed_and_judged_in_the_search(self):
        # Why (14 Nov 2026, valid controls): b01 owed 53 jobs / 49 titles / 28 places; c15 had a 13.5 s title call.
        self.jobs = [dict(self.jobs[0], title=f'Known role {n % 49}', location=f'Fictional town {n % 28}',
                          url=f'https://board.example.test/{n}') for n in range(53)]
        self.enterContext(mock.patch.object(time_budget, '_paces', return_value={'place_rounds': 10.0, 'title_rounds': 1.38, 'place_vague': 4.06}))
        self.model.thinks_first = lambda: True
        original, finished, now = self.model.messages.create, {}, [1000.0]
        def answer(**kwargs):
            kind = 'titles' if 'The titles:' in kwargs['messages'][0]['content'] else 'places'
            # Why (14 Nov 2026): the recorded place-round pace includes its visa check; charge it once.
            system = kwargs['system'][0]['text']
            seconds = 13.5 if kind == 'titles' else 4.06 if system == place_triage.VAGUE_SYSTEM else 0 if system == place_triage.VISA_SYSTEM else 10.0
            finished[kind] = finished.get(kind, 0) + seconds
            if time_budget.now() + finished[kind] >= read_budget.run_end():
                raise TimeoutError('fictional full batch misses the last judging moment')
            return original(**kwargs)
        def cold_map(*args, **kwargs):
            finished['places'] = 10.0  # the map has no pace of its own; the estimator uses the existing place-round pace
            return {}
        self.enterContext(mock.patch.object(geo, 'verdicts', cold_map))
        self.enterContext(mock.patch.object(self.model.messages, 'create', answer))
        with mock.patch.object(time, 'monotonic', lambda: now[0]):
            time_budget.start(135, now=1000)
            lane = self.lane_with(lambda lane, wait: lane._put(self.jobs + self.jobs[:1]))
            self.assertTrue(lane.done.wait(timeout=10))
            lane.deliver(self.db, self.shown.extend)
            self.assertEqual((len(self.shown), len(self.rows())), (0, 53))
            now[0] = read_budget.pass_at()
            lane.woken.set()
            self.assertTrue(lane.passed.wait(timeout=10), 'the pass finishes while scoring holds the cache owner')
            self.hand_over(lane)
            self.assertEqual((len(self.shown), len(self.rows())), (53, 0))
            self.assertEqual(set(finished), {'places', 'titles'})
            self.assertLess(now[0] + max(finished.values()), read_budget.run_end(), 'both full rounds end before the last AI moment')
            now[0] = 1140
            lane._queue(self.jobs)
            self.hand_over(lane)
            self.assertEqual(len(self.shown), 53)

    def test_d03_refreshed_paces_finish_the_26_second_title_round_before_the_deadline(self):
        # Why (#4416, valid d03 control 20261114T230103): frozen 99 s start, title round ends 125 s, 40 of 81 jobs unanswered.
        jobs = [dict(self.jobs[0], title=f'Known role {n % 80}', location='Late town',
                     url=f'https://board.example.test/d03/{n}') for n in range(81)]
        now, paces, finished = [1000.0], {'place_rounds': 10.0, 'title_rounds': 1.38, 'place_vague': 4.06}, {}
        original = self.model.messages.create
        self.model.thinks_first = lambda: True
        def answer(**kwargs):
            kind = 'titles' if 'The titles:' in kwargs['messages'][0]['content'] else 'places'
            # The observed whole title round includes its queue wait; places finished four seconds after the pass began.
            finished[kind] = now[0] + (26 if kind == 'titles' else 4)
            if finished[kind] >= read_budget.run_end():
                raise TimeoutError('fictional d03 title round misses the search deadline')
            return original(**kwargs)
        with mock.patch.object(time, 'monotonic', lambda: now[0]), \
                mock.patch.object(time_budget, '_paces', return_value=paces), mock.patch('threading.Thread.start'):
            time_budget.start(135, now=1000)
            lane = boards_first.Beside({})
        with mock.patch.object(time, 'monotonic', lambda: now[0]), mock.patch.object(time_budget, '_paces', return_value=paces), \
                mock.patch.object(self.model.messages, 'create', answer):
            self.assertAlmostEqual(read_budget.pass_at(), 1098.69)  # an estimate, never publication by construction or a gate
            lane._put(jobs)
            lane.done.set()
            now[0] = 1096  # the run's vague-place measurement became available at 96 s
            paces.update(place_vague=9.79, title_rounds=3.85)
            def wait(left):
                now[0] += left
            with mock.patch.object(lane.woken, 'wait', wait):
                lane._pass()
            lane.last_pass(self.db, self.shown.extend)
            self.assertEqual((len(self.shown), len(self.rows())), (81, 0))
            self.assertEqual(finished['titles'], 1122)
            self.assertLess(finished['titles'], read_budget.run_end())
            self.assertTrue(any('no answer by the deadline 0' in line for line in self.lines))

    def test_a_board_read_after_the_pass_waits_and_the_queue_lists_its_jobs(self):
        from datetime import datetime, timezone
        release = threading.Event()
        self.addCleanup(release.set)
        def read(lane, wait):
            release.wait(timeout=10)
            lane._put(self.jobs[1:])
        lane = self.lane_with(read)
        self.at(150)
        lane.woken.set()
        self.assertTrue(lane.passed.wait(timeout=10))
        release.set()
        self.assertTrue(lane.done.wait(timeout=10))
        self.hand_over(lane)
        self.assertEqual((len(self.shown), len(self.rows())), (0, 2))
        time_budget.start(0)
        run_counts.reset()
        _, items = waiting_jobs.judge(self.db, {}, datetime(2026, 11, 14, tzinfo=timezone.utc), out=lambda line: None)
        self.assertEqual({item['url'] for item in items}, {job['url'] for job in self.jobs[1:]})

    def test_a_pass_failing_before_its_plan_reports_the_error_not_never_started(self):
        lane = self.lane
        lane.now.set()
        with mock.patch.object(board_pass, 'judge', side_effect=RuntimeError('fictional pre-plan failure')):
            lane._pass()
        lane.last_pass(self.db, self.shown.extend)
        self.assertTrue(any('board pass failed: RuntimeError' in line for line in self.lines))
        self.assertFalse(any('had not begun' in line for line in self.lines))

    def test_a_delayed_worker_includes_every_page_received_before_publication(self):
        ready, page, worker = threading.Event(), threading.Event(), threading.Event()
        late = dict(self.jobs[1], title='Late role 2', url='https://board.example.test/late')
        def read(lane, wait):
            lane._put(self.jobs)
            ready.set()
            page.wait(timeout=10)
            lane._put([late])
        original = boards_first.Beside._pass
        def delayed(lane):
            worker.wait(timeout=10)
            original(lane)
        with mock.patch.object(boards_first.Beside, '_pass', delayed):
            lane = self.lane_with(read)
        try:
            self.assertTrue(ready.wait(timeout=10))
            self.at(151)
            page.set()
            self.assertTrue(lane.done.wait(timeout=10))
            worker.set()
            self.assertTrue(lane.passed.wait(timeout=10))
            self.hand_over(lane)
            self.assertEqual({job['url'] for job in self.shown}, {job['url'] for job in self.jobs} | {late['url']})
            self.assertEqual(self.rows(), set())
        finally:
            page.set()
            worker.set()

    def test_an_unanswered_automatic_pass_leaves_its_rows_waiting_at_the_search_end(self):
        begun, release = threading.Event(), threading.Event()
        def hung(read, track):
            track.plan = (read, read[1:], 150)
            begun.set()
            release.wait(timeout=10)
        with mock.patch.object(board_pass, 'judge', hung):
            lane = self.lane_with(lambda lane, wait: lane._put(self.jobs))
            self.assertTrue(lane.done.wait(timeout=10))
            self.at(150)
            lane.woken.set()
            try:
                self.assertTrue(begun.wait(timeout=10))
                self.at(180)
                self.hand_over(lane)
                self.assertEqual((len(self.shown), len(self.rows())), (0, 3))
            finally:
                release.set()
                self.assertTrue(lane.passed.wait(timeout=10))

    def test_a_pass_failing_before_track_creation_does_not_report_never_started(self):
        with mock.patch.object(read_budget, 'pass_at', side_effect=ValueError('fictional pass clock failure')):
            self.lane._pass()
        self.lane.last_pass(self.db, self.shown.extend)
        self.assertTrue(any('board pass failed: ValueError' in line for line in self.lines))
        self.assertFalse(any('had not begun' in line for line in self.lines))

    def test_only_the_worker_publishes_after_construction_using_the_latest_paces(self):
        now, paces = [1000.0], {'place_rounds': 8, 'place_vague': 4, 'title_rounds': 1}
        time_budget.start(180, now=1000)
        with mock.patch.object(time_budget, 'now', lambda: now[0]), \
                mock.patch.object(time_budget, '_paces', return_value=paces), \
                mock.patch('threading.Thread.start'), mock.patch.object(read_budget, 'pass_at', wraps=read_budget.pass_at) as cutoff:
            lane = boards_first.Beside({})
            cutoff.assert_not_called()
            paces['place_rounds'] = 20
            now[0] = 1130
            with slots.in_lane(1165):
                self.assertFalse(read_budget.past_cut(), 'before publication the gate admits every page')
            lane._put(self.jobs)
            self.assertEqual(lane.read, self.jobs)
            def judged(read, track):
                self.assertEqual(read, self.jobs)
                self.assertEqual(read_budget.pass_at(), 1125, 'the worker used the slower pace measured after construction')
                paces['place_rounds'] = 12.5
                with slots.in_lane(1165):
                    self.assertTrue(read_budget.past_cut(), 'the gate keeps the worker cutoff after new pace measurements')
                return board_pass.Done([], 125, 0, 0, 'fictional completed pass')
            with mock.patch.object(board_pass, 'judge', judged):
                lane._pass()
            self.assertEqual(read_budget.pass_at(), 1125)

    def test_a_late_role_word_match_starts_no_ai_and_is_only_kept_waiting(self):
        self.lane.now.set()
        self.lane._pass()
        self.shown.clear()
        late = dict(self.jobs[0], url='https://board.example.test/late-word-match')
        feeds._triaged().clear()
        feeds._triaged()[feeds.ASKED] = False
        with mock.patch.object(feeds, 'TITLES', feeds.keyword_regex(['known role'])), \
                mock.patch.object(feeds, 'EXCLUDED_TITLES', feeds.keyword_regex(['never-match'])), \
                mock.patch.object(feeds, 'triage') as triage, \
                mock.patch.object(self.model.messages, 'create', wraps=self.model.messages.create) as ai, \
                mock.patch.object(aggregators, 'kept', wraps=aggregators.kept) as kept, \
                mock.patch.object(time_budget, 'now', return_value=read_budget.pass_at() + 1):
            self.assertTrue(feeds.wanted_title(late['title']), 'role words would otherwise list this unanswered job')
            self.lane._put([late])
            self.lane.deliver(self.db, self.shown.extend)
            triage.assert_not_called()
            ai.assert_not_called()
            kept.assert_not_called()
        self.lane.last_pass(self.db, self.shown.extend)
        self.assertNotIn(late['url'], {job['url'] for job in self.shown})
        self.assertIn(late['url'], self.rows())
        self.assertNotIn(late, self.lane.read)

    def test_crossing_the_cut_between_clock_reads_still_publishes_it_before_judging(self):
        paces, now = {'place_rounds': 20, 'place_vague': 4, 'title_rounds': 1}, iter((1124.9, 1125))
        time_budget.start(180, now=1000)
        def answered(*args):
            paces['place_rounds'] = 12.5
            return board_pass.Done([], 125, 0, 0, 'fictional completed pass')
        with mock.patch.object(time_budget, '_paces', return_value=paces), \
                mock.patch.object(time_budget, 'now', lambda: next(now, 1125)), mock.patch.object(board_pass, 'judge', answered):
            self.lane._pass()
            with slots.in_lane(1165):
                self.assertTrue(read_budget.past_cut(now=1130), 'judging must publish its cut before changing paces')
            time_budget.start(180, now=1000)
            self.assertEqual(read_budget.pass_at(), 1135, 'a fresh clock may use the faster pace')
