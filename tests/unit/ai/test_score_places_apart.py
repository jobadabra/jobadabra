"""The fit score reads where the person searches from Strategy → Locations only, never the Profile's older place rows (owner, 12 Nov 2026, #3850: "I can
have one location in profile, but looking for another location in my search strategy"). The owner's scenario: a Profile that still says Switzerland,
a Strategy that searches Germany."""
import unittest
from unittest import mock

from src.ai import locations, score

PROFILE = ('# Profile\n\n## Hard constraints\n\n| Constraint | Value |\n|---|---|\n| Countries | Switzerland (anywhere) |\n'
           '| Preferred cities | Zurich, Zug |\n| Relocation | Within Europe |\n| Home base | Geneva |\n\n- **Countries:** Switzerland\n\n'
           '# Experience\n\nSite reliability engineer, 8 years.\n')
STRATEGY = {'locations': {'top_tier': ['berlin'], 'country_wide': ['germany'], 'abroad': []}}


class ScorePlacesApart(unittest.TestCase):
    def sent(self, profile, strategy=STRATEGY):
        seen = []
        with mock.patch.object(locations, 'block_now', lambda: locations.block(strategy)), mock.patch.object(score, '_score_once', lambda client, model, job, text, effort: seen.append(text) or ({}, {})), \
                mock.patch.object(score.score_agree, 'steady', lambda data, usage, again, floor: (data, usage)):
            score.score_one(None, 'model', {'title': 'SRE', 'company': 'Acme'}, profile)
        return seen[0]

    def test_the_profiles_place_rows_never_reach_the_scorer(self):
        text = self.sent(PROFILE)
        self.assertNotIn('Switzerland', text)
        self.assertNotIn('Zurich', text)
        self.assertNotIn('Within Europe', text)
        self.assertNotIn('Home base', text, 'owner, 12 Nov 2026: the Profile location fills forms; the Strategy is the search')
        self.assertIn('Site reliability engineer, 8 years.', text)

    def test_the_search_places_come_from_strategy(self):
        block = locations.block(STRATEGY)
        self.assertIn('Preferred places: berlin.', block)
        self.assertIn('Acceptable places: germany.', block)

    def test_a_profile_without_place_rows_is_sent_as_it_was(self):
        plain = '# Profile\n\n| Languages | English, French |\n\n# Experience\n\nRelocation assistance was part of my last move.\n'
        self.assertEqual(self.sent(plain), plain.rstrip('\n'))

    def test_only_a_rows_form_is_dropped_never_the_persons_own_lines(self):
        """#3857 review: a colon line in Experience is the person's own; Notion writes a table row without outer pipes."""
        text = self.sent('# Hard constraints\nCountries | Switzerland\n\n# Experience\n\nRelocation: moved the team from Zurich to Berlin, 2022\n'
                         '- Countries: led rollouts in DE, FR, IT\n')
        self.assertNotIn('Countries | Switzerland', text)
        self.assertIn('Relocation: moved the team from Zurich to Berlin, 2022', text)
        self.assertIn('- Countries: led rollouts in DE, FR, IT', text)

    def test_the_score_judges_location_from_the_search_places_not_where_the_person_lives(self):
        self.assertNotIn('commute from the home base', score.SYSTEM)
        self.assertIn('outside the places they search is a location', score.SYSTEM)
        self.assertIn('Only when no places are given, judge from the home base', score.SYSTEM)

    def test_with_no_strategy_places_the_profile_rows_stay_the_scorers_only_places(self):
        self.assertEqual(self.sent(PROFILE, strategy={}), PROFILE)

    def test_the_score_hash_keeps_the_whole_scoring_text(self):
        """No paid re-run: what decides a re-score is the scoring text as before, place rows included."""
        job = {'title': 'SRE', 'description': 'Run Kubernetes.'}
        whole = score.scoring_profile(PROFILE)
        self.assertNotEqual(score.input_hash(job, {}, whole), score.input_hash(job, {}, locations.without_place_rows(whole, 'Preferred places: berlin.')))
        self.assertIn('| Countries | Switzerland (anywhere) |', whole, 'the hash input is untouched by this change')


if __name__ == '__main__':
    unittest.main()
