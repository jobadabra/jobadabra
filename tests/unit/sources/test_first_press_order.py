"""A first Find jobs press reads before its read cut and sorts what it read (27 Oct 2026, the search benchmark: 6 fresh personas found 0-2
jobs where the 20 Oct round found 49-1,459; the run waited up to 45 s for its web search before the first-jobs slice, so the slice's boards
were asked at 80 s, past the read cut of 67 s; and the quality suite on Free AI: "No time left" for its 10 titles in scoring's share, 0 of
12 postings listed, so the "always 3" scores had no job)."""
import io
import json
import tempfile
import time
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

from src import run_counts, time_budget
from src.sources import careers

BUDGET = 3   # the app's 180 s, scaled (time_budget.part)
_READER = careers.READER


def setUpModule():   # the guard in tests/unit/sources/test_found_boards_ai.py: no page read reaches a real model from this file
    careers.READER = None


def tearDownModule():
    careers.READER = _READER


class TheSliceNeverWaitsForTheWebSearch(unittest.TestCase):
    def test_a_first_press_reads_its_slice_then_the_known_and_web_searchs_boards(self):
        source = (Path(__file__).resolve().parents[3] / 'src' / 'daily_search.py').read_text()
        body = source[source.index('def search('):]
        self.assertIn('if full_read and not slice_first:', body, 'the wait for the web search (boards_first.run) is not in front of a slice')
        self.assertLess(body.index('first_jobs.run('), body.rindex('boards_first.run('), 'the boards are still read on a first press, after its slice')
        self.assertLess(body.rindex('boards_first.run('), body.index('boards_ahead.scan_beside('), 'still before the employer read')


class TheTitlesThatFeedScoringAreSorted(unittest.TestCase):
    def setUp(self):
        run_counts.reset()
        self.addCleanup(run_counts.reset)
        self.addCleanup(time_budget.start, 0)
        time_budget.start(BUDGET, now=time.monotonic() - BUDGET * 130 / time_budget.PLANNED)   # 130 s of the app's 180: scoring's share
        self.assertTrue(time_budget._scorings() and not time_budget.ended())

    def test_one_batch_a_call_while_no_matched_job_waits_for_a_score(self):
        self.assertEqual(time_budget.local_titles(10), 10)
        self.assertEqual(time_budget.local_titles(100), time_budget.FEED, 'one batch, not the whole floor')

    def test_none_while_matched_jobs_need_the_time_then_one_batch_again(self):
        jobs = [{'url': f'https://x.test/{n}'} for n in range(100)]
        with redirect_stdout(io.StringIO()):
            run_counts.matched(jobs)
            self.assertEqual(time_budget.local_titles(10), 0, 'scoring keeps its share for the jobs that wait (b8cfac4)')
            for job in jobs:
                run_counts.scored(job, 40)
        self.assertEqual(time_budget.local_titles(10), 10, 'scored: the share is idle, the next titles feed it')

    def test_none_at_the_runs_end(self):
        time_budget.start(BUDGET, now=time.monotonic() - BUDGET)
        self.assertEqual(time_budget.local_titles(10), 0)


class ScoringKeepsTheTimeItNeeds(unittest.TestCase):
    """Copenhagen, 5 Nov 2026 (#2918): 200 EURES rows reached the titles at 82 s of 135 with one job waiting for a score; none was sorted and the press ended at 105 s."""
    def setUp(self):
        run_counts.reset()
        self.addCleanup(run_counts.reset)
        self.addCleanup(time_budget.score_first, False)
        self.addCleanup(time_budget.start, 0)
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.data = Path(folder.name)
        patch = mock.patch('src.paths.DATA', self.data)   # its paces: the default ones, not a stray step_pace.json
        patch.start()
        self.addCleanup(patch.stop)
        self.press(101)

    def press(self, at):
        """A 135 s press that scores (scoring stops 11 s before its end: TAIL; the 25 s kept for the job facts went in ts, 10 Nov 2026), `at` seconds in; the same distance to its stop as 82 s had before."""
        time_budget.start(135, now=time.monotonic() - at)
        time_budget.score_first()
        self.assertTrue(time_budget._scorings() and not time_budget.ended())

    def waiting(self, jobs):
        run_counts.matched([{'url': f'https://x.test/{n}'} for n in range(jobs)])

    def test_one_waiting_job_does_not_hold_back_the_local_titles(self):
        self.waiting(1)
        self.assertEqual(time_budget.local_titles(100), time_budget.FEED, 'its score takes seconds, and 23 s are left (at 101 s of 135): the titles go on, a batch a call')

    def test_jobs_that_need_the_time_left_keep_it(self):
        self.waiting(20)   # b8cfac4's case: the floor's title calls took the time and a search scored only its first 3
        self.assertEqual(time_budget.local_titles(10), 0)

    def test_the_last_seconds_before_scorings_stop_stay_scorings(self):
        self.waiting(1)
        self.press(119)
        self.assertEqual(time_budget.local_titles(10), 0, 'one round of title calls would leave its score no time')

    def test_this_computers_own_slow_pace_counts(self):
        (self.data / 'step_pace.json').write_text(json.dumps({'score': 30.0}))
        self.waiting(1)
        self.assertEqual(time_budget.local_titles(10), 0, 'a score this slow needs the time left')

    def test_the_runs_end_still_wins(self):
        self.waiting(1)
        time_budget.start(135, now=time.monotonic() - 135)
        self.assertEqual(time_budget.local_titles(10), 0)


if __name__ == '__main__':
    unittest.main()
