"""An AI call asked in time whose slot comes after the search's time is not started (src/ai/providers/cli_base.py call). sa's local p10 search, 11 Nov 2026:
calls asked at 36-46 s got their slot at 141-163 s, after the AI steps' stop at 135 s, and ran the search to 173 s. A scripted clock; no process starts."""
import unittest
from types import SimpleNamespace
from unittest import mock

from src import time_budget
from src.ai.providers import cli_base


class Started(Exception):
    """The fake binary was started."""


def start(*args, **kwargs):
    raise Started()


class SlotAfterTheStop(unittest.TestCase):
    def setUp(self):
        self.addCleanup(time_budget.start, 0)
        time_budget.start(180, now=0)   # no call starts from 165 s (TAIL)
        self.adapter = cli_base.CliAdapter(binary='ai', run=start)

    def call(self, asked, got_slot):
        seconds = iter([asked, got_slot])
        with mock.patch.object(cli_base, 'time', SimpleNamespace(monotonic=lambda: next(seconds))):
            return self.adapter.call([], 'prompt', None)

    def test_a_call_that_waited_past_the_stop_is_not_started(self):
        with self.assertRaises(cli_base.CliError) as refused:
            self.call(asked=100, got_slot=170)
        self.assertNotIsInstance(refused.exception, cli_base.CliLimitError, 'not a plan limit: the item waits for the next search')
        self.assertIn("search's time was up", str(refused.exception))

    def test_positive_control_a_call_whose_slot_comes_in_time_starts(self):
        with self.assertRaises(Started):
            self.call(asked=100, got_slot=160)

    def test_a_call_asked_after_the_stop_is_its_callers_business_as_before(self):
        with self.assertRaises(Started):
            self.call(asked=170, got_slot=170)

    def test_without_a_budget_nothing_is_refused(self):
        time_budget.start(0)
        with self.assertRaises(Started):
            self.call(asked=100, got_slot=5000)


if __name__ == '__main__':
    unittest.main()
