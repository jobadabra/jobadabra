"""A timed Find jobs search saves, at its end, what each step left for the next run (src/press/resume.py save; plan E2b). Runs the phases test's fake search
once; the harness is borrowed method by method so this file does not repeat that file's 25 tests."""
import unittest

from src import time_budget
from src.press import resume
from tests.unit.ai import test_daily_search_phases as phases
from unittest import mock


class ASearchSavesWhatItLeft(unittest.TestCase):
    locals().update({name: fn for name, fn in vars(phases.SearchCharacterization).items() if callable(fn) and not name.startswith(('test', '__'))})   # its setUp and helpers

    def test_a_timed_search_saves_what_each_step_left_for_the_planner(self):
        # owner, 8 Nov 2026: "the next run nows where to continue and what are the left things to do": one file of counts, written at the run's end
        time_budget.start(180)
        self.addCleanup(time_budget.start, 0)
        resume.ran('scoring')   # the fake search does not run the real scoring step, which marks itself
        with mock.patch.object(time_budget, 'record'):
            self.run_search(limit=100)
        self.assertEqual(resume.load_left()['scoring']['left'], 0, 'written by the search itself, at its end')


if __name__ == '__main__':
    unittest.main()
