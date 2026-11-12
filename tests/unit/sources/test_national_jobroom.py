"""Switzerland's public job platform (Job-Room, SECO/RAV) as one of the national services (src/sources/national.py): read at its public search's own undocumented
address, from a recorded answer shape (tests/fixtures/sources/jobroom-zurich.json: ads and employers made up). Owner, 12 Nov 2026, asked via AskUserQuestion by sa:
"Read it now"; typed: "Let's try to read. ONly if we'll get 401 or 403, we'll ask for permission". No network, no AI."""
import json
import tempfile
import unittest
import urllib.error
import urllib.parse
from pathlib import Path
from unittest import mock

from src.sources import host_pace, national
from tests.unit.sources.test_national import Placed, ROOT, search

JOBROOM = next(service for service in national.SERVICES if service.name == 'Job-Room')
RECORDED = json.loads((ROOT / 'tests' / 'fixtures' / 'sources' / 'jobroom-zurich.json').read_text())


class Feed:
    """The page fetch: answers in turn, each asked request kept (an exception is raised for that page)."""
    def __init__(self, *pages):
        self.pages, self.sent = list(pages), []

    def __call__(self, request):
        self.sent.append(request)
        page = self.pages.pop(0) if self.pages else RECORDED
        if isinstance(page, Exception):
            raise page
        return page


class Response:
    def __init__(self, body, total=None, status=200):
        self.body, self.status = json.dumps(body).encode(), status
        self.headers = {'x-total-count': str(total)} if total is not None else {}

    def read(self, *args):
        return self.body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class JobRoomTest(Placed):
    def setUp(self):
        super().setUp()
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.kept = Path(folder.name) / 'jobroom_refused.json'
        refused = mock.patch.object(national, '_jobroom_refused', return_value=self.kept)
        refused.start()
        self.addCleanup(refused.stop)

    def test_a_zurich_search_asks_job_rooms_search_by_point_and_radius_and_lists_the_ads_in_switzerland(self):
        feed = Feed()
        jobs = national.read(JOBROOM, search('Zurich'), get=feed)
        request = feed.sent[0]
        body = json.loads(request.data)
        self.assertEqual((request.get_method(), request.full_url.split('?')[0]), ('POST', 'https://www.job-room.ch/jobadservice/api/jobAdvertisements/_search'))
        self.assertEqual(urllib.parse.parse_qs(urllib.parse.urlsplit(request.full_url).query), {'page': ['0'], 'size': ['100'], 'sort': ['date_desc']})
        self.assertEqual((body['keywords'], body['radiusSearchRequest'], body['displayRestricted']), (['kundtjänst'], {'geoPoint': {'lat': 47.37, 'lon': 8.54}, 'distance': 30}, False))
        self.assertEqual([json.loads(r.data)['keywords'] for r in feed.sent], [['kundtjänst'], ['Customer Support Agent']], 'the board searches, then the role words')
        self.assertEqual([(j['title'], j['company'], j['location'], j['date_posted']) for j in jobs], [
            ('Lagerist/-in 100%', 'Example Logistik AG', 'Dietikon, Switzerland', '2026-11-10'), ('Allrounder Logistik', 'Example Personal AG', 'Baden, Switzerland', '2026-11-09'),
            ('Magazin Assistent', 'Unknown employer', 'Anonymous, Switzerland', '2026-11-10')],
            'highlight marks removed; an ad outside Switzerland, or with no real id, is dropped; an anonymous employer is not named')
        self.assertEqual(jobs[0]['url'], 'https://www.job-room.ch/job-search/00000000-0000-4000-8000-000000000001', "the ad's own page at Job-Room")

    def test_no_ad_text_is_kept_and_the_client_is_honest_with_no_cookie_or_key(self):
        jobs = national.read(JOBROOM, search('Zurich'), get=Feed())
        self.assertFalse(any('never kept' in json.dumps(job) for job in jobs), 'title, employer, place, date and link only')
        headers = {key.lower(): value for key, value in national._switzerland_url('x', None, 0).header_items()}
        self.assertEqual(sorted(headers), ['accept', 'content-type', 'user-agent'], 'no Cookie, no Authorization, no key')
        self.assertIn('Jobadabra', headers['user-agent'])

    def test_the_whole_country_asks_no_point_and_a_person_elsewhere_asks_nothing(self):
        self.assertNotIn('radiusSearchRequest', json.loads(national._switzerland_url('x', None, 0).data))
        feed = Feed()
        self.assertEqual(national.read(JOBROOM, search('Lyon'), get=feed), [])
        self.assertEqual(feed.sent, [])

    def test_a_page_is_read_from_the_list_and_the_total_from_its_header(self):
        opened = mock.Mock(return_value=Response(RECORDED['rows'], total=214))
        with mock.patch.object(host_pace, 'open', opened):
            answer = national._jobroom_get(national._switzerland_url('Lagerist', None, 0))
        self.assertEqual((len(answer['rows']), answer['total']), (5, 214))
        self.assertEqual(len(national._switzerland_rows(answer)[0]), 3)

    def test_an_answer_that_is_not_a_list_of_ads_fails_the_source_never_reads_as_no_jobs(self):
        with mock.patch.object(host_pace, 'open', return_value=Response({'error': 'changed'})), self.assertRaises(ValueError):
            national.read(JOBROOM, search('Zurich'))

    def test_a_401_or_403_ends_the_read_with_one_request_and_is_not_asked_again(self):
        for code in (401, 403):
            with self.subTest(code):
                refused = urllib.error.HTTPError(national.JOBROOM_SEARCH, code, 'x', {}, None)
                feed = Feed(refused)
                with self.assertRaises(urllib.error.HTTPError):
                    national.read(JOBROOM, search('Zurich'), get=feed)
                self.assertEqual(len(feed.sent), 1, 'never retried: the owner is told, and writes to SECO')

    def test_through_the_sites_pace_a_403_is_one_request_never_a_second(self):
        host_pace.reset()
        refused = urllib.error.HTTPError(national.JOBROOM_SEARCH, 403, 'Forbidden', {}, None)
        with mock.patch('urllib.request.urlopen', side_effect=refused) as opened, self.assertRaises(national.Refused):
            national._jobroom_get(national._switzerland_url('Lagerist', None, 0))
        self.assertEqual(opened.call_count, 1)

    def test_a_403_right_after_a_fast_burst_is_still_one_request_and_kept_for_the_next_run(self):   # #3920, Gitar: host_pace reads that 403 as "too fast" once
        host_pace.reset()
        answers = [Response(RECORDED['rows'], total=500)] * 3 + [urllib.error.HTTPError(national.JOBROOM_SEARCH, 403, 'Forbidden', {}, None)]
        sent = []

        def opened(request, timeout=None):
            sent.append(request)
            answer = answers[len(sent) - 1]
            if isinstance(answer, Exception):
                raise answer
            return answer
        stopped = mock.patch.object(host_pace, 'clock', lambda: 1_800_000_000.0)   # the four within one instant: a burst, as host_pace counts it
        with stopped, mock.patch.object(host_pace, 'FILE', self.kept.with_name('host_pace.json')), mock.patch.object(host_pace, 'sleep'), \
                mock.patch('urllib.request.urlopen', side_effect=opened):
            for page in range(3):
                national._jobroom_get(national._switzerland_url('Lagerist', None, page * national.PAGE))
            with self.assertRaises(national.Refused):
                national._jobroom_get(national._switzerland_url('Lagerist', None, 3 * national.PAGE))
            self.assertEqual(len(sent), 4, 'the refused page is not asked a second time')
            self.assertEqual(json.loads(self.kept.read_text())['status'], 403)
            self.assertIs(national._jobroom_get(national._switzerland_url('Lagerist', None, 0)), national.OFF, 'a later run does not ask Job-Room')
            self.assertEqual(national.read(JOBROOM, search('Zurich')), [])
        self.assertEqual(len(sent), 4)
        self.assertIn('refused (403)', self.out.getvalue())

    def test_a_full_page_with_an_ad_abroad_dropped_still_asks_the_next_page(self):   # #3920, Gitar: near a border a radius returns foreign ads
        abroad = json.loads(json.dumps(RECORDED['rows'][0]))
        abroad['jobAdvertisement']['jobContent']['location']['countryIsoCode'] = 'DE'
        full = {'rows': [abroad] + [RECORDED['rows'][0]] * (national.PAGE - 1), 'total': 150}
        feed = Feed(full, {'rows': [], 'total': 150}, {'rows': [], 'total': 0})
        with mock.patch.object(national, 'PAGES', 2):
            national.read(JOBROOM, search('Zurich'), get=feed)
        self.assertEqual([(json.loads(r.data)['keywords'], urllib.parse.parse_qs(urllib.parse.urlsplit(r.full_url).query)['page']) for r in feed.sent][:2],
                         [(['kundtjänst'], ['0']), (['Customer Support Agent'], ['0'])])
        self.assertIn((['kundtjänst'], ['1']), [(json.loads(r.data)['keywords'], urllib.parse.parse_qs(urllib.parse.urlsplit(r.full_url).query)['page']) for r in feed.sent])

    def test_with_no_total_header_a_full_page_asks_the_next_and_a_short_one_is_the_last(self):   # #3920, Gitar
        full = [RECORDED['rows'][0]] * national.PAGE
        with mock.patch.object(host_pace, 'open', return_value=Response(full)):
            self.assertGreater(national._jobroom_get(national._switzerland_url('Lagerist', None, national.PAGE))['total'], 2 * national.PAGE)
        with mock.patch.object(host_pace, 'open', return_value=Response(RECORDED['rows'])):
            self.assertEqual(national._jobroom_get(national._switzerland_url('Lagerist', None, national.PAGE))['total'], national.PAGE + 5)

if __name__ == '__main__':
    unittest.main()
