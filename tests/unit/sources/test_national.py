"""National employment services (src/sources/national.py): Sweden's and Belgium's public feeds are read for a person with a place in that country, by their place's
point and radius, from recorded answers (tests/fixtures/sources/platsbanken-stockholm.json, forem-brussels.json: each feed's shape, employers made up), and each is
one of the free job APIs. No network, no AI."""
import io
import json
import unittest
import urllib.error
import urllib.parse
from pathlib import Path
from unittest import mock

from src import geo, time_budget
from src.notion.search_settings import fragment_of
from src.sources import aggregators, api_lane, national, reader_rows

ROOT = Path(__file__).resolve().parents[3]
ANSWER = json.loads((ROOT / 'tests' / 'fixtures' / 'sources' / 'platsbanken-stockholm.json').read_text())
FOREM = json.loads((ROOT / 'tests' / 'fixtures' / 'sources' / 'forem-brussels.json').read_text())
SWEDEN, BELGIUM = national.SERVICES
RECORDED = {'Platsbanken': (ANSWER, 'Stockholm'), 'Le Forem': (FOREM, 'Brussels')}   # each service's recorded answer and the place it was asked for: a new row adds its own
MAP = {'stockholm': {'kind': 'city', 'cc': 'SE', 'lat': 59.33, 'lon': 18.07, 'r': 30}, 'sweden': {'kind': 'country', 'cc': 'SE', 'lat': 0, 'lon': 0, 'r': 0},
       'lyon': {'kind': 'city', 'cc': 'FR', 'lat': 45.76, 'lon': 4.84, 'r': 30}, 'brussels': {'kind': 'city', 'cc': 'BE', 'lat': 50.85, 'lon': 4.35, 'r': 30}}


def search(*places, words=('Customer Support Agent',), boards=('kundtjänst',)):
    """A search as the app stores it: regex fragments (an accented word with its letter choice, kundtj[aä]nst)."""
    stored = lambda items: [fragment_of(item) for item in items]
    return {'role_keywords': stored(words), 'jobs_board_search_queries': stored(boards), 'locations': {'top_tier': stored(places), 'country_wide': [], 'abroad': []}}


def asked(url):
    """The query of one asked page, as {name: value}."""
    return dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(url).query))


class Feed:
    """The feed: `pages` answers in turn (the recorded one by default), each asked URL kept; an exception in `pages` is raised for that page."""
    def __init__(self, *pages):
        self.pages, self.urls = list(pages), []

    def __call__(self, url, data=None, headers=None, timeout=None):
        self.urls.append(url)
        page = self.pages.pop(0) if self.pages else ANSWER
        if isinstance(page, Exception):
            raise page
        return page


class NationalTest(unittest.TestCase):
    def setUp(self):
        resolve = mock.patch.object(geo, 'resolve', lambda words, client=None, ask=True, share=False: {geo.norm(w): MAP[geo.norm(w)] for w in words if geo.norm(w) in MAP})
        resolve.start()
        self.addCleanup(resolve.stop)
        quiet = mock.patch('sys.stdout', new_callable=io.StringIO)
        self.out = quiet.start()
        self.addCleanup(quiet.stop)

    def test_a_stockholm_search_lists_swedens_public_ads_near_stockholm(self):
        feed = Feed()
        jobs = national.read(SWEDEN, search('Stockholm'), get=feed)
        self.assertEqual([asked(url)['q'] for url in feed.urls], ['kundtjänst', 'Customer Support Agent'], 'the board searches, then the role words, each once')
        self.assertEqual({(asked(url)['position'], asked(url)['position.radius']) for url in feed.urls}, {('59.33,18.07', '30')}, "the place's own point and radius")
        self.assertTrue(all(url.startswith('https://jobsearch.api.jobtechdev.se/search?') for url in feed.urls))
        self.assertEqual([(j['title'], j['company'], j['location']) for j in jobs], [
            ('Kundtjänstmedarbetare', 'Example Support A AB', 'Stockholm, Sweden'), ('Kundsupport med svenska och engelska', 'Example Support B AB', 'Solna, Sweden'),
            ('Customer Support Agent', 'Example Support C AB', 'Stockholm, Sweden'), ('Kundtjänst till vårt kontor', 'Example Support D AB', 'Linköping, Sweden')],
            'listed as given, once each: whether Linköping is in your places is the place check\'s, not the reader\'s')
        self.assertEqual(jobs[0]['url'], 'https://arbetsformedlingen.se/platsbanken/annonser/90000001')
        self.assertEqual(jobs[0]['date_posted'], '2026-11-01')

    def test_a_person_with_no_place_in_sweden_asks_nothing(self):
        feed = Feed()
        self.assertEqual(national.read(SWEDEN, search('Lyon'), get=feed), [])
        self.assertEqual(feed.urls, [])

    def test_the_country_word_alone_asks_the_whole_country_and_a_town_wins_over_it(self):
        feed = Feed()
        national.read(SWEDEN, search('Sweden'), get=feed)
        self.assertTrue(feed.urls and not any('position' in asked(url) for url in feed.urls), 'all of Sweden: no point')
        feed = Feed()
        national.read(SWEDEN, search('Stockholm', 'Sweden'), get=feed)
        self.assertTrue(all('position' in asked(url) for url in feed.urls), 'a town named in the country: only near it')

    def test_every_words_first_page_goes_before_any_second_page_and_a_short_page_ends_its_word(self):
        full = {'total': {'value': 250}, 'hits': [{**ANSWER['hits'][0], 'id': str(n), 'webpage_url': f'https://example.test/{n}'} for n in range(100)]}
        feed = Feed(full, ANSWER, ANSWER)
        national.read(SWEDEN, search('Stockholm'), get=feed)
        self.assertEqual([(asked(url)['q'], asked(url)['offset']) for url in feed.urls], [('kundtjänst', '0'), ('Customer Support Agent', '0'), ('kundtjänst', '100')])

    def test_a_refusal_first_is_the_source_failing_and_later_keeps_what_was_read(self):
        refused = urllib.error.HTTPError('https://jobsearch.api.jobtechdev.se/search', 403, 'Forbidden', {}, None)
        feed = Feed(refused)
        with self.assertRaises(urllib.error.HTTPError):
            national.read(SWEDEN, search('Stockholm'), get=feed)
        self.assertEqual(len(feed.urls), 1, 'a 403 is never asked again')
        feed = Feed(ANSWER, refused)
        self.assertEqual(len(national.read(SWEDEN, search('Stockholm'), get=feed)), 4)
        self.assertEqual(len(feed.urls), 2, 'nothing more asked after the refusal')
        self.assertIn('Platsbanken: stopped (HTTPError 403), keeping the 4 read', self.out.getvalue())

    def test_a_brussels_search_lists_le_forems_offers_near_brussels(self):
        feed = Feed(FOREM, FOREM)
        jobs = national.read(BELGIUM, search('Brussels', words=('Menuisier',), boards=('schrijnwerker',)), get=feed)
        self.assertEqual([asked(url)['where'] for url in feed.urls], [
            f'search("{word}") and within_distance(lieuxtravailgeo, geom\'POINT(4.35 50.85)\', 30km)' for word in ('schrijnwerker', 'Menuisier')], "the words in the search's own languages, near the place's point")
        self.assertTrue(all(url.startswith('https://www.odwb.be/api/explore/v2.1/catalog/datasets/offres-d-emploi-forem/records?') for url in feed.urls))
        self.assertEqual([(j['title'], j['company'], j['location']) for j in jobs], [
            ('Menuisier (H/F/X)', 'Example Wood A', 'Wavre, Belgium'), ('Menuisier poseur', 'Example Wood B', 'Nivelles, Belgium'),
            ('Schrijnwerker / Menuisier', 'Example Wood C', 'Neder-Over-Heembeek, Belgium'), ("Menuisier d'atelier", 'Example Wood D', 'Belgium')])
        self.assertEqual(jobs[0]['url'], 'https://www.leforem.be/recherche-offres/offre-detail/9000001', "the offer's own page: the licence's attribution goes with each job")

    def test_each_service_asks_only_for_its_own_country_and_keeps_each_jobs_posting_date(self):
        self.assertEqual(sorted(RECORDED), sorted(service.name for service in national.SERVICES), 'a new row adds its recorded answer to RECORDED')
        for service in national.SERVICES:
            answer, place = RECORDED[service.name]
            with self.subTest(service.name):
                elsewhere = Feed()
                self.assertEqual(national.read(service, search('Lyon'), get=elsewhere), [])
                self.assertEqual(elsewhere.urls, [], 'a person with no place in its country is not asked about')
                jobs = national.read(service, search(place), get=Feed(answer, answer))
                self.assertTrue(jobs and all(job['date_posted'][:4] == '2026' for job in jobs), 'the posting date stays on each job: how many a repeat search adds needs it')

    def test_no_page_is_asked_past_the_read_cut_less_its_grace(self):
        feed = Feed()
        with mock.patch('src.sources.read_budget.cut_at', return_value=100.0), mock.patch.object(time_budget, 'now', return_value=100.0):
            self.assertEqual(national.read(SWEDEN, search('Stockholm'), get=feed), [])
        self.assertEqual(feed.urls, [])


class InTheFreeApisTest(unittest.TestCase):
    def test_it_is_a_free_job_api_wherever_they_are_without_eures_and_has_its_own_switch(self):
        self.assertIn('Platsbanken', [name for name, _ in aggregators.sources({})], 'from source and on CI too, EURES off')
        row = next(row for row in reader_rows.ROWS if row.name == 'Platsbanken')
        self.assertEqual(row.lane, 'free_job_apis')
        for off in ({'JOBADABRA_DISABLE': 'national'}, {'JOBADABRA_DISABLE': 'aggregators'}):
            with self.subTest(off=off):
                self.assertNotIn('Platsbanken', [name for name, _ in aggregators.sources(off)])
        self.assertNotIn('Platsbanken', api_lane.NOT_HERE, 'the lane asks it at second 0')

    def test_each_row_reads_its_service_through_national_read(self):
        for service in national.SERVICES:
            with self.subTest(service.name), mock.patch.object(national, 'read', return_value=['job']) as read:
                self.assertEqual(dict(aggregators.sources({}))[service.name]({'role_keywords': ['x']}), ['job'])
            read.assert_called_once_with(service, {'role_keywords': ['x']})


if __name__ == '__main__':
    unittest.main()
