"""Guard: release: a same-inputs pair shares AI answers per wording, so two same-code searches that pack the same wordings into different batches still get the same answers.
Why (14 Nov 2026, sa for the owner): two same-code c15 sides packed ~555 link wordings into different 50-wording batches (src/ai/decide_gate.py arrival order), each batch's bytes made its own key, and each side asked the model itself."""
import json
import os
import tempfile
import unittest

from src import same_inputs


class PerWording(unittest.TestCase):
    """The batch a wording rides in differs between two searches; its answer is still shared per wording (src/same_inputs.py _per_wording)."""
    ARGS = ('links', ('a', 'b'), 'task', None, None)

    def _run(self, folder, pairs, real, other_has=None):
        same_inputs.folder = folder
        try:
            for wording, record in (other_has or {}).items():   # the other search claimed it first and answered
                base = os.path.join(folder, same_inputs._wording_key('links', ('a', 'b'), 'task', wording))
                with open(base + '.lock', 'w', encoding='utf-8') as file:
                    file.write(f'other:{os.getpid()}')
                with open(base + '.json', 'w', encoding='utf-8') as file:
                    json.dump(record, file)
            return same_inputs._per_wording(real)(*self.ARGS[:1], pairs, *self.ARGS[1:])
        finally:
            same_inputs.folder = ''

    def test_an_answered_wording_is_taken_and_only_the_rest_is_asked_then_written_for_the_other(self):
        asked = []

        def real(topic, pairs, answers, instructions, client, allowance):
            asked.extend(w for _, w in pairs)
            return ['b'] * len(pairs)
        with tempfile.TemporaryDirectory() as folder:
            got = self._run(folder, [('1', 'one'), ('2', 'two')], real, {'one': {'answer': 'a', 'seconds': 0}})
            self.assertEqual((got, asked), (['a', 'b'], ['two']))
            with open(os.path.join(folder, same_inputs._wording_key('links', ('a', 'b'), 'task', 'two') + '.json'), encoding='utf-8') as file:
                self.assertEqual(json.load(file)['answer'], 'b')

    def test_an_unasked_wording_is_not_shared_the_other_side_asks_it_itself(self):
        from src.ai.decide_gate import UNASKED
        asked = []

        def real(topic, pairs, answers, instructions, client, allowance):
            asked.extend(w for _, w in pairs)
            return ['a'] * len(pairs)
        with tempfile.TemporaryDirectory() as folder:
            got = self._run(folder, [('1', 'one')], real, {'one': {'answer': None, 'error': 'unasked', 'seconds': 0}})
            self.assertEqual((got, asked), (['a'], ['one']))
            self.assertIsNot(got[0], UNASKED)


if __name__ == '__main__':
    unittest.main()
