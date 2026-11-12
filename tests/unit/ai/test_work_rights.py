"""The engine reads work rights from Profile → Work eligibility (config/work-rights.json, written by desktop/lib/work-rights.js; owner, 12 Nov 2026, #3850:
"Work rights doesn't really make sense. They should be only in the Profile"). The owner's scenario: the Profile says a permit in the EU block, the Strategy
searches Geneva; the place AI hears the permit for Geneva's country only (owner, asked via AskUserQuestion: a Swiss permit gives no right in Germany)."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from src import work_rights
from src.ai import place_triage

GENEVA = {'locations': {'top_tier': ['geneva'], 'country_wide': [], 'abroad': []}}


class WorkRights(unittest.TestCase):
    def config(self, **files):
        folder = Path(tempfile.mkdtemp())
        for name, content in files.items():
            (folder / name).write_text(json.dumps(content), encoding='utf-8')
        return folder

    def test_the_profiles_copy_wins_over_the_older_strategy_list(self):
        folder = self.config(**{'work-rights.json': {'work_rights': ['United Kingdom'], 'permit_zones': ['EU / EEA + Switzerland']},
                                'preferences.json': {'work_rights': ['\\bcanada\\b']}})
        self.assertEqual(work_rights.load(folder), {'work_rights': ['United Kingdom'], 'permit_zones': ['EU / EEA + Switzerland'], 'unread': []})

    def test_before_the_app_wrote_it_the_older_strategy_list_is_read_never_lost(self):
        folder = self.config(**{'preferences.json': {'work_rights': ['\\beu\\b']}})
        self.assertEqual(work_rights.load(folder)['work_rights'], ['\\beu\\b'])
        self.assertEqual(work_rights.load(self.config())['work_rights'], [])

    def test_a_permit_zone_names_only_the_persons_own_places(self):
        rights = {'work_rights': ['United Kingdom'], 'permit_zones': ['EU / EEA + Switzerland'], 'unread': []}
        words = place_triage.places_words(GENEVA, rights)['work_rights']
        self.assertEqual(words[0], 'United Kingdom')
        self.assertEqual(words[1], 'a work permit in EU / EEA + Switzerland, valid only in the country of: geneva')
        self.assertNotIn('EU', words, 'never the whole block')
        self.assertEqual(work_rights.words(rights, []), ['United Kingdom'], 'no own places: the permit clears nothing')

    def test_the_visa_question_reads_the_profiles_rights(self):
        folder = self.config(**{'work-rights.json': {'work_rights': ['Romania', 'EU'], 'permit_zones': []}})
        with mock.patch.object(work_rights, 'CONFIG', folder):
            self.assertEqual(place_triage.places_words(GENEVA, place_triage._preferences())['work_rights'], ['Romania', 'EU'])


if __name__ == '__main__':
    unittest.main()
