"""The run log can say where the 2:15 clock went: one line per AI call (step, asked, slot wait, answered) when the Search check asks for it (#2920, 7 Nov 2026).
Guard against the line vanishing (the next run could not then say whether employer titles wait on a slot, the hub or the budget share) and against it leaking into a person's log. No network, no clock."""
import io
import itertools
import os
import unittest
from contextlib import redirect_stdout
from unittest import mock

from src import time_budget
from src.ai import call_log, slots
from src.ai.providers.contract import Adapter

PARAMS = dict(model='claude-haiku-5-5', max_tokens=10, messages=[{'role': 'user', 'content': 'hi'}])


class Fake(Adapter):
    """An engine whose one call takes a slot of its own, as the CLI engines do."""
    name = 'fake'
    held = slots.Slots(1)

    def complete(self, request):
        with self.held:
            return 'answer'


def create(clock, env='1', started=100.0, action='title_triage'):
    """One call with `time.monotonic` returning `clock` in order (asked, slot asked, slot taken, answered), then its last value for any other reader."""
    adapter = Fake()
    adapter.action = action
    out, ticks = io.StringIO(), itertools.chain(clock, itertools.repeat(clock[-1]))
    with mock.patch.dict(os.environ, {'JOBADABRA_AI_CALL_LOG': env} if env else {}, clear=False), mock.patch.object(time_budget, 'STARTED', started), \
            mock.patch('time.monotonic', lambda: next(ticks)), redirect_stdout(out):
        answer = adapter.messages.create(**PARAMS)
    return answer, out.getvalue()


class AiCallLog(unittest.TestCase):
    def test_a_call_prints_its_step_when_it_was_asked_how_long_it_waited_and_when_it_was_answered(self):
        answer, text = create([110.0, 110.0, 113.5, 125.0])   # asked 10 s into the press; the slot came 3.5 s later; answered at 25 s
        self.assertEqual(answer, 'answer')
        self.assertEqual(text.strip(), 'AI call: title_triage (claude-haiku-5-5): asked at 10.0 s, waited 3.5 s for a slot, answered at 25.0 s (15.0 s)')

    def test_nothing_is_printed_for_a_person_or_outside_a_press(self):
        self.assertEqual(create([110.0, 110.0, 113.5, 125.0], env='')[1], '')
        self.assertEqual(create([110.0, 110.0, 113.5, 125.0], started=None)[1], '')

    def test_an_engine_with_no_slot_queue_says_so_instead_of_a_zero_wait(self):
        # Gitar on #3535: the API engine calls the SDK directly, so "waited 0.0 s for a slot" would read as a measurement that rules slot waits out
        adapter = Fake()
        adapter.complete = lambda request: 'answer'
        adapter.action = 'title_triage'
        out, ticks = io.StringIO(), itertools.chain([110.0, 125.0], itertools.repeat(125.0))
        with mock.patch.dict(os.environ, {'JOBADABRA_AI_CALL_LOG': '1'}), mock.patch.object(time_budget, 'STARTED', 100.0), mock.patch('time.monotonic', lambda: next(ticks)), redirect_stdout(out):
            adapter.messages.create(**PARAMS)
        self.assertEqual(out.getvalue().strip(), 'AI call: title_triage (claude-haiku-5-5): asked at 10.0 s, no slot queue, answered at 25.0 s (15.0 s)')

    def test_an_unnamed_step_is_named_by_its_engine(self):
        self.assertIn('AI call: fake (', create([110.0, 110.0, 113.5, 125.0], action='')[1])


if __name__ == '__main__':
    unittest.main()
