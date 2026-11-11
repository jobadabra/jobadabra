"""The job boards' lane reads to the run's end, not to the employer sites' read cut (lanes 4a; L05, owner, 11 Nov 2026, asked via
AskUserQuestion: "Run's deadline, own lane (Recommended)" and "Yes, update L05 and L10 (Recommended)").
Why: on a first press the boards started at 49-59 s (their list is an AI answer) and the read cut stopped them at 67.5 s with 2-6 boards still
open: board jobs on a first run in 1 of 49 runs since the cut came (26 Oct 2026, be074c43). A state decides each verdict: the clock is set,
never waited for; the board read is a stand-in that reads only while its cut has not come."""
import io
import sqlite3
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import redirect_stdout
from unittest import mock

from src import time_budget
from src.ai import slots
from src.sources import boards_first, read_budget

BUDGET = 3   # the app's run, scaled (time_budget.part)
SEARCH = {'role_keywords': ['nurse'], 'locations': {'top_tier': ['lyon']}}
JOB = {'url': 'https://board.example.test/jobs/1', 'title': 'Nurse', 'location': 'Lyon'}


def past_the_cut():
    """The clock 100 s into the app's 180 s: past the read cut (90 s), before the run's end (180 - TAIL)."""
    time_budget.start(BUDGET, now=time.monotonic() - BUDGET * 100 / time_budget.PLANNED)


class TheLaneClock(unittest.TestCase):
    def setUp(self):
        self.addCleanup(time_budget.start, 0)
        past_the_cut()

    def test_a_read_in_the_lane_and_in_the_pools_it_starts_ends_at_the_runs_end_not_at_the_read_cut(self):
        cut, end = read_budget.cut_at(), read_budget.run_end()
        self.assertTrue(read_budget.past_cut(), 'positive control: the employer sites\' read cut has come')
        self.assertLess(cut, end, 'positive control: the cut comes before the run\'s end')
        with slots.in_lane(end):
            self.assertEqual(read_budget.cut_at(), end)
            self.assertFalse(read_budget.past_cut(), 'the lane still reads')
            with ThreadPoolExecutor(max_workers=1) as pool:   # a board's pages are read in pool threads (found_boards.read)
                self.assertEqual(pool.submit(slots.carry(read_budget.cut_at)).result(timeout=5), end, 'carried into the pool')
        self.assertEqual(read_budget.cut_at(), cut, 'outside the lane: the cut again')
        with ThreadPoolExecutor(max_workers=1) as pool:
            self.assertEqual(pool.submit(slots.carry(read_budget.cut_at)).result(timeout=5), cut, 'a pool outside the lane keeps the cut')


class TheBoardsLane(unittest.TestCase):
    def setUp(self):
        self.addCleanup(time_budget.start, 0)
        self.db = sqlite3.connect(':memory:')
        self.addCleanup(self.db.close)

    def lane_with_a_board_read_past_the_cut(self, listed=None):
        def read(run, search, **kwargs):   # the boards' first pages: read only while this thread's cut has not come
            if not read_budget.past_cut():
                yield 'the 1 that worked before', [dict(JOB)]
        with mock.patch('src.sources.board_reader.read', side_effect=read), mock.patch('src.sources.feeds.triage'), \
                mock.patch('src.sources.aggregators.kept', side_effect=lambda feed_db, name, found, *a, **k: list(found)), \
                redirect_stdout(io.StringIO()):
            past_the_cut()
            lane = boards_first.Beside(SEARCH, listed=listed)
            shown = []
            matched = lane.take(self.db, shown.extend)
        return matched, shown

    def test_the_boards_lane_reads_past_the_employer_sites_read_cut(self):
        matched, shown = self.lane_with_a_board_read_past_the_cut()
        self.assertEqual([job['url'] for job in matched], [JOB['url']], 'read in the lane after the employer sites\' cut')
        self.assertEqual(shown, matched, 'kept and shown by the thread that owns the job cache')

    def test_a_first_runs_own_board_list_is_read_in_the_same_lane(self):
        listed = []

        def board_list():   # the slice's list (src/first_jobs.py board_jobs), read in the lane
            listed.append(read_budget.past_cut())
            return [] if read_budget.past_cut() else [{'url': 'https://proposed.example.test/jobs/2', 'title': 'Nurse', 'location': 'Lyon'}]
        matched, _shown = self.lane_with_a_board_read_past_the_cut(listed=board_list)
        self.assertEqual(listed, [False], 'the list was read in the lane, past the employer sites\' cut')
        self.assertEqual(sorted(job['url'] for job in matched), ['https://board.example.test/jobs/1', 'https://proposed.example.test/jobs/2'])

    def test_the_gather_takes_the_lanes_groups_to_its_bound_and_a_later_group_is_kept_after(self):
        """Why (#3826, Gitar): the gather waited for the lane's end (~170 s), holding the import and every score behind the boards. It now takes the
        groups to its bound (the employer sites' cut) while the lane keeps reading; a group that lands later is kept by the next hand-over."""
        later, late = threading.Event(), {'url': 'https://board.example.test/jobs/late', 'title': 'Nurse', 'location': 'Lyon'}

        def read(run, search, **kwargs):   # one group at once, a second one only after the gather's bound
            yield 'the 1 that worked before', [dict(JOB)]
            later.wait(10)
            yield 'the web search found', [dict(late)]
        with mock.patch('src.sources.board_reader.read', side_effect=read), mock.patch('src.sources.feeds.triage'), \
                mock.patch('src.sources.aggregators.kept', side_effect=lambda feed_db, name, found, *a, **k: list(found)), \
                redirect_stdout(io.StringIO()):
            time_budget.start(BUDGET)
            lane, shown = boards_first.Beside(SEARCH), []
            started = time.monotonic()
            taken = lane.take(self.db, shown.extend, until=time_budget.now() + 0.3)   # the run's one clock
            self.assertLess(time.monotonic() - started, 2, 'the gather does not wait for the lane\'s end')
            self.assertEqual([job['url'] for job in taken], [JOB['url']])
            self.assertFalse(lane.done.is_set(), 'positive control: the lane was still reading when the gather took it')
            later.set()
            self.assertTrue(lane.done.wait(5))
            lane.deliver(self.db, shown.extend)   # the hand-over between the stages after the gather (daily_search.keep_late_boards)
        self.assertEqual([job['url'] for job in shown], [JOB['url'], late['url']])

    def test_outside_the_lane_the_same_read_past_the_cut_reads_nothing(self):
        """Positive control for the two above: the stand-in read stops at the cut when no lane is set."""
        past_the_cut()
        with mock.patch.object(read_budget, 'run_end', return_value=None):   # no lane end: the read keeps the cut
            matched, _shown = self.lane_with_a_board_read_past_the_cut()
        self.assertEqual(matched, [])


if __name__ == '__main__':
    unittest.main()
