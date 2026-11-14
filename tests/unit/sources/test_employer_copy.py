"""A LinkedIn job whose employer's own feed lists it is kept under the employer's address, so Apply opens the employer's page (src/sources/employer_copy.py)."""
import contextlib
import sqlite3
import unittest

from src.sources import employer_copy

LINKEDIN = {'id': 'linkedin:4487877047', 'title': 'Senior Site Reliability / Gitops Engineer', 'company': 'Canonical', 'location': 'Zurich, Zurich, Switzerland',
            'url': 'https://www.linkedin.com/jobs/view/4487877047/', 'date_posted': '2026-11-11', 'description': '', 'remote': False, 'salary': ''}
FEED = [{'id': '5517891', 'title': 'Senior Site Reliability / Gitops Engineer', 'location': 'Home based - Worldwide', 'remote': False, 'salary': '',
         'url': 'https://job-boards.greenhouse.io/canonical/jobs/5517891', 'date_posted': '2026-10-01', 'description': 'Canonical is building...'},
        {'id': '3029798', 'title': 'Senior Site Reliability Engineer', 'location': 'Home based - Worldwide', 'remote': False, 'salary': '',
         'url': 'https://job-boards.greenhouse.io/canonical/jobs/3029798', 'date_posted': '', 'description': ''}]
INDEX = [{'company': 'Canonical', 'ats': 'greenhouse', 'slug': 'canonical'}]


class EmployerCopy(unittest.TestCase):
    def setUp(self):
        self.reads, self.guessed, self.guesses = [], [], []

    def guess(self, company, past_cut=lambda: False):
        self.guesses.append(company)
        return self.guessed

    def fetch(self, feeds):
        def read(ats, slug):
            self.reads.append((ats, slug))
            return feeds
        return read

    def test_the_employers_own_posting_replaces_linkedins_address(self):
        [job] = employer_copy.prefer_employer([LINKEDIN], INDEX, fetch=self.fetch(FEED), log=lambda line: None, guess=self.guess)
        self.assertEqual(job['url'], 'https://job-boards.greenhouse.io/canonical/jobs/5517891')
        self.assertEqual(job['description'], 'Canonical is building...')
        self.assertEqual(job['location'], 'Zurich, Zurich, Switzerland')   # the place LinkedIn listed it for still decides "in your places"
        self.assertIn('also on LinkedIn', job['notes'])

    def test_no_feed_known_or_guessed_keeps_linkedin_and_hands_it_to_the_scout(self):
        noted = []
        [job] = employer_copy.prefer_employer([{**LINKEDIN, 'company': 'Somebody Else'}], INDEX, fetch=self.fetch(FEED), log=lambda line: None, guess=self.guess,
                                              note=lambda jobs, resolved: noted.append(([each['company'] for each in jobs], resolved)))
        self.assertEqual((job['url'], self.reads, self.guesses), (LINKEDIN['url'], [], ['Somebody Else']))
        self.assertEqual(noted, [(['Somebody Else'], [])])

    def test_an_employer_with_a_known_feed_that_lacks_the_job_is_resolved_never_handed_to_the_scout(self):
        noted = []
        [job] = employer_copy.prefer_employer([LINKEDIN], INDEX, fetch=self.fetch([FEED[1]]), log=lambda line: None, guess=self.guess,
                                              note=lambda jobs, resolved: noted.append(([each['company'] for each in jobs], resolved)))
        self.assertEqual((job['url'], noted), (LINKEDIN['url'], [([], ['Canonical'])]))

    def test_an_employer_whose_guessed_feed_lacks_the_job_is_resolved_too(self):
        noted, self.guessed = [], [('greenhouse', 'canonical', [FEED[1]])]
        employer_copy.prefer_employer([LINKEDIN], [], fetch=self.fetch([]), log=lambda line: None, guess=self.guess,
                                      note=lambda jobs, resolved: noted.append(([each['company'] for each in jobs], resolved)))
        self.assertEqual(noted, [([], ['Canonical'])])

    def test_no_guess_try_starts_after_the_read_cut(self):
        tried, cut = [], [False]

        def probe(system, slug):
            tried.append(slug)
            cut[0] = True   # the cut passes while the first tries run
            return None
        employer_copy.guess_feed('Canonical Ltd', probe=probe, past_cut=lambda: cut[0])
        self.assertLess(len(tried), 2 * len(employer_copy.ats.GUESSABLE))

    def test_a_feed_guessed_by_name_that_holds_the_job_moves_it_and_is_registered(self):
        kept = []
        self.guessed = [('lever', 'canonical', [FEED[1]]), ('greenhouse', 'canonical', FEED)]
        [job] = employer_copy.prefer_employer([LINKEDIN], [], fetch=self.fetch(FEED), log=lambda line: None, guess=self.guess,
                                              register=lambda *feed: kept.append(feed))
        self.assertEqual((job['url'], kept), (FEED[0]['url'], [('Canonical', 'greenhouse', 'canonical')]))

    def test_a_guessed_feed_without_the_job_is_another_company_and_never_kept(self):
        kept = []
        self.guessed = [('greenhouse', 'canonical', [FEED[1]])]
        [job] = employer_copy.prefer_employer([LINKEDIN], [], fetch=self.fetch(FEED), log=lambda line: None, guess=self.guess,
                                              register=lambda *feed: kept.append(feed))
        self.assertEqual((job['url'], kept), (LINKEDIN['url'], []))

    def test_at_most_the_guess_limit_of_employers_are_looked_up_by_name(self):
        jobs = [{**LINKEDIN, 'company': f'Firm {n}', 'id': f'linkedin:{n}{k}'} for n in range(8) for k in range(2)]
        employer_copy.prefer_employer(jobs, [], fetch=self.fetch([]), log=lambda line: None, guess=self.guess)
        self.assertEqual(len(self.guesses), employer_copy.MAX_GUESSES)

    def test_guess_feed_tries_the_whole_name_on_each_common_job_system(self):
        tried = []
        found = employer_copy.guess_feed('Canonical Ltd', probe=lambda system, slug: tried.append((system, slug)) or (FEED if system == 'ashby' else None))
        self.assertEqual(found, [('ashby', 'canonical', FEED)])
        self.assertEqual({system for system, slug in tried}, set(employer_copy.ats.GUESSABLE))

    def test_two_feed_jobs_with_that_title_are_not_guessed_between(self):
        feed = [FEED[0], {**FEED[0], 'id': '9', 'url': 'https://job-boards.greenhouse.io/canonical/jobs/9', 'location': 'Remote - Anywhere'}]
        [job] = employer_copy.prefer_employer([LINKEDIN], INDEX, fetch=self.fetch(feed), log=lambda line: None, guess=self.guess)
        self.assertEqual(job['url'], LINKEDIN['url'])

    def test_a_feed_job_in_another_named_city_is_not_this_job(self):
        feed = [{**FEED[0], 'location': 'Office Based - London, UK'}]
        [job] = employer_copy.prefer_employer([LINKEDIN], INDEX, fetch=self.fetch(feed), log=lambda line: None, guess=self.guess)
        self.assertEqual(job['url'], LINKEDIN['url'])

    def test_a_remote_job_open_to_another_region_is_not_this_job(self):
        for place in ('Remote - USA', 'Remote, Canada', 'Home Based - APAC'):
            with self.subTest(place):
                [job] = employer_copy.prefer_employer([LINKEDIN], INDEX, fetch=self.fetch([{**FEED[0], 'location': place}]), log=lambda line: None, guess=self.guess)
                self.assertEqual(job['url'], LINKEDIN['url'])

    def test_a_remote_job_naming_linkedins_country_is_this_job(self):
        [job] = employer_copy.prefer_employer([LINKEDIN], INDEX, fetch=self.fetch([{**FEED[0], 'location': 'Remote, Switzerland'}]), log=lambda line: None, guess=self.guess)
        self.assertEqual(job['url'], FEED[0]['url'])

    def test_a_moved_job_carries_no_linkedin_apply_route(self):
        [job] = employer_copy.prefer_employer([{**LINKEDIN, 'apply_route': 'linkedin'}], INDEX, fetch=self.fetch(FEED), log=lambda line: None, guess=self.guess)
        self.assertEqual(job['url'], FEED[0]['url'])
        self.assertNotIn('apply_route', job)

    def test_an_employer_named_by_its_first_words_finds_its_feed(self):
        [job] = employer_copy.prefer_employer([{**LINKEDIN, 'company': 'Canonical Group Ltd'}], [{'company': 'Canonical Group Limited UK', 'ats': 'greenhouse', 'slug': 'canonical'}],
                                              fetch=self.fetch(FEED), log=lambda line: None, guess=self.guess)
        self.assertEqual((self.reads, job['url']), ([('greenhouse', 'canonical')], FEED[0]['url']))

    def test_a_two_letter_state_is_not_read_as_a_country(self):
        listed = {**LINKEDIN, 'location': 'New York, NY'}
        [job] = employer_copy.prefer_employer([listed], INDEX, fetch=self.fetch([{**FEED[0], 'location': 'Remote - NY'}]), log=lambda line: None, guess=self.guess)
        self.assertEqual(job['url'], LINKEDIN['url'])

    def test_no_feed_starts_after_the_read_cut(self):
        [job] = employer_copy.prefer_employer([LINKEDIN], INDEX, fetch=self.fetch(FEED), log=lambda line: None, past_cut=lambda: True, guess=self.guess)
        self.assertEqual((job['url'], self.reads, self.guesses), (LINKEDIN['url'], [], []))

    def test_a_company_with_two_feeds_has_the_second_read_when_the_first_lacks_the_job(self):
        feeds = {'old': [FEED[1]], 'new': FEED}
        index = [{'company': 'Canonical', 'ats': 'greenhouse', 'slug': 'old'}, {'company': 'Canonical', 'ats': 'ashby', 'slug': 'new'}]
        [job] = employer_copy.prefer_employer([LINKEDIN], index, fetch=lambda system, slug: feeds[slug], log=lambda line: None, guess=self.guess)
        self.assertEqual(job['url'], FEED[0]['url'])

    def test_linkedins_city_anywhere_in_the_feed_place_agrees(self):
        [job] = employer_copy.prefer_employer([LINKEDIN], INDEX, fetch=self.fetch([{**FEED[0], 'location': 'In office - Zürich'}]), log=lambda line: None, guess=self.guess)
        self.assertEqual(job['url'], FEED[0]['url'])

    def test_one_posting_listed_twice_by_a_careers_page_is_one_job(self):
        [job] = employer_copy.prefer_employer([LINKEDIN], INDEX, fetch=self.fetch([{**FEED[0], 'location': ''}, {**FEED[0], 'location': ''}]), log=lambda line: None, guess=self.guess)
        self.assertEqual(job['url'], FEED[0]['url'])

    def test_a_known_feed_without_the_job_still_lets_the_name_be_tried(self):
        self.guessed = [('ashby', 'canonical', FEED)]
        [job] = employer_copy.prefer_employer([LINKEDIN], INDEX, fetch=self.fetch([FEED[1]]), log=lambda line: None, guess=self.guess)
        self.assertEqual((job['url'], self.guesses), (FEED[0]['url'], ['Canonical']))

    def test_a_feed_that_fails_keeps_linkedin(self):
        [job] = employer_copy.prefer_employer([LINKEDIN], INDEX, fetch=self.fetch(None), log=lambda line: None, guess=self.guess)
        self.assertEqual(job['url'], LINKEDIN['url'])

    def test_each_feed_is_read_once_and_at_most_the_limit_of_employers(self):
        index = [{'company': f'Firm {n}', 'ats': 'greenhouse', 'slug': f'firm{n}'} for n in range(8)]
        jobs = [{**LINKEDIN, 'company': f'Firm {n}', 'id': f'linkedin:{n}{k}'} for n in range(8) for k in range(2)]
        employer_copy.prefer_employer(jobs, index, fetch=self.fetch([]), log=lambda line: None, guess=self.guess)
        self.assertEqual(len(self.reads), employer_copy.MAX_EMPLOYERS)
        self.assertEqual(len(set(self.reads)), len(self.reads))


class LinkedInRow(unittest.TestCase):
    def read(self, disable='', note=None, locked=False):
        """LinkedIn's reader row on a temporary jobs file: {job, reads, loads, feeds: [(ats, slug, company, added_at)], notes}."""
        import tempfile
        from contextlib import closing
        from pathlib import Path
        from unittest import mock
        from src import store
        from src.sources import reader_rows
        with tempfile.TemporaryDirectory() as folder, mock.patch('src.paths.DATA', Path(folder)), \
                mock.patch('src.sources.linkedin_guest.read', return_value=[LINKEDIN]), mock.patch('src.employer_index.load', return_value=INDEX) as load, \
                mock.patch('src.sources.ats.probe', side_effect=lambda system, slug: FEED if system == 'greenhouse' else None) as probe, \
                mock.patch('src.sources.board_employers.note', side_effect=note) as noted, \
                mock.patch.dict('os.environ', {'JOBADABRA_DISABLE': disable, 'JOBADABRA_FIXTURE_DIR': ''}):
            with mock.patch('src.store.connect', side_effect=sqlite3.OperationalError('database is locked')) if locked else contextlib.nullcontext():
                [job] = reader_rows._linkedin_read(None, {})
            with closing(store.connect(Path(folder) / 'jobs.sqlite')) as db:
                from src import scout_core
                scout_core.ensure_tables(db)
                feeds = [tuple(row) for row in db.execute('SELECT ats, slug, company, added_at FROM feed_sources')]
        return {'job': job, 'reads': probe.call_count, 'loads': load.call_count, 'feeds': feeds, 'notes': noted.call_count}

    def test_linkedins_reader_row_hands_out_the_employers_address(self):
        got = self.read()
        self.assertEqual((got['job']['url'], got['reads'], got['feeds'], got['notes']), ('https://job-boards.greenhouse.io/canonical/jobs/5517891', 1, [], 1))   # one call: Canonical resolved (its flag cleared)

    def test_with_the_index_off_the_row_finds_the_feed_by_name_and_keeps_it(self):
        got = self.read(disable='index')
        self.assertEqual((got['job']['url'], got['loads'], [feed[:3] for feed in got['feeds']]),
                         ('https://job-boards.greenhouse.io/canonical/jobs/5517891', 0, [('greenhouse', 'canonical', 'Canonical')]))

    def test_a_kept_feed_is_dated_like_every_other_feed_source(self):
        [(*_, added_at)] = self.read(disable='index')['feeds']
        self.assertRegex(added_at, r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00$')

    def test_a_locked_jobs_file_never_costs_the_jobs_read(self):
        got = self.read(locked=True)
        self.assertEqual((got['job']['url'], got['feeds']), ('https://job-boards.greenhouse.io/canonical/jobs/5517891', []))

    def test_a_scout_file_that_cannot_be_written_never_costs_the_jobs_read(self):
        got = self.read(disable='index', note=OSError('read-only'))
        self.assertEqual(got['job']['url'], 'https://job-boards.greenhouse.io/canonical/jobs/5517891')


if __name__ == '__main__':
    unittest.main()
