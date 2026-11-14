"""LinkedIn's public (logged-out) job search on the person's own computer (src/sources/linkedin_guest.py; spec docs/superpowers/specs/2026-11-13-linkedin-guest-search-design.md).
Recorded pages only (tests/fixtures/sources/linkedin_guest: a cards page and a job page recorded on 13 Nov 2026, LinkedIn's empty end, an Easy Apply job page and an
employer-site job page recorded on 14 Nov 2026, trimmed to the Apply control and the text); a stand-in site answers every
request and counts it, so no test reaches linkedin.com. The stand-in clock moves on each sleep and request; nothing waits for real."""
import io
import os
import sqlite3
import tempfile
import unittest
import urllib.error
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

from src import pool_served, store, time_budget
from src.sources import describe, host_pace, linkedin_guest, read_budget, reader_rows, visits

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
                      mock.patch.object(time_budget, 'wall', side_effect=lambda: datetime.fromtimestamp(self.clock[0], timezone.utc)),
                      mock.patch.object(linkedin_guest, 'FILE', Path(self.dir.name) / 'linkedin_guest.json'),   # this computer's window, never the owner's
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

    def test_a_search_reads_three_pages_at_most_twenty_to_forty_seconds_apart_with_no_cookie_and_our_own_user_agent(self):
        pages = iter([CARDS, renumbered(CARDS, 1), renumbered(CARDS, 2), renumbered(CARDS, 3)])
        site = self.site(lambda url: next(pages))
        jobs = linkedin_guest.read(SEARCH)
        self.assertEqual(len(site.requests), linkedin_guest.PAGES)
        self.assertEqual(len(jobs), 30)
        starts = [urllib.parse.parse_qs(urllib.parse.urlsplit(r.full_url).query) for r in site.requests]
        self.assertEqual([s['start'] for s in starts], [['0'], ['10'], ['20']])
        self.assertEqual((starts[0]['keywords'], starts[0]['location']), (['Site Reliability Engineer'], ['Geneva']))
        self.assertEqual(len(self.sleeps), 2, 'a gap before every request after the first')
        self.assertTrue(all(19.0 <= s <= 40.0 for s in self.sleeps), self.sleeps)   # 20-40 s from the last request's start, never a burst; the stand-in request took 1 s
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
                linkedin_guest.FILE.unlink(missing_ok=True)   # each case on a computer that sent nothing in the last 10 minutes
                print.reset_mock()
                answer = {'blocked': '<!DOCTYPE html><html><body><p>Something went wrong</p></body></html>',   # synthetic: no cards and not the empty end
                          'authwall': ('redirect', 'https://www.linkedin.com/authwall?trk=x', '<html>Sign in</html>'),
                          'checkpoint': ('redirect', 'https://www.linkedin.com/checkpoint/challenge', '<html>Check</html>')}.get(case, case)
                site = self.site(lambda url: answer)
                self.assertEqual(linkedin_guest.read({**SEARCH, 'role_keywords': ['SRE', 'DevOps', 'Cloud']}), [])
                self.assertEqual(len(site.requests), 1, 'the first stop ends the lane: no next page, no next search, no retry')
                self.assertIn(words, self.said())
                with self.assertRaises(linkedin_guest.Later):   # a job page after a stop is not asked either: it waits for a later run
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
        with mock.patch.object(read_budget, 'cut_at', return_value=cut), mock.patch.object(linkedin_guest.random, 'uniform', return_value=linkedin_guest.GAP_S[0]):
            jobs = linkedin_guest.read({**SEARCH, 'role_keywords': ['SRE', 'DevOps', 'Cloud']})
        self.assertLessEqual(self.clock[0], cut + 1e-9, 'no request started (or ran) past the cut')
        self.assertEqual(len(site.requests), 2, 'two pages (0-15 s, 20-35 s); the third would start at the cut: not sent')
        self.assertEqual(len(jobs), 20, 'what was read is kept')

    def test_search_pages_go_round_robin_page_one_of_each_search_first_at_most_four(self):
        """Owner, 13 Nov 2026: "≤6 in any 10 min (Recommended)": search pages first, page 1 of each search, then page 2; job pages get what is left."""
        site = self.site(lambda url: renumbered(CARDS, len(site.requests)))
        jobs = linkedin_guest.read({**SEARCH, 'role_keywords': ['SRE', 'DevOps', 'Cloud']})
        asked = [urllib.parse.parse_qs(urllib.parse.urlsplit(r.full_url).query) for r in site.requests]
        self.assertEqual([(q['keywords'][0], q['start'][0]) for q in asked], [('SRE', '0'), ('DevOps', '0'), ('Cloud', '0'), ('SRE', '10')])
        self.assertEqual(len(jobs), 40)
        self.assertEqual(linkedin_guest.left(), linkedin_guest.WINDOW_MAX - linkedin_guest.SEARCH_PAGES, "what is left is the job pages' share")

    def test_at_most_six_requests_in_any_ten_minutes_on_this_computer_whatever_the_press(self):
        """Measured 13 Nov 2026: 429 after ~11 guest requests in ~10 min from one address. The window counts every request sent, search or job page, every
        process: a second press (a new process) right after the first sends nothing until the oldest request is 10 minutes old."""
        page = fixture('job-page.html')
        site = self.site(lambda url: page)
        urls = [f'https://www.linkedin.com/jobs/view/{4484998700 + n}/' for n in range(1, 9)]
        texts = [linkedin_guest.description(url) for url in urls[:linkedin_guest.WINDOW_MAX]]
        self.assertTrue(all('Swissquote' in text for text in texts))
        self.assertEqual(linkedin_guest.left(), 0)
        with self.assertRaises(linkedin_guest.Later):
            linkedin_guest.description(urls[6])
        linkedin_guest.reset()   # the next press: a new process, the same computer
        with self.assertRaises(host_pace.NotAsked):   # nothing asked: not counted as read, so LinkedIn does not rest 6 h (14 Nov 2026)
            linkedin_guest.read(SEARCH)
        self.assertIn(linkedin_guest.WINDOW_FULL, self.said(), 'said, not a stop: no pause')
        self.assertNotIn(linkedin_guest.SLOW_DOWN, self.said())
        self.assertEqual(len(site.requests), linkedin_guest.WINDOW_MAX, 'nothing sent past the window')
        self.clock[0] = 1000.0 + linkedin_guest.WINDOW_S + 1   # the first request is now older than the window
        self.assertEqual(linkedin_guest.left(), 1, 'one place frees as each request ages out')
        self.assertIn('Swissquote', linkedin_guest.description(urls[7]))
        self.assertEqual(len(site.requests), linkedin_guest.WINDOW_MAX + 1)

    def test_a_second_press_is_spaced_from_the_first_and_a_window_filled_meanwhile_sends_nothing(self):
        """Gitar on #3998: the gap and the count are the computer's, not the process's: a new process waits the gap from the last request any process sent,
        and the count is read again at the moment of sending."""
        site = self.site(lambda url: CARDS)
        linkedin_guest.FILE.write_text('{"sent": [%s]}' % (self.clock[0] - 5))   # another press sent one 5 s ago
        linkedin_guest.read(SEARCH)
        self.assertGreaterEqual(self.sleeps[0], linkedin_guest.GAP_S[0] - 5, "the first request of this press waits the gap from the other press's")
        linkedin_guest.reset()
        linkedin_guest.FILE.unlink()
        asked = len(site.requests)
        linkedin_guest.FILE.write_text('{"sent": [%s]}' % self.clock[0])

        def other_press_fills_the_window(seconds):   # during this press's gap, another process sends the rest of the window
            self.clock[0] += seconds
            linkedin_guest.FILE.write_text('{"sent": [%s]}' % ', '.join(str(self.clock[0] - n) for n in range(linkedin_guest.WINDOW_MAX)))
        with mock.patch.object(linkedin_guest, '_sleep', side_effect=other_press_fills_the_window), self.assertRaises(host_pace.NotAsked):
            linkedin_guest.read(SEARCH)
        self.assertEqual(len(site.requests), asked, 'nothing sent: the window filled while this press waited')
        self.assertIn(linkedin_guest.WINDOW_FULL, self.said())

    def test_a_sent_job_page_counts_even_when_it_failed_and_a_cut_sends_nothing(self):
        """Gitar on #3995 (twice): a request that went out counts, whatever came back; a Later, where nothing was sent, does not."""
        def offline(url):
            raise urllib.error.URLError('offline')
        site = self.site(offline)
        with self.assertRaises(OSError):
            linkedin_guest.description('https://www.linkedin.com/jobs/view/4484998755/')
        self.assertEqual(len(site.requests), 1)
        self.assertEqual(linkedin_guest.left(), linkedin_guest.WINDOW_MAX - 1)
        with mock.patch.object(read_budget, 'cut_at', return_value=self.clock[0] - 1), self.assertRaises(linkedin_guest.Later):
            linkedin_guest.description('https://www.linkedin.com/jobs/view/4484998756/')
        self.assertEqual(len(site.requests), 1, 'past the cut: nothing sent')
        self.assertEqual(linkedin_guest.left(), linkedin_guest.WINDOW_MAX - 1)

    def test_a_job_page_redirected_away_from_the_job_gives_no_text(self):
        self.site(lambda url: ('redirect', 'https://www.linkedin.com/jobs/search?x=1', CARDS))
        self.assertEqual(linkedin_guest.description('https://www.linkedin.com/jobs/view/4484998755/'), '')


    def test_a_job_page_says_whether_linkedin_or_the_employer_takes_the_application(self):
        """ea's "LinkedIn account" chip (spec 2026-11-13-linkedin-easy-apply-design.md) needs the found row to say Easy Apply; recorded 14 Nov 2026."""
        self.assertEqual(linkedin_guest.apply_route(fixture('job-page-easy-apply.html')), 'linkedin')
        self.assertEqual(linkedin_guest.apply_route(fixture('job-page-employer-site.html')), 'employer')
        self.assertEqual(linkedin_guest.apply_route(fixture('job-page.html')), '', 'a page that names neither stays unknown, never a guess')
        self.site(lambda url: fixture('job-page-easy-apply.html'))
        text, route = linkedin_guest.posting('https://www.linkedin.com/jobs/view/4489915925/')
        self.assertEqual(route, 'linkedin')
        self.assertGreater(len(text), 200, 'the text is read from the same page, one request')

    def test_the_route_lands_on_the_found_row_with_its_text_and_a_later_page_naming_none_keeps_it(self):
        tmp = Path(self.dir.name)
        for patch in (mock.patch.object(visits, 'STORE', tmp / 'visits.json'), mock.patch('src.paths.DATA', tmp),
                      mock.patch.object(pool_served, 'STORE', tmp / 'pool_served.json'), mock.patch.object(linkedin_guest, 'on', lambda env=None: True)):
            patch.start()
            self.addCleanup(patch.stop)
        pages = {'4489915925': 'job-page-easy-apply.html', '4490552642': 'job-page-employer-site.html', '4484998755': 'job-page.html'}
        easy = fixture('job-page-easy-apply.html')
        textless = easy[:easy.index('<section class="description">')]   # Gitar on #4173: a route with no text is kept, the request is spent either way

        def answer(url):
            job = url.rstrip('/').rsplit('/', 1)[1]
            return textless if job == '4489915926' else fixture(pages[job])
        site = self.site(answer)
        db = sqlite3.connect(':memory:')
        db.execute('CREATE TABLE jobs (id INTEGER PRIMARY KEY, url TEXT, state TEXT, description TEXT, first_seen_at TEXT, apply_route TEXT)')
        now = datetime(2026, 11, 14, 3, 30, tzinfo=timezone.utc)
        db.executemany('INSERT INTO jobs VALUES (?, ?, ?, ?, ?, ?)', [
            (1, 'https://www.linkedin.com/jobs/view/4489915925/', 'open', '', now.isoformat(timespec='seconds'), None),
            (2, 'https://www.linkedin.com/jobs/view/4490552642/', 'open', '', now.isoformat(timespec='seconds'), None),
            (3, 'https://www.linkedin.com/jobs/view/4484998755/', 'open', '', now.isoformat(timespec='seconds'), 'linkedin'),
            (4, 'https://www.linkedin.com/jobs/view/4489915926/', 'open', '', now.isoformat(timespec='seconds'), None)])
        describe.backfill(db, now=now)
        self.assertEqual(len(site.requests), 4, 'one request a job: the route comes with the text')
        rows = {row[0]: row[1:] for row in db.execute('SELECT id, apply_route, length(description) > 200 FROM jobs')}
        self.assertEqual(rows, {1: ('linkedin', 1), 2: ('employer', 1), 3: ('linkedin', 1), 4: ('linkedin', 0)})

    def test_an_older_jobs_file_gets_the_route_column_at_its_next_open(self):
        path = Path(self.dir.name) / 'jobs.db'
        store.connect(path).close()
        db = sqlite3.connect(path)
        self.assertIn('apply_route', {row[1] for row in db.execute('PRAGMA table_info(jobs)')})
        db.close()

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
        # the desktop app: not a CI runner, not a hosted run (a cloud run reads only with the site's turn: tests/unit/sources/test_linkedin_turn.py)
        with mock.patch.dict('os.environ', {'JOBADABRA_LINKEDIN_GUEST': '1', 'GITHUB_ACTIONS': '', 'JOBADABRA_TRIGGER': ''}):
            self.assertTrue(describe.readable(url))
            self.assertFalse(describe.readable('https://www.linkedin.com/in/someone'), 'only a job page')
            self.assertFalse(describe.readable('https://www.glassdoor.com/job-listing/x'))


if __name__ == '__main__':
    unittest.main()
