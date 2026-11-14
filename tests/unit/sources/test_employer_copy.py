"""A LinkedIn job whose employer's own feed lists it is kept under the employer's address, so Apply opens the employer's page (src/sources/employer_copy.py)."""
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
        self.reads = []

    def fetch(self, feeds):
        def read(ats, slug):
            self.reads.append((ats, slug))
            return feeds
        return read

    def test_the_employers_own_posting_replaces_linkedins_address(self):
        [job] = employer_copy.prefer_employer([LINKEDIN], INDEX, fetch=self.fetch(FEED), log=lambda line: None)
        self.assertEqual(job['url'], 'https://job-boards.greenhouse.io/canonical/jobs/5517891')
        self.assertEqual(job['description'], 'Canonical is building...')
        self.assertEqual(job['location'], 'Zurich, Zurich, Switzerland')   # the place LinkedIn listed it for still decides "in your places"
        self.assertIn('also on LinkedIn', job['notes'])

    def test_no_feed_in_the_index_keeps_linkedin_and_reads_nothing(self):
        [job] = employer_copy.prefer_employer([{**LINKEDIN, 'company': 'Somebody Else'}], INDEX, fetch=self.fetch(FEED), log=lambda line: None)
        self.assertEqual(job['url'], LINKEDIN['url'])
        self.assertEqual(self.reads, [])

    def test_two_feed_jobs_with_that_title_are_not_guessed_between(self):
        feed = [FEED[0], {**FEED[0], 'id': '9', 'url': 'https://job-boards.greenhouse.io/canonical/jobs/9', 'location': 'Remote - Anywhere'}]
        [job] = employer_copy.prefer_employer([LINKEDIN], INDEX, fetch=self.fetch(feed), log=lambda line: None)
        self.assertEqual(job['url'], LINKEDIN['url'])

    def test_a_feed_job_in_another_named_city_is_not_this_job(self):
        feed = [{**FEED[0], 'location': 'Office Based - London, UK'}]
        [job] = employer_copy.prefer_employer([LINKEDIN], INDEX, fetch=self.fetch(feed), log=lambda line: None)
        self.assertEqual(job['url'], LINKEDIN['url'])

    def test_a_remote_job_open_to_another_region_is_not_this_job(self):
        for place in ('Remote - USA', 'Remote, Canada', 'Home Based - APAC'):
            with self.subTest(place):
                [job] = employer_copy.prefer_employer([LINKEDIN], INDEX, fetch=self.fetch([{**FEED[0], 'location': place}]), log=lambda line: None)
                self.assertEqual(job['url'], LINKEDIN['url'])

    def test_a_remote_job_naming_linkedins_country_is_this_job(self):
        [job] = employer_copy.prefer_employer([LINKEDIN], INDEX, fetch=self.fetch([{**FEED[0], 'location': 'Remote, Switzerland'}]), log=lambda line: None)
        self.assertEqual(job['url'], FEED[0]['url'])

    def test_a_moved_job_carries_no_linkedin_apply_route(self):
        [job] = employer_copy.prefer_employer([{**LINKEDIN, 'apply_route': 'linkedin'}], INDEX, fetch=self.fetch(FEED), log=lambda line: None)
        self.assertEqual(job['url'], FEED[0]['url'])
        self.assertNotIn('apply_route', job)

    def test_an_employer_named_by_its_first_words_finds_its_feed(self):
        [job] = employer_copy.prefer_employer([{**LINKEDIN, 'company': 'Canonical Group Ltd'}], [{'company': 'Canonical Group Limited UK', 'ats': 'greenhouse', 'slug': 'canonical'}],
                                              fetch=self.fetch(FEED), log=lambda line: None)
        self.assertEqual(self.reads, [('greenhouse', 'canonical')])

    def test_no_feed_starts_after_the_read_cut(self):
        [job] = employer_copy.prefer_employer([LINKEDIN], INDEX, fetch=self.fetch(FEED), log=lambda line: None, past_cut=lambda: True)
        self.assertEqual((job['url'], self.reads), (LINKEDIN['url'], []))

    def test_a_feed_that_fails_keeps_linkedin(self):
        [job] = employer_copy.prefer_employer([LINKEDIN], INDEX, fetch=self.fetch(None), log=lambda line: None)
        self.assertEqual(job['url'], LINKEDIN['url'])

    def test_each_feed_is_read_once_and_at_most_the_limit_of_employers(self):
        index = [{'company': f'Firm {n}', 'ats': 'greenhouse', 'slug': f'firm{n}'} for n in range(8)]
        jobs = [{**LINKEDIN, 'company': f'Firm {n}', 'id': f'linkedin:{n}{k}'} for n in range(8) for k in range(2)]
        employer_copy.prefer_employer(jobs, index, fetch=self.fetch([]), log=lambda line: None)
        self.assertEqual(len(self.reads), employer_copy.MAX_EMPLOYERS)
        self.assertEqual(len(set(self.reads)), len(self.reads))


class LinkedInRow(unittest.TestCase):
    def read(self, disable=''):
        from unittest import mock
        from src.sources import reader_rows
        with mock.patch('src.sources.linkedin_guest.read', return_value=[LINKEDIN]), mock.patch('src.employer_index.load', return_value=INDEX), \
                mock.patch('src.sources.ats.probe', return_value=FEED) as probe, mock.patch.dict('os.environ', {'JOBADABRA_DISABLE': disable, 'JOBADABRA_FIXTURE_DIR': ''}):
            [job] = reader_rows._linkedin_read(None, {})
        return job, probe.call_count

    def test_linkedins_reader_row_hands_out_the_employers_address(self):
        job, reads = self.read()
        self.assertEqual((job['url'], reads), ('https://job-boards.greenhouse.io/canonical/jobs/5517891', 1))

    def test_with_the_index_off_linkedins_row_reads_no_feed(self):
        job, reads = self.read(disable='index')
        self.assertEqual((job['url'], reads), (LINKEDIN['url'], 0))


if __name__ == '__main__':
    unittest.main()
