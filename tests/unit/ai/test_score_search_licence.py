"""The fit score's search part caps a role that needs a credential the person does not hold (owner, 7 Nov 2026: a Cessna captain job scored 85 while its
card said Not eligible). The model's answer is replayed by tools/score-cases.py; this checks the rule reaches the prompt and the case set stays well formed."""
import json
import unittest
from pathlib import Path
from unittest import mock

from src.ai import score, score_search

CASES = Path(__file__).resolve().parents[2] / 'fixtures' / 'score-cases.json'


class ScoreSearchLicence(unittest.TestCase):
    def test_the_rule_reaches_the_scorer_prompt(self):
        self.assertIn('not prefers', score_search.RULE)
        self.assertIn('not prefers', score_search.PART['properties']['fit']['description'])
        self.assertIn(score_search.RULE, score.SYSTEM)

    def test_the_case_set_holds_the_owners_case_and_both_traps(self):
        cases = {case['id']: case for case in json.loads(CASES.read_text(encoding='utf-8'))['cases']}
        self.assertEqual(cases['cessna-licence-required']['expect']['score_max'], 49)
        self.assertEqual(cases['cadet-no-licence-needed']['expect']['score_min'], 50)
        self.assertEqual(cases['missing-tool-is-a-gap']['expect']['score_min'], 55)
        for case in cases.values():
            self.assertTrue(case['expect'] and case['search'] and (case.get('job') or case.get('golden')), case['id'])

    def test_a_role_the_scorer_says_needs_a_credential_is_not_lifted_by_the_title_check(self):
        """Fails on the old code: the title check (which cannot see the licence) lifted a capped fit 45 to SEARCH_ROLE_FIT, shown next to Not eligible."""
        def applied(needs):
            part = {'fit': 45, 'career_change': True, 'cv_gap': 'No pilot licence', 'needs_credential': needs}
            with mock.patch.object(score_search, '_search_role', return_value=True):
                return score_search.apply({'score': 20, 'tier': 'C', 'reason': 'Unrelated', 'gaps': [], 'search': part}, {'title': 'Captain'})
        self.assertEqual(applied(True)['score'], 45, 'the AI\'s own capped fit stands')
        self.assertEqual(applied(False)['score'], score_search.SEARCH_ROLE_FIT, 'no credential: the title check still lifts (Free AI rates real jobs low)')

    def test_the_answer_form_asks_for_the_boolean(self):
        self.assertIn('needs_credential', score_search.PART['required'])
        self.assertEqual(score_search.PART['properties']['needs_credential']['type'], 'boolean')


if __name__ == '__main__':
    unittest.main()
