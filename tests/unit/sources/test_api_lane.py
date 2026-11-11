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
        self.assertEqual(lane.take('A', None), [JOB])
        self.assertEqual(lane.take('B', None), [JOB])
        self.assertTrue(all(name.startswith('free-api') for name in names), names)

    def test_a_read_still_running_at_the_cut_is_none_and_its_jobs_come_once_it_ends(self):
        go = threading.Event()
        lane = self.start([('Slow', lambda search: go.wait(5) and [JOB])])
        self.assertIsNone(lane.take('Slow', time.monotonic() + 0.05))
        go.set()
        self.assertEqual(lane.take('Slow', None), [JOB])

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
        for patch in (mock.patch.object(aggregators, 'kept', lambda db, name, found, now=None, shown=None: [dict(j, source=name) for j in found]),
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


if __name__ == '__main__':
    unittest.main()
