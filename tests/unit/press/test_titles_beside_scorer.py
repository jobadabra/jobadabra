"""With a scorer beside the search the title sort runs to the run's end (src/press/clock.py scored_beside). CI run 43020224640, p10 Amsterdam
(11 Nov 2026): title calls stopped at 95 s of 180 while AI slots were free, 81 local titles waited at 116 s. A scripted clock; nothing waits."""
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from src import time_budget
from src.press import scorer


class TitlesBesideTheScorer(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        patch = mock.patch('src.paths.DATA', Path(self.tmp.name))   # no pace file: the default 10 s a round
        patch.start()
        for undo in (patch.stop, self.tmp.cleanup, scorer.reset, lambda: time_budget.start(0)):
            self.addCleanup(undo)
        scorer.reset()
        time_budget.start(180, now=0)

    def test_alone_the_sort_keeps_its_old_stop_and_share(self):
        self.assertEqual(next(s for s in range(181) if time_budget.over('titles', now=s)), 95, 'positive control: 85 s before the end')
        self.assertEqual(time_budget.in_calls('title_rounds', 300, 30, 2, now=60), 120, 'positive control: a fifth of the time left')

    def test_beside_a_scorer_titles_are_asked_until_the_runs_tail_and_planned_on_all_the_time_left(self):
        scorer.begin()
        self.assertEqual(next(s for s in range(181) if time_budget.over('titles', now=s)), 165, 'no call starts in the last 15 s: the owner\'s 3 minutes hold')
        self.assertEqual(time_budget.in_calls('title_rounds', 300, 30, 2, now=60), 300, 'every title waiting at 60 s is planned')
        self.assertEqual(time_budget.in_calls('title_rounds', 300, 30, 2, now=160), 0, 'a round that cannot end by the tail is not planned')
        scorer.end()
        self.assertTrue(time_budget.over('titles', now=120), 'the scorer gone: the sort keeps time for the scoring after it again')


if __name__ == '__main__':
    unittest.main()
