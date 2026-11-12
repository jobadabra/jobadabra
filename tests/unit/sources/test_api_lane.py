"""The free job APIs' lane (src/sources/api_lane.py, lanes 3/5, #3754): every due API is asked at once from the press's start, a read still
running at the cut is left for the next search, a read that raises is that source failing, and the stage takes the lane's reads instead of
asking again. Tests: this file, tests/unit/press/test_lanes.py (the whole search)."""
import os
import sqlite3
import threading
import time
import unittest
from unittest import mock

from src.press import stage
from src.sources import aggregators, api_lane, boards_ahead, careers

_READER = careers.READER


def setUpModule():   # no page read reaches a real model from this file (tests/unit/sources/test_found_boards_ai.py)
    careers.READER = None


def tearDownModule():
    careers.READER = _READER

JOB = {'company': 'A', 'id': '1', 'title': 'Engineer', 'url': 'https://x/1', 'date_posted': '', 'description': '', 'location': 'Town',
       'remote': False, 'salary': ''}
SEARCH = {'role_keywords': ['x']}


class LaneTest(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:', check_same_thread=False)
        env = mock.patch.dict(os.environ)
        env.start()
        self.addCleanup(env.stop)
        os.environ.pop('JOBADABRA_FIXTURE_DIR', None)

    def start(self, readers, lately=()):
        with mock.patch.object(aggregators, 'read_lately', lambda db, name, now=None, search=None: 'at' if name in lately else None):
            lane = api_lane.start(self.db, SEARCH, readers=readers)
        if lane is not None:
            self.addCleanup(lane.close)
        return lane

    def test_every_due_api_reads_at_once_and_only_the_lanes_own(self):
        both, names = threading.Barrier(2, timeout=5), []

        def read(search):   # each read waits for the other: they pass only if both run at the same time
            names.append(threading.current_thread().name)
            both.wait()
            return [JOB]

        def never(search):
            raise AssertionError('not this lane\'s to read')

        lane = self.start([('A', read), ('EURES', never), (boards_ahead.NAME, never), ('Lately', never), ('B', read)], lately=('Lately',))
        self.assertEqual(sorted(lane.reads), ['A', 'B'])
        self.assertEqual(lane.take('A', None)[0], [JOB])
        self.assertEqual(lane.take('B', None)[0], [JOB])
        self.assertTrue(all(name.startswith('free-api') for name in names), names)

    def test_a_read_still_running_at_the_cut_is_none_and_its_jobs_come_once_it_ends(self):
        go = threading.Event()
        lane = self.start([('Slow', lambda search: go.wait(5) and [JOB])])
        self.assertIsNone(lane.take('Slow', time.monotonic() + 0.05))
        go.set()
        self.assertEqual(lane.take('Slow', None)[0], [JOB])

    def test_a_read_that_raises_raises_at_take(self):
        def broken(search):
            raise RuntimeError('boom')
        lane = self.start([('Broken', broken)])
        with self.assertRaises(RuntimeError):
            lane.take('Broken', None)

    def test_nothing_due_and_the_fixture_mode_start_nothing(self):
        self.assertIsNone(self.start([('Lately', lambda search: [JOB])], lately=('Lately',)))
        os.environ['JOBADABRA_FIXTURE_DIR'] = 'x'
        self.assertIsNone(api_lane.start(self.db, SEARCH))


class ScanTakesTheLaneTest(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:', check_same_thread=False)
        for patch in (mock.patch.object(aggregators, 'kept', lambda db, name, found, now=None, shown=None, owed=None: [dict(j, source=name) for j in found]),
                      mock.patch.dict(os.environ)):
            patch.start()
            self.addCleanup(patch.stop)
        os.environ.pop('JOBADABRA_FIXTURE_DIR', None)

    def test_the_stage_takes_the_lanes_reads_never_asks_again_and_says_one_state(self):
        def asked_again(search):
            raise AssertionError('asked again')
        lane = api_lane.start(self.db, SEARCH, readers=[('A', lambda search: [JOB])])
        self.addCleanup(lane.close)
        report = aggregators.scan(self.db, SEARCH, readers=[('A', asked_again)], lane=lane)
        self.assertEqual([j['id'] for j in report['jobs']], ['1'])
        self.assertEqual(report['said'], stage.Result(stage.DONE))

    def test_one_api_that_raises_any_error_fails_alone_and_the_next_still_reads(self):
        def broken(search):
            raise RuntimeError('boom')
        report = aggregators.scan(self.db, SEARCH, readers=[('Broken', broken), ('A', lambda search: [JOB])])
        self.assertEqual([j['id'] for j in report['jobs']], ['1'], 'the next API still reads')
        self.assertEqual({s['company']: s['ok'] for s in report['sources']}, {'Broken': False, 'A': True})

    # The cut and a lane read that raises, both through scan, and the lane's one state when they mix (#3802).
    def lane_scan(self, reads, cut_in=None):
        """scan over a lane started with `reads` ([(name, read)]); the read cut `cut_in` seconds from now (None: no budget)."""
        def asked_again(search):
            raise AssertionError('asked again')
        lane = api_lane.start(self.db, SEARCH, readers=reads)
        self.addCleanup(lane.close)
        cut = None if cut_in is None else time.monotonic() + cut_in
        with mock.patch('src.sources.read_budget.cut_at', lambda: cut), mock.patch('src.sources.read_budget.past_cut', lambda now=None: False):
            return aggregators.scan(self.db, SEARCH, readers=[(name, asked_again) for name, _ in reads], lane=lane)

    def test_a_lane_read_still_running_at_the_cut_waits_for_the_next_search_unmarked(self):
        go = threading.Event()
        self.addCleanup(go.set)
        report = self.lane_scan([('Slow', lambda search: go.wait(5) and [JOB]), ('A', lambda search: [JOB])], cut_in=0.2)
        self.assertEqual([s['company'] for s in report['sources']], ['A'], 'the slow one is not listed as read')
        self.assertIsNone(aggregators.read_lately(self.db, 'Slow', search=SEARCH), 'not marked read: the next search asks it')
        self.assertEqual(report['said'], stage.Result(stage.CUT, '1 wait for the next search'))

    def test_a_lane_read_that_ends_after_the_cut_is_kept_by_the_late_hand_over_once(self):
        """WP8 rule 6 (#3754, wj): a read the scan left at the cut (its jobs judged in its own thread, p10's press 2: 600 titles done at 165 s of 180) was dropped with the
        lane; its jobs now land in the list when it ends and its source is marked read then, once."""
        go, shown = threading.Event(), []
        self.addCleanup(go.set)
        lane = api_lane.start(self.db, SEARCH, readers=[('Slow', lambda search: go.wait(5) and [JOB])])
        self.addCleanup(lane.close)
        cut = time.monotonic() + 0.1
        with mock.patch('src.sources.read_budget.cut_at', lambda: cut), mock.patch('src.sources.read_budget.past_cut', lambda now=None: False):
            report = aggregators.scan(self.db, SEARCH, readers=[('Slow', None)], lane=lane)
        self.assertEqual(report['jobs'], [], 'positive control: the scan left it at the cut')
        lane.close()   # the gather closes the lane before the hand-over takes the late reads (Gitar on #3893): a read in flight stays takeable
        self.assertEqual(aggregators.keep_late(self.db, SEARCH, lane, shown.extend, time.monotonic()), [], 'still reading: nothing is waited for between stages')
        go.set()
        kept = aggregators.keep_late(self.db, SEARCH, lane, shown.extend, time.monotonic() + 5)
        self.assertEqual([j['id'] for j in kept], ['1'])
        self.assertEqual([j['id'] for j in shown], ['1'], 'shown in the list now')
        self.assertIsNotNone(aggregators.read_lately(self.db, 'Slow', search=SEARCH), 'kept: it rests now')
        self.assertEqual(aggregators.keep_late(self.db, SEARCH, lane, shown.extend, time.monotonic() + 5), [], 'a read is kept once')

    def test_a_lane_read_that_raises_fails_alone_and_the_next_lane_read_is_kept(self):
        def broken(search):
            raise RuntimeError('boom')
        report = self.lane_scan([('Broken', broken), ('A', lambda search: [JOB])])
        self.assertEqual([j['id'] for j in report['jobs']], ['1'])
        self.assertEqual({s['company']: s['ok'] for s in report['sources']}, {'Broken': False, 'A': True})
        self.assertEqual(report['said'], stage.Result(stage.DONE))

    def test_every_finished_read_failed_and_one_waits_is_failed_not_cut(self):
        go = threading.Event()
        self.addCleanup(go.set)

        def broken(search):
            raise RuntimeError('boom')
        report = self.lane_scan([('Broken', broken), ('Slow', lambda search: go.wait(5) and [JOB])], cut_in=0.2)
        self.assertEqual(report['said'], stage.Result(stage.FAILED, 'RuntimeError; 1 wait for the next search'))



class TheLaneJudgesItsTitlesAsItReads(unittest.TestCase):
    """Lanes 4b-1 (owner, 11 Nov 2026, via sa: "Start it right away."): the free APIs were read from second 0 (3/5) but their titles were judged
    only when the stage kept them, at 68-108 s, past the titles' stop: 0 of 600-890 judged for 7 of 7 people. The lane now judges them in its
    own thread as it reads, as the boards' lane does (src/sources/boards_first.py Beside._put)."""

    def setUp(self):
        import json
        import pathlib
        import tempfile
        from types import SimpleNamespace
        from src import time_budget
        from src.ai import engine, title_triage
        from src.sources import feeds
        tmp, self.asked = pathlib.Path(tempfile.mkdtemp()), []

        def create(**kwargs):   # a fake model: every title fits (the shape of tests/unit/sources/test_eures_titles_in_time.py)
            listed = kwargs['messages'][0]['content'].split('The titles:\n', 1)[1].split('\n')
            self.asked += [line.split('. ', 1)[1] for line in listed]
            return SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps({'fit': list(range(1, len(listed) + 1))}))],
                                   usage=SimpleNamespace(input_tokens=1, output_tokens=1))
        model = SimpleNamespace(messages=SimpleNamespace(create=create))
        self.db = feeds.database(tmp / 'jobs.sqlite')   # the job cache's own schema: the stage records what it keeps
        self.addCleanup(self.db.close)
        for patch in (mock.patch.object(title_triage, 'STORE', tmp / 't.json'), mock.patch('src.paths.DATA', tmp), mock.patch.object(feeds, '_SEARCH', SEARCH),
                      mock.patch.object(feeds, 'wanted_location', lambda job: True), mock.patch.object(feeds, 'in_my_place', lambda job: False),   # an API job elsewhere: no local floor
                      mock.patch.object(engine, 'ready', return_value=True), mock.patch.object(engine, 'client', lambda **kw: model),
                      mock.patch.dict(os.environ), mock.patch('builtins.print')):
            patch.start()
            self.addCleanup(patch.stop)
        os.environ.pop('JOBADABRA_FIXTURE_DIR', None)
        feeds.PLACED = feeds.TRIAGED = feeds.READ = None
        self.addCleanup(lambda: setattr(feeds, 'TRIAGED', None))
        self.addCleanup(time_budget.start, 0)
        self.time_budget = time_budget

    def at(self, second):
        """The app's 180 s run, `second` seconds in (the titles' stop: 180 - RESERVE.titles 70 - TAIL 15 = 95 s)."""
        self.time_budget.start(180, now=time.monotonic() - second)

    def test_a_job_an_api_lists_at_second_5_is_judged_in_the_lane_and_listed_when_the_stage_keeps_it_past_the_titles_stop(self):
        self.at(5)
        lane = api_lane.start(self.db, SEARCH, readers=[('A', lambda search: [dict(JOB)])])
        self.addCleanup(lane.close)
        self.assertIsNotNone(lane.take('A', None), 'positive control: the read ended')
        self.at(100)   # the stage keeps the lane's jobs at 68-108 s (night 42927975750)
        self.assertTrue(self.time_budget.over('titles'), 'positive control: past the titles\' stop, where main judged them')
        report = aggregators.scan(self.db, SEARCH, readers=[('A', lambda search: [])], lane=lane)
        self.assertEqual(self.asked, ['engineer'], 'judged once, in the lane')
        self.assertEqual([job['url'] for job in report['jobs']], [JOB['url']], 'listed')


if __name__ == '__main__':
    unittest.main()
