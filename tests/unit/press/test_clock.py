"""The Find jobs run's one clock (plan docs/superpowers/plans/2026-11-07-the-press.md 4/6, a pure move): src/time_budget.py is the process's `Clock`
(src/press/clock.py), so each function of it gives what a fresh Clock gives on the same fixed clock, and a patch or an assignment on the module
reaches the clock's own calls. Guard (release): a Find jobs run's deadline, floors and batches decide what the person gets in 3 minutes; the
move must not change one answer."""
import contextlib
import io
import unittest
from unittest import mock

from src import time_budget
from src.press.clock import Clock

T0 = 1000.0   # the fixed clock: the run starts at T0, its budget is 180 s


def started(clock, score_first=False):
    clock.start(180, now=T0)
    clock.score_first(score_first)
    return clock


class ClockIsTheShimTest(unittest.TestCase):
    def setUp(self):
        out = contextlib.redirect_stdout(io.StringIO())   # the clock says its plans in the log
        out.__enter__()
        self.addCleanup(out.__exit__, None, None, None)
        self.addCleanup(lambda: [setattr(time_budget, name, None) for name in ('DEADLINE', 'STARTED', 'BEGAN', 'STAGE_END')])
        self.addCleanup(time_budget.score_first, False)

    def pair(self, score_first=False):
        return started(Clock(), score_first), started_shim(score_first)

    def test_each_function_gives_what_a_fresh_clock_gives(self):
        for score_first in (False, True):
            for at in (T0 + 5, T0 + 95, T0 + 124.9, T0 + 150, T0 + 170, T0 + 179):
                clock, shim = self.pair(score_first)
                with self.subTest(score_first=score_first, at=at):
                    self.assertEqual(shim.part(3), clock.part(3))
                    self.assertEqual(shim.end(), clock.end())
                    self.assertEqual(shim.ended(at), clock.ended(at))
                    self.assertEqual(shim.title_room(at), clock.title_room(at))
                    for step in ('titles', 'enrich', 'score', 'other'):
                        self.assertEqual(shim.reserve(step), clock.reserve(step))
                        self.assertEqual(shim.over(step, at), clock.over(step, at))
                    for step in ('place_rounds', 'place_vague', 'place_reading', 'title_rounds', 'enrich', 'score', 'job'):
                        self.assertEqual(shim.batch(step, 400, at, say=False), clock.batch(step, 400, at, say=False))
                        self.assertEqual(shim.in_calls(step, 400, 30, 2, at), clock.in_calls(step, 400, 30, 2, at))
                        self.assertEqual(shim.in_calls(step, 400, 30, 2, at, stop='titles'), clock.in_calls(step, 400, 30, 2, at, stop='titles'))
                    self.assertEqual(shim.may_score(at), clock.may_score(at))
                    self.assertEqual(shim.floor_left(), clock.floor_left())

    def test_the_floors_count_the_same_scores_and_titles(self):
        clock, shim = self.pair()
        past = T0 + 175   # the run's end: only the floors take anything
        self.assertEqual([shim.may_score(past) for _ in range(5)], [clock.may_score(past) for _ in range(5)])
        self.assertEqual([shim.floor_left()], [clock.floor_left()])
        self.assertEqual(shim.local_titles(100), clock.local_titles(100))

    def test_without_a_budget_every_step_takes_all_it_has(self):
        time_budget.start(0)   # a CLI run, a cloud run, a test: no budget
        shim = time_budget
        self.assertEqual((shim.batch('score', 7), shim.in_calls('place_rounds', 90, 30, 2), shim.over(), shim.ended()), (7, 90, False, False))
        self.assertEqual(shim.part(5), 5)
        self.assertEqual(Clock().part(5), shim.part(5))

    def test_the_press_in_search_at_is_where_the_clock_counts_from(self):
        press = Clock(search_at=1_000_000.0)
        with mock.patch('time.time', return_value=1_000_030.0):
            press.start(180, now=None)
        self.assertAlmostEqual(press.DEADLINE - press.STARTED, 180)
        self.assertAlmostEqual(press.part(180), 180)
        with mock.patch('time.time', return_value=1_000_030.0), mock.patch('time.monotonic', return_value=500.0):
            press.start(180)
        self.assertEqual((press.STARTED, press.DEADLINE), (470.0, 650.0))
        self.assertEqual(Clock(search_at=0)._since_press(), 0.0)

    def test_a_stage_that_has_only_its_share_ends_at_it(self):
        clock = Clock()
        clock.start(180, now=T0, stage=60)
        self.assertEqual((clock.end(), clock.STAGE_END), (T0 + 60, T0 + 60))
        self.assertTrue(clock.ended(T0 + 45))
        self.assertFalse(clock.ended(T0 + 44.9))

    def test_the_module_is_the_clock(self):
        self.assertIs(time_budget.CLOCK.__dict__, vars(time_budget))
        self.assertIs(time_budget.over.__self__, time_budget.CLOCK)
        time_budget.DEADLINE = T0 + 10
        self.assertEqual(time_budget.CLOCK.DEADLINE, T0 + 10)
        self.assertEqual(time_budget.STAGES, Clock.STAGES)

    def test_a_patch_on_the_module_reaches_the_clocks_own_calls(self):
        started_shim()
        with mock.patch.object(time_budget, '_over', lambda step, now: True):
            self.assertTrue(time_budget.over('score', T0 + 1))
        self.assertFalse(time_budget.over('score', T0 + 1))
        with mock.patch.object(time_budget, 'FLOOR', 0):
            self.assertEqual(time_budget.floor_left(), 0)
        self.assertEqual(time_budget.floor_left(), 3)


def started_shim(score_first=False):
    time_budget.start(180, now=T0)
    time_budget.score_first(score_first)
    return time_budget


if __name__ == '__main__':
    unittest.main()
