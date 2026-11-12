"""Job aggregators with public APIs (src/sources/aggregators.py) and role words in other languages (src/coverage.py LOCAL_VOCAB). No network."""
import io
import json
import sqlite3
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from src import coverage  # noqa: E402
from src.ai import decide  # noqa: E402
from src.sources import aggregators, feeds  # noqa: E402
from src.sources import careers  # noqa: E402

_READER = careers.READER


_DATA = []   # this file's own data folder: nothing it writes lands in the checkout's data/ (tests/unit/ai/test_jobs_db_follows_data.py)


def setUpModule():   # no test here reaches a real model through a page read (guard: tests/unit/sources/test_found_boards_ai.py)
    careers.READER = None
    import tempfile
    _DATA.append(tempfile.TemporaryDirectory())
    _DATA.append(mock.patch('src.paths.DATA', Path(_DATA[0].name)))
    _DATA[1].start()


def tearDownModule():
    careers.READER = _READER
    _DATA[1].stop()
    _DATA[0].cleanup()


NOW = datetime(2026, 10, 3, 12, tzinfo=timezone.utc)
TITLE, PLACE = 'Site Reliability Engineer / Data Analyst', 'Zürich, Switzerland; Amsterdam, Netherlands'   # matches the example search and the owner's


LISTING = ('<html><head><script type="application/ld+json">' + json.dumps({'@context': 'https://schema.org', '@graph': [
    {'@type': 'JobPosting', 'title': 'Dipl. Pflegefachperson 60- 100%', 'datePosted': '2026-10-02T13:02:12+02:00', 'description': '<b>Wir suchen</b> Pflegefachpersonen',
     'url': 'https://www.jobs.ch/en/vacancies/detail/7b196f02-5316-44a8-b583-893ead3e1111/?source=vacancy_search', 'hiringOrganization': {'@type': 'Organization', 'name': 'Senevita'},
     'jobLocation': {'@type': 'Place', 'address': {'@type': 'PostalAddress', 'addressLocality': 'ZH Herrliberg', 'addressCountry': 'CH'}}},
    {'@type': 'JobPosting', 'title': 'Data Analyst', 'datePosted': '2026-10-01', 'url': 'https://www.jobs.ch/en/vacancies/detail/3f461ccc-bb43-4574-874a-cb90d1aaaaaa/',
     'hiringOrganization': {'@type': 'Organization', 'name': 'Acme AG'},
     'jobLocation': [{'@type': 'Place', 'address': {'addressLocality': 'Zürich', 'addressCountry': 'CH'}}, {'@type': 'Place', 'address': {'addressLocality': 'Bern', 'addressCountry': 'CH'}}]},
    {'@type': 'JobPosting', 'title': 'No address job', 'url': 'https://www.jobs.ch/en/vacancies/other/'}]}) + '</script></head><body></body></html>')
SWISS = {'role_keywords': ['data analyst'], 'jobs_board_search_queries': ['data analyst'], 'locations': {'top_tier': ['zurich'], 'country_wide': ['switzerland'], 'abroad': []}}


class SwissPlacesTable(unittest.TestCase):
    def test_it_agrees_with_the_window_on_the_shared_table_of_cases(self):
        from src.sources import boards
        table = json.loads((Path(__file__).resolve().parents[2] / 'fixtures' / 'swiss_cases.json').read_text())['cases']
        for case in table:   # desktop/renderer/audience.js swissPlaces is held to the same rows (desktop/test/unit/renderer/audience.test.js)
            self.assertEqual(boards.swiss_places({'locations': {'top_tier': case['places'], 'country_wide': [], 'abroad': []}}), case['swiss'], case['places'])


class JobsChTests(unittest.TestCase):
    """jobs.ch as a job source for any profession (5 Oct 2026): its robots.txt allows the search pages and disallows the job detail pages."""
    def test_the_search_listing_becomes_jobs_with_their_own_address_and_a_swiss_place(self):
        asked = []
        jobs = aggregators.jobsch(SWISS, lambda url: asked.append(url) or LISTING)
        by_title = {job['title']: job for job in jobs}
        self.assertEqual(sorted(by_title), ['Data Analyst', 'Dipl. Pflegefachperson 60- 100%'])   # a posting with no job address is not a job
        nurse = by_title['Dipl. Pflegefachperson 60- 100%']
        self.assertEqual((nurse['company'], nurse['location'], nurse['date_posted'], nurse['description']), ('Senevita', 'Herrliberg, Switzerland', '2026-10-02', 'Wir suchen Pflegefachpersonen'))
        self.assertTrue(nurse['url'].startswith('https://www.jobs.ch/en/vacancies/detail/7b196f02'))
        self.assertEqual(by_title['Data Analyst']['location'], 'Zürich, Switzerland, Bern, Switzerland')

    def test_only_the_search_pages_are_asked_never_a_job_detail_page(self):
        asked = []
        aggregators.jobsch({**SWISS, 'jobs_board_search_queries': ['data analyst', 'pflegefachperson']}, lambda url: asked.append(url) or LISTING)
        from src.sources import boards
        search = {**SWISS, 'jobs_board_search_queries': ['data analyst', 'pflegefachperson']}
        self.assertEqual(len(asked), len(boards.jobsch_terms(search)) * len(boards.jobsch_places(search)),
                         'each search once in each place: a short page is the last')
        for url in asked:
            self.assertTrue(url.startswith('https://www.jobs.ch/en/vacancies/?term='), url)
            self.assertNotIn('/detail/', url)

    def test_a_search_with_no_swiss_place_asks_nothing(self):
        self.assertEqual(aggregators.jobsch({**SWISS, 'locations': {'top_tier': ['berlin'], 'country_wide': ['germany'], 'abroad': []}}, lambda url: self.fail('jobs.ch was asked')), [])
        self.assertTrue(aggregators.jobsch({**SWISS, 'locations': {'top_tier': ['romandie'], 'country_wide': [], 'abroad': []}}, lambda url: LISTING))   # a Swiss region word counts

    def test_it_is_on_by_default_and_has_its_own_switch(self):
        names = lambda env: [name for name, _ in aggregators.sources(env)]
        self.assertIn('jobs.ch', names({}))
        self.assertNotIn('jobs.ch', names({'JOBADABRA_DISABLE': 'jobsch'}))
        self.assertNotIn('jobs.ch', names({'JOBADABRA_DISABLE': 'aggregators'}))
        self.assertIn('Arbeitnow', names({'JOBADABRA_DISABLE': 'jobsch'}))

    def test_the_scan_keeps_the_matching_ones_named_by_source(self):
        db = sqlite3.connect(':memory:')
        db.execute('CREATE TABLE feed_jobs (board TEXT, id TEXT, fingerprint TEXT, first_seen TEXT, last_seen TEXT, PRIMARY KEY(board, id))')
        listing = LISTING.replace('"Data Analyst"', json.dumps(TITLE))   # the title this machine's own search keeps (see TITLE above)
        report = aggregators.scan(db, SWISS, now=NOW, readers=[('jobs.ch', lambda search: aggregators.jobsch(search, lambda url: listing))])
        titles = [job['title'] for job in report['jobs']]
        self.assertIn(TITLE, titles)
        self.assertNotIn('Dipl. Pflegefachperson 60- 100%', titles)   # not a role of this search
        self.assertEqual(report['jobs'][0]['source'], 'jobs.ch')


class AggregatorTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(feeds.wanted_title(TITLE) and feeds.wanted_location({'location': PLACE}))

    def test_the_end_to_end_fixture_mode_never_reaches_a_live_api(self):
        # 3 Oct 2026: real jobicy rows landed in the e2e quality suite's data. Fixture mode reads files only, like careers.py.
        db = sqlite3.connect(':memory:')
        with mock.patch.dict('os.environ', {'JOBADABRA_FIXTURE_DIR': '/tmp/fixtures'}), mock.patch.object(aggregators, 'sources', side_effect=AssertionError('a live source was asked')):
            self.assertEqual(aggregators.scan(db, {}, now=NOW), {'jobs': [], 'sources': []})
        # a test of scan itself, with its own readers, is unaffected
        with mock.patch.dict('os.environ', {'JOBADABRA_FIXTURE_DIR': '/tmp/fixtures'}):
            self.assertEqual(aggregators.scan(db, {}, now=NOW, readers=[])['jobs'], [])

    def test_the_boards_step_says_when_it_is_done_with_what_it_kept(self):
        # Owner, 26 Oct 2026: the Find card's "Job boards" chip showed ✓ before the boards a web search found were read; it now waits for
        # this line (desktop/renderer/find-card-model.js stepChips), printed once every board and job API is read, also in the fixture mode.
        import contextlib
        import io
        db = sqlite3.connect(':memory:')
        db.row_factory = sqlite3.Row
        jobs = [aggregators._job('x', 1, TITLE, 'Acme', PLACE, 'https://a.example/1')]
        for env, readers in (({}, [('Arbeitnow', lambda search: jobs)]), ({'JOBADABRA_FIXTURE_DIR': '/tmp/fixtures'}, None)):
            out = io.StringIO()
            with mock.patch.dict('os.environ', env), mock.patch.object(feeds, 'record', return_value='new'), contextlib.redirect_stdout(out):
                report = aggregators.scan(db, {}, NOW, readers=readers)
            self.assertEqual(out.getvalue().splitlines()[-1], f"Job boards: done, {len(report['jobs'])} job(s) for your search", env)

    def test_each_free_source_is_read_into_the_common_job_shape_with_its_own_address(self):
        pages = {'arbeitnow': {'data': [{'slug': 's1', 'company_name': 'Acme', 'title': TITLE, 'location': PLACE, 'url': 'https://arbeitnow.example/s1',
                                         'created_at': 1791028823, 'description': '<p>Kubernetes</p>', 'remote': False}]},
                 'himalayas': {'jobs': [{'guid': 'https://himalayas.app/x', 'title': TITLE, 'companyName': 'Beta', 'locationRestrictions': ['Switzerland'],
                                         'applicationLink': 'https://himalayas.app/x', 'pubDate': 1791028823, 'description': 'd'}]},
                 'jobicy': {'jobs': [{'id': 7, 'jobTitle': TITLE, 'companyName': 'Gamma', 'jobGeo': 'EMEA', 'url': 'https://jobicy.com/jobs/7', 'pubDate': '2026-10-01T00:00:00+00:00'}]}}
        get = lambda url, *a: next(v for k, v in pages.items() if k in url)
        job, = aggregators.arbeitnow(lambda url: pages['arbeitnow'] if 'page=1' in url else {'data': []})
        self.assertEqual((job['company'], job['url'], job['description'], job['date_posted']), ('Acme', 'https://arbeitnow.example/s1', 'Kubernetes', '2026-10-03'))
        self.assertEqual(aggregators.himalayas(get)[0]['location'], 'Remote (Switzerland)')
        self.assertEqual(aggregators.jobicy(get, tags=('devops',))[0]['url'], 'https://jobicy.com/jobs/7')

    def test_only_your_roles_and_places_are_kept_each_job_names_its_source_and_a_source_waits_six_hours(self):
        db = sqlite3.connect(':memory:')
        db.row_factory = sqlite3.Row
        jobs = [aggregators._job('x', 1, TITLE, 'Acme', PLACE, 'https://a.example/1'), aggregators._job('x', 2, 'Office Manager', 'Acme', PLACE, 'https://a.example/2'),
                aggregators._job('x', 3, TITLE, 'Acme', 'Tokyo, Japan', 'https://a.example/3')]
        with mock.patch.object(feeds, 'record', return_value='new'):
            report = aggregators.scan(db, {}, NOW, readers=[('Arbeitnow', lambda search: jobs)])
            again = aggregators.scan(db, {}, NOW + timedelta(hours=1), readers=[('Arbeitnow', lambda search: self.fail('too soon'))])
            later = aggregators.scan(db, {}, NOW + timedelta(hours=7), readers=[('Arbeitnow', lambda search: [])])
        self.assertEqual([(j['title'], j['source'], j['notes']) for j in report['jobs']], [(TITLE, 'Arbeitnow', 'Found on Arbeitnow')])
        self.assertEqual(report['sources'], [{'company': 'Arbeitnow', 'ok': True, 'total': 3, 'matches': 1}])
        self.assertEqual(again['sources'], [])
        self.assertEqual(later['sources'][0]['ok'], True)

    def test_a_source_with_jobs_the_ai_has_not_answered_yet_is_read_again_not_rested_six_hours(self):
        """Design rule 6 of WP8 (#3754, wj): a job read but not yet placed or sorted waits; its source is not marked read. Before, `scan` rested the source 6 h
        after listing jobs whose title the AI had not judged yet (stage never_asked, dropped from this run's list), so those jobs came back in 6 h at the soonest."""
        from src.sources import feed_facts
        db = sqlite3.connect(':memory:')
        db.row_factory = sqlite3.Row
        jobs = [aggregators._job('x', 1, TITLE, 'Acme', PLACE, 'https://a.example/1')]
        reads = []
        judged = {}   # the AI's answers for this search: none yet, then this title's
        with mock.patch.object(feeds, 'record', return_value='new'), mock.patch.object(feed_facts, '_triage_on', return_value=True), \
                mock.patch.object(feeds, '_triaged', return_value=judged), mock.patch.object(feeds, 'triage'), mock.patch.object(feeds, 'asked', return_value=True):
            first = aggregators.scan(db, {}, NOW, readers=[('Arbeitnow', lambda search: reads.append(1) or jobs)])
            self.assertEqual((first['jobs'], reads), ([], [1]), 'positive control: the read happened and the unjudged title was not kept')
            judged[feeds.title_key(TITLE)] = True   # the AI answered by the next search
            again = aggregators.scan(db, {}, NOW + timedelta(hours=1), readers=[('Arbeitnow', lambda search: reads.append(2) or jobs)])
            self.assertEqual(reads, [1, 2], 'its jobs wait for their answer: the source is read again at once, not after 6 h')
            self.assertEqual([job['title'] for job in again['jobs']], [TITLE])
            aggregators.scan(db, {}, NOW + timedelta(hours=2), readers=[('Arbeitnow', lambda search: self.fail('every job answered: it rests 6 h'))])

    def test_a_failing_source_is_reported_not_raised(self):
        db = sqlite3.connect(':memory:')
        def broken(search):
            raise OSError('down')
        report = aggregators.scan(db, {}, NOW, readers=[('Jobicy', broken)])
        self.assertEqual(report['sources'], [{'company': 'Jobicy', 'ok': False, 'error': 'OSError: down'}])

    def test_a_source_whose_ai_step_is_refused_fails_alone_and_the_run_goes_on(self):
        """Sentry APP-4B/4A: EURES asked the AI, the API answered 401 (a key it refused), and the error left the guard and ended the whole run."""
        class Refused(Exception):   # stands in for the SDK's AuthenticationError (a status error that is neither a network nor a value error)
            pass
        self.addCleanup(decide.reset_run)   # the refusal is counted as a waiting item; the next test starts clean
        db = sqlite3.connect(':memory:')
        def refused(search):
            raise Refused('invalid x-api-key')
        out = io.StringIO()
        with mock.patch('src.ai.engine.permanent_errors', return_value=(Refused,)), mock.patch('sys.stdout', out), mock.patch('sys.stderr', io.StringIO()):
            report = aggregators.scan(db, {}, NOW, readers=[('EURES', refused), ('Jobicy', lambda search: [])])
        self.assertEqual([(s['company'], s['ok']) for s in report['sources']], [('EURES', False), ('Jobicy', True)])
        self.assertIn('Technical: EURES read: Refused', out.getvalue())

    def test_a_source_whose_answer_was_cut_short_fails_alone(self):
        """Sentry APP-2Y/2Z: a server ended a chunked body early, http.client raised IncompleteRead, and the run ended with a traceback."""
        import http.client
        db = sqlite3.connect(':memory:')
        def cut(search):
            raise http.client.IncompleteRead(b'x' * 10)
        report = aggregators.scan(db, {}, NOW, readers=[('Jobicy', cut), ('Arbeitnow', lambda search: [])])
        self.assertEqual([(s['company'], s['ok']) for s in report['sources']], [('Jobicy', False), ('Arbeitnow', True)])

    def test_the_free_sources_can_be_switched_off_and_eures_is_the_installed_app_only(self):
        names = lambda env: [name for name, _ in aggregators.sources(env)]
        self.assertEqual(names({}), ['Arbeitnow', 'Himalayas', 'Jobicy', 'jobs.ch', 'Platsbanken', 'Le Forem', 'arbeidsplassen.no', 'Job boards found'], 'EURES only in the installed app (owner, 10 Nov 2026)')
        self.assertEqual(names({'JOBADABRA_EURES': '1'}), ['Arbeitnow', 'Himalayas', 'Jobicy', 'jobs.ch', 'EURES', 'Platsbanken', 'Le Forem', 'arbeidsplassen.no', 'Job boards found'])
        self.assertNotIn('Job boards found', names({'JOBADABRA_DISABLE': 'found_boards'}))
        self.assertEqual(names({'JOBADABRA_DISABLE': 'aggregators'}), [])


class LocalLanguageTests(unittest.TestCase):
    def test_role_words_in_other_languages_are_counted_and_make_the_card_speak(self):
        tally = coverage.Tally()
        for title in ('Systemtechniker (m/w/d)', 'ICT Systemtechniker 100%', 'Systemtechniker Cloud', 'Ingénieur système Linux'):
            tally.add(title, in_place=True, matched=False, location='Zürich')
        tally.add('Site Reliability Engineer', in_place=True, matched=True, location='Zürich')
        verdict = coverage.verdict(tally.summary(), ['site reliability'], [])
        first = verdict['suggestions'][0]
        self.assertEqual((first['term'], first['count'], first['local']), ('systemtechniker', 3, True))
        self.assertTrue(verdict['narrow'] and verdict['local'], 'three missed local-language titles are worth saying even when the search is broad')


if __name__ == '__main__':
    unittest.main()


class JobsChRefusalTests(unittest.TestCase):
    def test_a_403_stops_jobs_ch_for_the_run_and_keeps_what_was_read(self):
        import urllib.error
        calls = []
        def fetch(url):
            calls.append(url)
            if len(calls) > 1:
                raise urllib.error.HTTPError(url, 403, 'Forbidden', {}, None)
            return LISTING
        jobs = aggregators.jobsch({**SWISS, 'jobs_board_search_queries': ['data analyst', 'pflegefachperson']}, fetch)
        self.assertEqual(len(calls), 2, 'nothing more is asked after the refusal')
        self.assertTrue(jobs, 'the jobs of the first page are kept')
