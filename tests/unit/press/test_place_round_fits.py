"""A place question that fits before the AI stop is asked, as a title question already is (L23, #2920). Stage-log run 43504169132 (13 Nov 2026): in a person's FIRST search the place
rounds of c04, b10 and c15 were refused from ~57 s ("No time left in this refresh for these: 7 location(s)") though the AI stop is ~134 s and a place call takes 3-4 s, so 317 board jobs
were never asked against 33 kept. Cause: place_triage passed no `stop` to Clock.in_calls, so the share alone (0.15 of the time left over a 10 s default pace on a fresh data folder) decided:
a round needed 66.7 s left. Tests: the clock rule for the three place steps on a fresh data folder, and place_triage.decide at 70 s."""
import contextlib
import io
import json
import pathlib
import tempfile
import unittest
from types import SimpleNamespace
from unittest import mock

from src import time_budget
from src.ai import engine, place_triage

STEPS = (('place_rounds', place_triage.BATCH), ('place_vague', place_triage.VAGUE_BATCH), ('place_reading', place_triage.READ_BATCH))
PARALLEL = 4


class Fresh(unittest.TestCase):
    """A fresh data folder (no step_pace.json: the default pace of 10 s a round) and a 135 s run."""

    def setUp(self):
        self.data = pathlib.Path(tempfile.mkdtemp())
        patch = mock.patch('src.paths.DATA', self.data)
        patch.start()
        self.addCleanup(patch.stop)
        time_budget.start(135, now=0.0)
        self.addCleanup(lambda: setattr(time_budget, 'DEADLINE', None))

    def pace(self, step, seconds):
        (self.data / 'step_pace.json').write_text(json.dumps({step: seconds}))


class ClockRule(Fresh):
    def test_a_place_round_that_fits_before_the_stop_is_asked_at_70_s_on_a_fresh_folder(self):
        """Red on main: the share needs 66.7 s left, so a round at 70 s (65 s left) was refused. The stop is 135 - 0.75 * 15 = 123.75 s (the TAIL kept, no later step reserves seconds): 70 + 10 fits."""
        for step, size in STEPS:
            with self.subTest(step=step), contextlib.redirect_stdout(io.StringIO()) as out:
                self.assertEqual(time_budget.in_calls(step, 7, size, PARALLEL, now=70.0, stop=step), 7)
                self.assertNotIn('No time left', out.getvalue())

    def test_the_share_alone_still_refuses_a_step_with_no_stop(self):
        """The control that proves the 70 s case above is the share's refusal: without `stop` the same call gives none (what place_triage did)."""
        with contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(time_budget.in_calls('place_rounds', 7, place_triage.BATCH, PARALLEL, now=70.0), 0)
        self.assertIn('No time left in this refresh for these: 7 location(s)', out.getvalue())

    def test_a_round_that_does_not_end_before_the_stop_is_still_refused(self):
        """A measured 4 s round starts up to 119.75 s; a round that would end after the stop never starts, and the refusal is said."""
        for step, size in STEPS:
            self.pace(step, 4.0)
            with self.subTest(step=step), contextlib.redirect_stdout(io.StringIO()) as out:
                self.assertEqual(time_budget.in_calls(step, 7, size, PARALLEL, now=119.0, stop=step), 7)
                self.assertEqual(time_budget.in_calls(step, 7, size, PARALLEL, now=120.0, stop=step), 0)
                self.assertIn('No time left in this refresh for these: 7 location(s)', out.getvalue())
        with contextlib.redirect_stdout(io.StringIO()):   # the default 10 s: refused from 114 s
            for step, size in STEPS:
                self.pace(step, 10.0)
                self.assertEqual(time_budget.in_calls(step, 7, size, PARALLEL, now=113.0, stop=step), 7)
                self.assertEqual(time_budget.in_calls(step, 7, size, PARALLEL, now=114.0, stop=step), 0)


class Model:
    """Places every location it is asked about inside; remembers the batches."""
    def __init__(self):
        self.asked = []
        self.messages = SimpleNamespace(create=self.create)

    def create(self, **kwargs):
        listed = kwargs['messages'][0]['content'].split('The job locations:\n', 1)[1].split('\n')
        self.asked += [line.split('. ', 1)[1] for line in listed]
        answer = {'locations': [{'n': n, 'answer': 'inside', 'country': 'Spain'} for n in range(1, len(listed) + 1)]}
        return SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps(answer))], usage=SimpleNamespace(input_tokens=1, output_tokens=1))


class Decide(Fresh):
    def decide(self, at):
        """place_triage.decide for 7 locations of a person's first search with the clock at `at` seconds."""
        model, out = Model(), io.StringIO()
        patches = [mock.patch('time.monotonic', lambda: at), mock.patch.object(place_triage, 'STORE', self.data / 'places.json'), mock.patch.object(engine, 'PARALLEL', PARALLEL),
                   mock.patch('src.geo.verdicts', return_value={}), mock.patch.object(place_triage, 'places_words', return_value={'best_places': ['valencia']}),
                   mock.patch.object(place_triage, '_preferences', return_value={}), mock.patch.object(place_triage, 'known', return_value={}),
                   mock.patch.object(place_triage, '_keep')]
        with contextlib.ExitStack() as stack:
            for patch in patches:
                stack.enter_context(patch)
            stack.enter_context(contextlib.redirect_stdout(out))
            place_triage.decide([f'Town {n}, Spain' for n in range(7)], {'role_keywords': ['teacher']}, model)
        return model, out.getvalue()

    def test_b10_c15_shape_the_place_question_is_asked_at_70_s(self):
        """Red on main: refused at 68 s (7 locations, c04) and 64 s (8, c15), so the board jobs at those locations were never asked."""
        model, said = self.decide(70.0)
        self.assertEqual(len(model.asked), 7, said)
        self.assertNotIn('No time left', said)

    def test_at_the_stop_nothing_is_asked_and_the_refusal_is_said(self):
        model, said = self.decide(124.0)
        self.assertEqual(model.asked, [])
        self.assertIn('No time left in this refresh for these: 7 location(s) wait for the next one', said)


if __name__ == '__main__':
    unittest.main()
