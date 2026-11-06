"""The night Search check's 18 fictional candidates (owner, 6 Nov 2026: "6 personas is too narrow and could not tell the full story"): the table, the draw data it reads and the
workflow's matrix must agree, or a persona has no press (the compare job reads "p13: no result") or a press has no persona (gate.py cv fails on an unknown family or city).
Each persona is a different role family in a different city, so a night tells 18 stories and none is counted twice."""
import json
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'tools' / 'persona-search'))
import draw  # noqa: E402
import gate  # noqa: E402

WORKFLOW = (ROOT / '.github' / 'workflows' / 'search-personas.yml').read_text(encoding='utf-8')


class TheEighteenPersonas(unittest.TestCase):
    def test_there_are_eighteen_and_the_first_six_are_the_ones_the_owner_reviewed(self):
        self.assertEqual(len(gate.PERSONAS), 18)
        self.assertEqual([p['family'] for p in gate.PERSONAS[:6]], ['driver', 'hr', 'carpenter', 'warehouse', 'chef', 'marketing'], 'personas 1-6 keep their numbers: their history on main stays theirs')

    def test_every_persona_is_a_family_and_a_city_the_draw_can_build_a_cv_for(self):
        for n, p in enumerate(gate.PERSONAS, 1):
            family = next((f for f in draw.DATA['families'] if f['id'] == p['family']), None)
            city = next((c for c in draw.DATA['cities'] if c['city'] == p['city']), None)
            self.assertIsNotNone(family, f'p{n}: unknown family {p["family"]}')
            self.assertIsNotNone(city, f'p{n}: unknown city {p["city"]}')
            self.assertEqual((family['title'], city['country'], city['language']), (p['title'], p['country'], p['language']), f'p{n} disagrees with the draw data')

    def test_no_two_personas_share_a_role_family_or_a_city(self):
        for key in ('family', 'city'):
            values = [p[key] for p in gate.PERSONAS]
            self.assertEqual(len(values), len(set(values)), f'two personas share a {key}')

    def test_the_workflow_runs_exactly_one_press_per_persona(self):
        matrix = re.search(r'^\s+persona: \[([\d, ]+)\]', WORKFLOW, re.M)
        self.assertIsNotNone(matrix, 'the matrix line was not found')
        self.assertEqual([int(n) for n in matrix.group(1).split(',')], list(range(1, len(gate.PERSONAS) + 1)))
        self.assertIn('max-parallel: 1', WORKFLOW, 'one press at a time: a slow call is the AI\'s, never another press\'s queue')
        self.assertIn(f'({len(gate.PERSONAS)} personas)', WORKFLOW.splitlines()[0], 'the workflow name says how many')

    def test_a_cv_can_be_made_for_each_persona(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            for n in range(1, len(gate.PERSONAS) + 1):
                out = Path(tmp) / str(n)
                gate.make_cv(n, out)
                self.assertGreater((out / 'draw' / 'cv.pdf').stat().st_size, 500, f'p{n}: an empty CV')
                self.assertEqual(json.loads((out / 'draw' / 'draw.json').read_text())['family'], gate.PERSONAS[n - 1]['family'])


class RunsFromBeforeTheEighteen(unittest.TestCase):
    """A run on main from before 6 Nov 2026 has personas 1-6 only. Its zeros still read "measured nothing" (not shown as main's history), and it is no history for the pooled total."""

    @staticmethod
    def old_run(found, local=0):
        return {n: {'persona': n, 'local': local, 'found': found, 'seconds': 150, 'code': 0, 'crashes': 0, 'usd': 0, 'billing': 'subscription'} for n in range(1, 7)}

    def test_an_all_zero_six_persona_run_shows_no_zeros_in_the_main_column(self):
        now = {n: {'persona': n, 'local': 1, 'found': 2, 'seconds': 150, 'code': 0, 'crashes': 0, 'usd': 0, 'billing': 'subscription'} for n in range(1, 19)}
        verdict = gate.compare(now, [self.old_run(0)])
        self.assertEqual([r['main'] for r in verdict['rows'][:6]], [[]] * 6)

    def test_a_measured_six_persona_run_still_shows_its_numbers_for_personas_1_to_6_only(self):
        now = {n: {'persona': n, 'local': 1, 'found': 2, 'seconds': 150, 'code': 0, 'crashes': 0, 'usd': 0, 'billing': 'subscription'} for n in range(1, 19)}
        verdict = gate.compare(now, [self.old_run(5, local=3)])
        self.assertEqual([r['main'] for r in verdict['rows'][:6]], [[3]] * 6)
        self.assertEqual([r['main'] for r in verdict['rows'][6:]], [[]] * 12)
        self.assertIsNone(gate._total(self.old_run(5, local=3)), 'six personas are no history for the pooled total of 18')


if __name__ == '__main__':
    unittest.main()
