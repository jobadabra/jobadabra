"""LinkedIn's public (logged-out) job search on the person's own computer (src/sources/linkedin_guest.py; spec docs/superpowers/specs/2026-11-13-linkedin-guest-search-design.md).
Recorded pages only (tests/fixtures/sources/linkedin_guest: a cards page and a job page recorded on 13 Nov 2026, LinkedIn's empty end); a stand-in site answers every
request and counts it, so no test reaches linkedin.com. The stand-in clock moves on each sleep and request; nothing waits for real."""
import io
import os
import tempfile
import unittest
import urllib.error
import urllib.parse
from pathlib import Path
from unittest import mock

from src import time_budget
from src.sources import describe, host_pace, linkedin_guest, read_budget, reader_rows

FIXTURES = os.path.join(os.path.dirname(__file__), '..', '..', 'fixtures', 'sources', 'linkedin_guest')
SEARCH = {'role_keywords': ['Site Reliability Engineer'], 'locations': {'top_tier': ['Geneva']}}


def fixture(name):
    with open(os.path.join(FIXTURES, name), encoding='utf-8') as file:
        return file.read()


CARDS = fixture('cards-page.html')
EMPTY = fixture('empty-end.html')


def renumbered(page, offset):
    """The recorded cards page with other job ids, as LinkedIn's next page lists other jobs."""
    return page.replace('urn:li:jobPosting:', f'urn:li:jobPosting:9{offset}')


class Reply(io.BytesIO):
    def __init__(self, body, url):
        super().__init__(body.encode())
        self.url, self.status, self.headers = url, 200, None

    def geturl(self):
        return self.url

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class Site:
    """Stand-in for LinkedIn: answer(url) -> body, an int status (raised as HTTPError), or ('redirect', final url, body). Counts and keeps every request."""

    def __init__(self, answer, clock, seconds_per_request=1.0):
        self.answer, self.clock, self.seconds, self.requests = answer, clock, seconds_per_request, []

    def open(self, request, timeout=None):
        self.requests.append(request)
        if timeout is not None and self.seconds > timeout:   # a socket gives up at its timeout, as the real opener does
            self.clock[0] += timeout
            raise urllib.error.URLError(TimeoutError('timed out'))
        self.clock[0] += self.seconds
        got = self.answer(request.full_url)
        if isinstance(got, int):
            raise urllib.error.HTTPError(request.full_url, got, 'stand-in', {}, io.BytesIO(b''))
        if isinstance(got, tuple):
            return Reply(got[2], got[1])
        return Reply(got, request.full_url)


class GuestTest(unittest.TestCase):
    def setUp(self):
        linkedin_guest.reset()
        self.addCleanup(linkedin_guest.reset)
        self.clock, self.sleeps = [1000.0], []
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        host_pace.reset()
        self.addCleanup(host_pace.reset)

        def sleep(seconds):
            self.sleeps.append(seconds)
            self.clock[0] += seconds
        for patch in (mock.patch.object(time_budget, 'now', side_effect=lambda: self.clock[0]),
                      mock.patch.object(linkedin_guest, '_sleep', side_effect=sleep),
                      mock.patch.object(read_budget, 'cut_at', return_value=None),
                      mock.patch.object(host_pace, 'FILE', Path(self.dir.name) / 'host_pace.json'),   # the shared pace file, never the owner's
                      mock.patch('builtins.print')):
            patch.start()
            self.addCleanup(patch.stop)

    def site(self, answer, seconds=1.0):
        site = Site(answer, self.clock, seconds)
        patch = mock.patch.object(linkedin_guest, '_opener', site)
        patch.start()
        self.addCleanup(patch.stop)
        return site

    def said(self):
        return ' | '.join(' '.join(map(str, call.args)) for call in print.call_args_list)

    def test_the_recorded_cards_page_gives_ten_jobs_with_title_company_place_date_and_the_canonical_address(self):
        jobs = linkedin_guest.parse_cards(CARDS)
        self.assertEqual(len(jobs), 10)
        first = jobs[0]
        self.assertEqual((first['title'], first['company'], first['location'], first['date_posted']),
                         ('Site Reliability Engineer - eFX/ Crypto', 'Swissquote', 'Gland, Vaud, Switzerland', '2026-10-29'))
        self.assertEqual(first['url'], 'https://www.linkedin.com/jobs/view/4484998755/')   # job_alerts.canonical's form: one job whichever way it was found
        self.assertEqual(first['id'], 'linkedin:4484998755')
        self.assertTrue(all(job['title'] and job['company'] and job['location'] for job in jobs))

    def test_a_search_reads_three_pages_at_most_three_to_seven_seconds_apart_with_no_cookie_and_our_own_user_agent(self):
        pages = iter([CARDS, renumbered(CARDS, 1), renumbered(CARDS, 2), renumbered(CARDS, 3)])
        site = self.site(lambda url: next(pages))
        jobs = linkedin_guest.read(SEARCH)
        self.assertEqual(len(site.requests), linkedin_guest.PAGES)
        self.assertEqual(len(jobs), 30)
        starts = [urllib.parse.parse_qs(urllib.parse.urlsplit(r.full_url).query) for r in site.requests]
        self.assertEqual([s['start'] for s in starts], [['0'], ['10'], ['20']])
        self.assertEqual((starts[0]['keywords'], starts[0]['location']), (['Site Reliability Engineer'], ['Geneva']))
        self.assertEqual(len(self.sleeps), 2, 'a gap before every request after the first')
        self.assertTrue(all(2.0 <= s <= 7.0 for s in self.sleeps), self.sleeps)   # 3-7 s from the last request's start; the stand-in request took 1 s
        for request in site.requests:
            headers = {k.lower(): v for k, v in request.header_items()}
            self.assertNotIn('cookie', headers)
            self.assertEqual(headers['user-agent'], linkedin_guest.ats.USER_AGENT)
            self.assertNotIn('Chrome', headers['user-agent'])
            self.assertEqual(urllib.parse.urlsplit(request.full_url).hostname, 'www.linkedin.com')

    def test_the_empty_end_ends_a_search_quietly_and_the_next_search_is_read(self):
        two = {'role_keywords': ['SRE', 'Platform engineer'], 'locations': {'top_tier': ['Geneva']}}
        site = self.site(lambda url: EMPTY if 'keywords=SRE' in url else CARDS[:CARDS.index('</li>', CARDS.index('jobPosting')) + 5])
        jobs = linkedin_guest.read(two)
        self.assertEqual(len(site.requests), 2, 'one page each: an empty end, then a short page')
        self.assertEqual(len(jobs), 1)
        self.assertNotIn('could not be read', self.said())

    def test_each_stop_ends_every_linkedin_read_after_exactly_one_request_and_never_retries(self):
        cases = {429: 'slow down', 999: 'slow down', 403: 'could not be read', 401: 'could not be read',
                 'blocked': 'could not be read', 'authwall': 'sign-in or check page', 'checkpoint': 'sign-in or check page'}
        for case, words in cases.items():
            with self.subTest(case=case):
                linkedin_guest.reset()
                print.reset_mock()
                answer = {'blocked': '<!DOCTYPE html><html><body><p>Something went wrong</p></body></html>',   # synthetic: no cards and not the empty end
                          'authwall': ('redirect', 'https://www.linkedin.com/authwall?trk=x', '<html>Sign in</html>'),
                          'checkpoint': ('redirect', 'https://www.linkedin.com/checkpoint/challenge', '<html>Check</html>')}.get(case, case)
                site = self.site(lambda url: answer)
                self.assertEqual(linkedin_guest.read({**SEARCH, 'role_keywords': ['SRE', 'DevOps', 'Cloud']}), [])
                self.assertEqual(len(site.requests), 1, 'the first stop ends the lane: no next page, no next search, no retry')
                self.assertIn(words, self.said())
                with self.assertRaises(host_pace.Busy):   # a job page after a stop is not asked either: it waits for a later run
                    linkedin_guest.description('https://www.linkedin.com/jobs/view/4484998755/')
                self.assertEqual(len(site.requests), 1)

    def test_a_slow_down_says_the_line_the_app_pauses_linkedin_on(self):
        self.site(lambda url: 429)
        linkedin_guest.read(SEARCH)
        self.assertIn(linkedin_guest.SLOW_DOWN, self.said())   # desktop/lib reads this line to pause both LinkedIn reads a day (owner, 13 Nov 2026)

    def test_jobs_read_before_a_stop_are_kept(self):
        answers = iter([CARDS, 429])
        self.site(lambda url: next(answers))
        self.assertEqual(len(linkedin_guest.read(SEARCH)), 10)

    def test_a_network_failure_ends_that_search_only_and_all_failing_is_the_lane_failing(self):
        def answer(url):
            raise urllib.error.URLError('offline')
        self.site(answer)
        with self.assertRaises(OSError):
            linkedin_guest.read({**SEARCH, 'role_keywords': ['SRE', 'DevOps']})

    def test_a_slow_host_ends_the_lane_by_the_read_cut(self):
        """sa, 13 Nov 2026: one gap for the whole host; every read checks the press deadline before it starts; a slow host never makes a longer search."""
        cut = self.clock[0] + 40
        pages = iter([CARDS, renumbered(CARDS, 1), renumbered(CARDS, 2), renumbered(CARDS, 3)] * 3)
        site = self.site(lambda url: next(pages), seconds=15.0)
        with mock.patch.object(read_budget, 'cut_at', return_value=cut):
            jobs = linkedin_guest.read({**SEARCH, 'role_keywords': ['SRE', 'DevOps', 'Cloud']})
        self.assertLessEqual(self.clock[0], cut + 1e-9, 'no request started (or ran) past the cut')
        self.assertEqual(len(site.requests), 3, 'two pages, then one cut short by its timeout at the cut; nothing after')
        self.assertEqual(len(jobs), 20, 'what was read is kept')

    def test_job_pages_take_turns_with_the_search_pages_and_stop_at_ten(self):
        page = fixture('job-page.html')
        site = self.site(lambda url: page)
        texts = [linkedin_guest.description(f'https://www.linkedin.com/jobs/view/{4484998700 + n}/') for n in range(1, linkedin_guest.JOB_PAGES + 1)]
        self.assertTrue(all('Swissquote' in text for text in texts))
        self.assertEqual(len(self.sleeps), linkedin_guest.JOB_PAGES - 1)
        self.assertEqual(linkedin_guest.job_pages_left(), 0)
        with self.assertRaises(host_pace.Busy):
            linkedin_guest.description('https://www.linkedin.com/jobs/view/4484998711/')
        self.assertEqual(len(site.requests), linkedin_guest.JOB_PAGES)

    def test_a_job_page_redirected_away_from_the_job_gives_no_text(self):
        self.site(lambda url: ('redirect', 'https://www.linkedin.com/jobs/search?x=1', CARDS))
        self.assertEqual(linkedin_guest.description('https://www.linkedin.com/jobs/view/4484998755/'), '')


class GateTest(unittest.TestCase):
    def test_the_row_is_on_only_where_the_desktop_app_set_the_flag(self):
        row = next(row for row in reader_rows.ROWS if row.name == linkedin_guest.NAME)
        self.assertEqual(row.lane, 'linkedin_guest')
        self.assertIn('linkedin_guest', reader_rows.BY_LANE)
        self.assertEqual(reader_rows.BY_LANE['linkedin_guest'].side, 'engine')
        self.assertFalse(row.on({}))
        self.assertTrue(row.on({'JOBADABRA_LINKEDIN_GUEST': '1'}))
        self.assertFalse(row.on({'JOBADABRA_LINKEDIN_GUEST': '1', 'JOBADABRA_DISABLE': 'linkedin_guest'}))

    def test_describe_reads_a_linkedin_job_page_only_with_the_flag(self):
        url = 'https://www.linkedin.com/jobs/view/4484998755/'
        with mock.patch.dict('os.environ', {}, clear=False):
            os.environ.pop('JOBADABRA_LINKEDIN_GUEST', None)
            self.assertFalse(describe.readable(url), 'a sign-in site, as before')
        with mock.patch.dict('os.environ', {'JOBADABRA_LINKEDIN_GUEST': '1'}):
            self.assertTrue(describe.readable(url))
            self.assertFalse(describe.readable('https://www.linkedin.com/in/someone'), 'only a job page')
            self.assertFalse(describe.readable('https://www.glassdoor.com/job-listing/x'))


if __name__ == '__main__':
    unittest.main()
