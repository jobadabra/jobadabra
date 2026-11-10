"""Remote jobs: "Country" (lj 2/4, owner 10 Nov 2026: a bare "Remote" or "Worldwide" counts only under Any remote). The setting's third word keeps the Yes/No
meaning of old strategies (missing = Yes) and tells the place question to let a remote job in only when it names the person's country; without AI the words
let in a remote job only when it names one of their places. Mac proof of #3676: Dublin, Budapest and Zagreb were left with bare "Remote" jobs placed as in your places."""
import unittest
from unittest import mock

from src import regions
from src.ai import place_triage
from src.paths import keyword_regex
from src.sources import feeds

DUBLIN = keyword_regex(regions.expand(['Dublin', 'Ireland']))


class RemoteCountryOnlyTest(unittest.TestCase):
    def test_the_setting_words(self):
        self.assertTrue(feeds.remote_country_only({'remote_jobs': ['Country']}))
        self.assertFalse(feeds.remote_country_only({'remote_jobs': ['Yes']}))
        self.assertFalse(feeds.remote_country_only({}), 'missing stays Yes, an old strategy is not changed')
        for words, wanted in ((['No'], False), (['Country'], True), (['Yes'], True), ([], True)):
            self.assertEqual(feeds.remote_wanted({'remote_jobs': words}), wanted, words)

    def test_the_place_question_is_told(self):
        for words, said in ((['No'], 'no'), (['Country'], 'only_their_country'), (['Yes'], 'yes'), ([], 'yes')):
            got = place_triage.places_words({'locations': {'top_tier': ['dublin']}, 'remote_jobs': words})['remote_jobs']
            self.assertEqual(got, said, words)
        self.assertIn('only_their_country', place_triage.SYSTEM)
        self.assertIn('bare "Remote" or "Worldwide" is "out"', place_triage.SYSTEM)

    def test_without_ai_a_bare_remote_job_is_out_and_a_named_place_stays_in(self):
        with mock.patch.object(feeds, 'PLACE', DUBLIN), mock.patch.object(feeds, 'REMOTE_WANTED', True), mock.patch.object(feeds, 'REMOTE_COUNTRY_ONLY', True), \
                mock.patch.object(feeds, 'placing', return_value=False), mock.patch.object(feeds, 'place_of', return_value=None):
            for where in ('Remote', 'Worldwide', 'Remote; Europe', 'Remote, Poland', 'Anywhere'):
                self.assertFalse(feeds.wanted_location({'location': where, 'remote': True}), where)
            self.assertTrue(feeds.wanted_location({'location': 'Remote, Ireland', 'remote': True}), 'it names your country')
            self.assertTrue(feeds.wanted_location({'location': 'Dublin'}))

    def test_under_yes_the_floor_is_as_before(self):
        with mock.patch.object(feeds, 'PLACE', DUBLIN), mock.patch.object(feeds, 'REMOTE_WANTED', True), mock.patch.object(feeds, 'REMOTE_COUNTRY_ONLY', False), \
                mock.patch.object(feeds, 'placing', return_value=False), mock.patch.object(feeds, 'place_of', return_value=None):
            self.assertTrue(feeds.wanted_location({'location': 'Remote', 'remote': True}))


if __name__ == '__main__':
    unittest.main()
