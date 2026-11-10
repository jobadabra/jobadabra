"""A remote job is in your places only when the AI says so (#3674, 10 Nov 2026): an on-site nurse in Dublin got 25 jobs, 24 of them "Remote, Poland",
"Remote, United Kingdom"…, because the place call never ran in time and the place words let any "remote" location in. Remote is a judgment
(which countries may take the job), so while the AI places locations and has not answered, the job is unknown: not listed, not scored, and its
employer's list is read again so the next run places it. Without any AI the place words stay the floor, as before (tests/unit/sources/test_places_strict.py).
The employer pick keeps the guess: it only says which sites to read, never which job is kept."""
import unittest
from unittest import mock

from src import employer_index, regions
from src.paths import keyword_regex
from src.sources import feed_facts, feeds

DUBLIN = keyword_regex(regions.expand(['Dublin', 'Ireland']))
# The 25 jobs the Dublin nurse's run kept (Mac plan run, main 4ca439a5): every location as it was, the titles as the AI had kept them.
DUBLIN_RUN = ([('Remote', 'ADHD Assessor for Children')] * 3 + [('Remote Switzerland', 'Ernährungsberater*in BSc')] * 2
              + [('Remote, Poland', 'Senior Clinical Research Associate')] * 4 + [('Remote, Argentina', 'Senior Clinical Research Associate')] * 2
              + [('Remote, Hong Kong', 'Senior/Clinical Research Associate'), ('Remote, Hungary', 'Senior Clinical Research Associate')]
              + [('Remote, Hungary', 'Senior Clinical Research Associate')] + [('Remote, Germany', 'Senior Clinical Research Associate')] * 4
              + [('Remote, France', 'Senior Clinical Research Associate')] * 2 + [('Remote, United Kingdom', 'Senior Clinical Research Associate')] * 4)


class RemoteIsJudgedTest(unittest.TestCase):
    def setUp(self):
        self.patches = [mock.patch.object(feeds, 'PLACE', DUBLIN), mock.patch.object(feeds, 'REMOTE_WANTED', True),
                        mock.patch.object(feeds, 'placing', return_value=True), mock.patch.object(feeds, 'place_of', return_value=None)]
        for patch in self.patches:
            patch.start()

    def tearDown(self):
        for patch in self.patches:
            patch.stop()

    def test_the_dublin_runs_remote_jobs_are_not_kept_before_the_ai_places_them(self):
        self.assertEqual(len(DUBLIN_RUN), 24)
        kept = [where for where, title in DUBLIN_RUN if feeds.wanted_location({'location': where, 'title': title})]
        self.assertEqual(kept, [], 'remote somewhere, not placed by the AI: unknown, never "in your places"')
        self.assertFalse(feeds.wanted_location({'location': 'Anywhere', 'remote': True}))

    def test_a_named_place_still_counts_before_the_ai_answers(self):
        self.assertTrue(feeds.wanted_location({'location': 'Dublin, Ireland'}))
        self.assertTrue(feeds.wanted_location({'location': 'Remote, Dublin'}), 'it names your place')

    def test_the_ais_answer_decides_a_remote_job(self):
        with mock.patch.object(feeds, 'place_of', side_effect=lambda job: 'in' if 'Ireland' in job['location'] else 'out'):
            self.assertTrue(feeds.wanted_location({'location': 'Remote, Ireland'}))
            self.assertFalse(feeds.wanted_location({'location': 'Remote, Poland'}))
        with mock.patch.object(feeds, 'place_of', return_value='in'):
            self.assertTrue(feeds.wanted_location({'location': 'Remote - Ireland only'}), 'a search that takes remote: the AI placed it in the country')

    def test_without_ai_the_words_stay_the_floor(self):
        with mock.patch.object(feeds, 'placing', return_value=False):
            for where in ('Remote', 'Remote, Europe', 'Anywhere'):
                self.assertTrue(feeds.wanted_location({'location': where, 'remote': True}), where)

    def test_an_unplaced_remote_job_has_its_site_read_again(self):
        job = {'location': 'Remote, Ireland', 'title': 'Clinical Research Nurse'}
        for triaged in ({}, {feeds.ASKED: True}):   # the title sort ran or not: either way its title was never asked (not in your places yet)
            with mock.patch.object(feeds, '_triaged', return_value=dict(triaged)), mock.patch.object(feed_facts, '_triage_on', return_value=True):
                self.assertFalse(feed_facts.settled(job), f'not placed, title not judged: the next run reads the list again ({triaged})')
        with mock.patch.object(feeds, '_triaged', return_value={feeds.ASKED: True}), mock.patch.object(feeds, 'judged_title', return_value=False):
            self.assertTrue(feed_facts.settled(job), 'a title the AI judged not this search\'s needs no place')

    def test_an_unplaced_remote_job_with_a_judged_title_stays_open(self):
        job = {'location': 'Remote, Ireland', 'title': 'Staff Nurse'}
        with mock.patch.object(feeds, 'wanted_title', return_value=True), mock.patch.object(feeds, 'judged_title', return_value=True):
            self.assertTrue(feeds.keep_open(job), 'waits for its place (place_open_jobs), is not closed as outside your places')

    def test_an_employer_hiring_remote_is_still_read(self):
        index = [{'company': 'remote-first', 'places': ['Remote - EMEA']}, {'company': 'elsewhere', 'places': ['Austin, Texas']}]
        kept = employer_index.relevant(index, feeds.could_be_in_places)   # it only says which sites to read: remote not placed yet still counts
        self.assertEqual([feed['company'] for feed in kept], ['remote-first'])


class RemoteIsAskedTest(unittest.TestCase):
    """sa's check (10 Nov 2026): an unplaced remote job is unknown, so the AI must be ASKED about it, or it stays unknown for everyone, a person who accepts remote too."""
    def test_remote_in_the_country_is_listed_and_remote_poland_is_not_for_a_dublin_search_that_takes_remote(self):
        from src.ai import engine, place_triage
        asked, title = [], 'Senior Clinical Research Associate'   # a title the role words ("registered nurse") miss
        jobs = [{'location': 'Remote - Irish residents', 'title': title}, {'location': 'Remote, Poland', 'title': title}]   # the place words name neither

        def decide(locations, search, client=None):
            asked.extend(locations)
            return {loc: 'in' if 'irish' in loc else 'out' for loc in locations}
        with mock.patch.object(feeds, 'PLACE', DUBLIN), mock.patch.object(feeds, 'REMOTE_WANTED', True), mock.patch.object(feeds, 'TRIAGED', {}), \
                mock.patch.object(feeds, 'PLACED', {}), mock.patch.object(engine, 'ready', return_value=True), mock.patch.object(feeds, 'TITLES', feeds.keyword_regex(['registered nurse'])), \
                mock.patch.object(place_triage, 'decide', decide), mock.patch.object(place_triage, 'vague', lambda *a, **k: {}):
            self.assertEqual([feeds.wanted_location(job) for job in jobs], [False, False], 'unknown before the AI answers')
            feeds.triage_places(jobs)
            self.assertEqual(sorted(asked), ['remote - irish residents', 'remote, poland'], 'the AI is asked about both, whatever the title words say')
            self.assertEqual([feeds.wanted_location(job) for job in jobs], [True, False])


if __name__ == '__main__':
    unittest.main()
