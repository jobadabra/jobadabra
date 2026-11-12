"""A title sort's batch size follows the provider's answer to "does this step think before it answers?" (gp + sa, 12 Nov 2026).
Claude Code's structured title sort (two turns) took 7.2 s for 30 titles and 8.6 s for 60 with the same right titles kept, so a p10 press sorted ~950
titles where the one-turn sort did ~1,170. A client that thinks first is asked BATCH_THINKING (60) titles a call; Codex, the API engines and a test's
fake answer in one turn and keep BATCH (30) until they are measured (src/press/budget.json)."""
import contextlib
import io
import json
import pathlib
import tempfile
import unittest
from types import SimpleNamespace
from unittest import mock

from src import time_budget
from src.ai import engine, title_triage

TITLES = [f'{"Keep" if n % 2 else "Drop"} Engineer {n}' for n in range(106)]


class Model:
    """Says a title fits when it starts with Keep; remembers how many titles each sort call held."""
    def __init__(self, thinks=None):
        self.sizes = []
        self.messages = SimpleNamespace(create=self.create)
        if thinks is not None:
            self.thinks_first = lambda: thinks

    def create(self, **kwargs):
        titles = [line.split('. ', 1)[1] for line in kwargs['messages'][0]['content'].split('The titles:\n', 1)[1].split('\n')]
        if kwargs['system'][0]['text'] == title_triage.SYSTEM:
            self.sizes.append(len(titles))
        fit = [n for n, title in enumerate(titles, 1) if title.startswith('keep')]
        return SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps({'fit': fit}))], usage=SimpleNamespace(input_tokens=1, output_tokens=1))


class BatchSizeTest(unittest.TestCase):
    def setUp(self):
        self.data = pathlib.Path(tempfile.mkdtemp())
        (self.data / 'step_pace.json').write_text(json.dumps({'title_rounds': 1.0}))
        for patch in (mock.patch('src.paths.DATA', self.data), mock.patch.object(engine, 'PARALLEL', 4), mock.patch('time.monotonic', lambda: 10.0)):
            patch.start()
            self.addCleanup(patch.stop)
        time_budget.start(180, now=0.0)
        self.addCleanup(lambda: setattr(time_budget, 'DEADLINE', None))

    def test_a_client_that_thinks_first_is_asked_60_titles_a_call_any_other_30(self):
        self.assertEqual((title_triage.BATCH, title_triage.BATCH_THINKING), (30, 60))
        for thinks, sizes in ((True, [60, 46]), (False, [30, 30, 30, 16]), (None, [30, 30, 30, 16])):
            with self.subTest(thinks=thinks), mock.patch.object(title_triage, 'STORE', self.data / f'{thinks}.json'), \
                    contextlib.redirect_stdout(io.StringIO()) as out:
                model = Model(thinks)
                title_triage.decide(TITLES, {'role_keywords': 'engineer'}, client=model, local=True)
                self.assertEqual(sorted(model.sizes, reverse=True), sizes)
                self.assertIn(f'batch(es) of up to {sizes[0]}', out.getvalue())


if __name__ == '__main__':
    unittest.main()
