"""Remote jobs: "Country" (lj 2/4, owner 10 Nov 2026: a bare "Remote" or "Worldwide" counts only under Any remote). The setting's third word keeps the Yes/No
meaning of old strategies (missing = Yes) and tells the place question to let a remote job in only when it names the person's country; without AI the words
let in a remote job only when it names one of their places. Mac proof of #3676: Dublin, Budapest and Zagreb were left with bare "Remote" jobs placed as in your places."""
import json
import pathlib
import tempfile
import unittest
from unittest import mock

from src import geo, regions
from src.ai import place_triage
from src.paths import keyword_regex, place_regex
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

    def test_a_person_with_only_cities_gets_the_remote_jobs_that_name_their_country(self):
        """Retro review of #3687 (Gitar, 10 Nov 2026): PLACE holds the person's places only, so with a drafted `Country` and `top_tier: [Dublin]` (the drafting prompt leaves country_wide empty)
        "Remote, Ireland" failed the words floor; the floor now adds the countries their places are in (the kept map), for a location that says remote."""
        folder = pathlib.Path(tempfile.mkdtemp())
        (folder / 'geo.json').write_text(json.dumps({'dublin': {'kind': 'city', 'cc': 'IE'}}))
        search = {'locations': {'top_tier': ['Dublin'], 'country_wide': [], 'abroad': []}, 'remote_jobs': ['Country']}
        with mock.patch.object(feeds, 'PLACE', place_regex(['Dublin'])), mock.patch.object(feeds, '_PLACES', ['Dublin']), mock.patch.object(feeds, 'REMOTE_WANTED', True), \
                mock.patch.object(feeds, 'REMOTE_COUNTRY_ONLY', True), mock.patch.object(feeds, 'placing', return_value=False), mock.patch.object(feeds, 'place_of', return_value=None), \
                mock.patch.object(geo, 'STORE', folder / 'geo.json'), mock.patch.object(feeds, '_SEARCH', search):
            self.assertTrue(feeds.wanted_location({'location': 'Remote, Ireland', 'remote': True}), 'names their country')
            for where in ('Remote', 'Worldwide', 'Remote, Poland', 'Cork, Ireland'):
                self.assertFalse(feeds.wanted_location({'location': where, 'remote': True}), where)
            (folder / 'geo.json').write_text('{}')   # the map does not know the place yet: the floor is as it was
            self.assertFalse(feeds.wanted_location({'location': 'Remote, Ireland', 'remote': True}))

    def test_under_yes_the_floor_is_as_before(self):
        with mock.patch.object(feeds, 'PLACE', DUBLIN), mock.patch.object(feeds, 'REMOTE_WANTED', True), mock.patch.object(feeds, 'REMOTE_COUNTRY_ONLY', False), \
                mock.patch.object(feeds, 'placing', return_value=False), mock.patch.object(feeds, 'place_of', return_value=None):
            self.assertTrue(feeds.wanted_location({'location': 'Remote', 'remote': True}))


if __name__ == '__main__':
    unittest.main()
