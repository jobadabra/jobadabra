"""A search does not end while its job boards' lane still reads and the run has time left (src/daily_search.py keep_late_boards, wait=True).
Why (11 Nov 2026, #3835; CI run 43103313269, a first search): the search had nothing left to do at 68 s and ended with 7 boards open in the
lane ("7 boards wait for the next search"); the lane's threads end with the process, so the run's remaining minute read nothing. A state decides
each verdict: the board read is a stand-in that yields a second group when the test lets it."""
import io
import sqlite3
import threading
import time
import unittest
from contextlib import contextmanager, redirect_stdout
from unittest import mock

from src import daily_search, time_budget
from src.sources import boards_first

BUDGET = 3   # the app's run, scaled (time_budget.part)
SEARCH = {'role_keywords': ['nurse'], 'locations': {'top_tier': ['lyon']}}
JOB = {'url': 'https://board.example.test/jobs/1', 'title': 'Nurse', 'location': 'Lyon'}
LATE = {'url': 'https://board.example.test/jobs/late', 'title': 'Nurse', 'location': 'Lyon'}


class SoFar:
    def __init__(self):
        self.jobs, self.flushed = [], 0

    def listener(self, _name):
        return self.jobs.extend

    def flush(self):
        self.flushed += 1


class TheSearchWaitsForItsBoards(unittest.TestCase):
    def setUp(self):
        self.addCleanup(time_budget.start, None)
        self.later = threading.Event()
        self.addCleanup(self.later.set)

        def read(run, search, **kwargs):   # one group at once, a second one only when the test lets it
            yield 'the 1 that worked before', [dict(JOB)]
            self.later.wait(10)
            yield 'the web search found', [dict(LATE)]

        @contextmanager
        def database(_path):
            db = sqlite3.connect(':memory:')
            try:
                yield db
            finally:
                db.close()
        for patch in (mock.patch('src.sources.board_reader.read', side_effect=read), mock.patch('src.sources.feeds.triage'),
                      mock.patch('src.sources.aggregators.kept', side_effect=lambda feed_db, name, found, *a, **k: list(found)),
                      mock.patch('src.daily_search.feeds.database', side_effect=database)):
            patch.start()
            self.addCleanup(patch.stop)

    def test_the_last_hand_over_waits_for_a_lane_still_reading(self):
        with redirect_stdout(io.StringIO()):
            time_budget.start(BUDGET)
            lane, so_far = boards_first.Beside(SEARCH), SoFar()
            threading.Timer(0.2, self.later.set).start()
            daily_search.keep_late_boards(lane, so_far, wait=True)
        self.assertTrue(lane.done.is_set(), 'the lane ended before the search did')
        self.assertEqual([job['url'] for job in so_far.jobs], [JOB['url'], LATE['url']])

    def test_it_never_waits_past_the_runs_end(self):
        with redirect_stdout(io.StringIO()):
            time_budget.start(BUDGET, now=time.monotonic() - BUDGET)   # the run's time is over; the lane's second group never lands
            lane, so_far = boards_first.Beside(SEARCH), SoFar()
            started = time.monotonic()
            daily_search.keep_late_boards(lane, so_far, wait=True)
        self.assertLess(time.monotonic() - started, 2, 'no wait once the run has ended')
        self.assertFalse(lane.done.is_set(), 'positive control: the lane was still reading')

    def test_between_the_stages_it_still_takes_only_what_landed(self):
        with redirect_stdout(io.StringIO()):
            time_budget.start(BUDGET)
            lane, so_far = boards_first.Beside(SEARCH), SoFar()
            deadline = time.monotonic() + 2
            while lane.groups.empty() and time.monotonic() < deadline:   # the first group has landed
                lane.done.wait(0.01)
            started = time.monotonic()
            daily_search.keep_late_boards(lane, so_far)
        self.assertLess(time.monotonic() - started, 1)
        self.assertEqual([job['url'] for job in so_far.jobs], [JOB['url']])


if __name__ == '__main__':
    unittest.main()
