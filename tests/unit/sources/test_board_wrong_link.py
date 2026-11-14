"""A board whose built search link answers 404 or 410 on every page is searched through its own home-page form in the same read (src/sources/board_wrong_link.py;
14 Nov 2026, zb: 14 of 52 boards a search read with 0 jobs answered 404/410 to the link we built, e.g. a guessed /jobs/<role> path). Fake AI off, fake pages only."""
import contextlib
import io
import json
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

from src.sources import board_wrong_link, careers, found_boards

_READER = careers.READER
HOME = 'https://board.example/'
SEARCH = {'jobs_board_search_queries': ['welder'], 'role_keywords': ['welder'], 'locations': {'top_tier': ['ljubljana'], 'country_wide': [], 'abroad': []}}
BOARD = {'name': 'Board', 'host': 'board.example', 'search_url': 'https://board.example/jobs/{role}/{place}', 'countries': ['Slovenia'], 'kinds': ['any'], 'source_kind': 'general'}
FORM = '<html><body><form action="/iskanje" method="get"><input name="q"><input name="kraj"><button>Search</button></form></body></html>'


def setUpModule():   # no test here reaches a real model through a page read
    careers.READER = None


def tearDownModule():
    careers.READER = _READER


def posting(title, n):
    job = {'@context': 'https://schema.org', '@type': 'JobPosting', 'title': title, 'url': f'https://board.example/job/{n}',
           'hiringOrganization': {'@type': 'Organization', 'name': 'Acme'},
           'jobLocation': {'@type': 'Place', 'address': {'addressLocality': 'Ljubljana', 'addressCountry': 'SI'}}}
    return f'<html><script type="application/ld+json">{json.dumps(job)}</script><body>x</body></html>'


def http(code):
    def answer(url):
        raise urllib.error.HTTPError(url, code, 'no', None, None)
    return answer


class WrongLink(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        for patch in (mock.patch('src.paths.DATA', Path(tmp.name)), mock.patch('src.places.load', return_value={}),
                      mock.patch.object(found_boards.board_yield, 'pick', lambda boards, *a, **k: boards),
                      mock.patch.object(found_boards, '_retry_due', return_value=True)):
            patch.start()
            self.addCleanup(patch.stop)
        found_boards._early.clear()
        self.addCleanup(found_boards._early.clear)
        self.asked, self.link = [], http(404)

    def fetch(self, url):
        self.asked.append(url)
        if url.endswith('/robots.txt'):
            return ''
        if url == HOME:
            return FORM
        if '/iskanje?' in url:
            return posting('Welder', 1)
        if '/jobs/' in url:
            return self.link(url)
        raise urllib.error.HTTPError(url, 404, 'no', None, None)

    def read(self, early=True):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            jobs = found_boards.read(SEARCH, [BOARD], fetch=self.fetch, is_relevant=lambda jobs: [j for j in jobs if 'Welder' in j['title']], dead=set(), early=early)
        return [job['title'] for job in jobs], out.getvalue()

    def direct(self, early=True):
        """board_wrong_link.read around the real board read, as found_boards.read's call site wraps it (the call line lands after #4277's successor)."""
        entry, out = {}, io.StringIO()
        with contextlib.redirect_stdout(out):
            jobs, state, _ = board_wrong_link.read(BOARD, entry, BOARD['search_url'], SEARCH, self.fetch, lambda jobs: [j for j in jobs if 'Welder' in j['title']], None, early,
                                                   lambda watched: found_boards.read_board(BOARD, SEARCH, watched, None, early=early))
        return [job['title'] for job in jobs], out.getvalue(), entry

    def test_the_wrapper_reads_the_home_form_after_404s_and_keeps_the_form_link(self):
        titles, log, entry = self.direct()
        self.assertEqual(titles, ['Welder'], log)
        self.assertEqual(entry.get('form_url'), 'https://board.example/iskanje?q={role}&kraj={place}', 'read first by the next search')
        for code in (403, 429):
            with self.subTest(code=code):
                self.asked.clear()
                self.link = http(code)
                titles, log, _ = self.direct()
                self.assertEqual(titles, [])
                self.assertNotIn(HOME, self.asked)

    def test_a_posted_alert_form_is_never_asked_it_would_be_the_wrong_link_again(self):
        alert = '<html><body><form method="post" action="/alert"><input type="hidden" name="q" value=""><input name="alertAddress"></form></body></html>'
        with mock.patch.object(found_boards.board_search_first.board_forms, 'home', return_value=(HOME, alert)):
            titles, log, _ = self.direct()
        self.assertEqual(titles, [])
        self.assertEqual([url for url in self.asked if 'alertAddress' in url], [], 'a request spent on a form asked at the 404 link')
        self.assertIn('no search form on its home page', log)

    def test_a_link_that_404s_on_every_page_is_searched_through_the_home_form_in_the_first_jobs_read(self):
        titles, log = self.read()
        self.assertEqual(titles, ['Welder'], log)
        self.assertIn('answered HTTP 404 on every page (a wrong link, not a refusal)', log)
        self.assertIn('searched through its own search form: 1 job(s), 1 relevant', log)
        self.assertTrue(any(url.startswith('https://board.example/iskanje?q=welder') for url in self.asked), self.asked)

    def test_410_is_a_wrong_link_too(self):
        self.link = http(410)
        titles, _ = self.read()
        self.assertEqual(titles, ['Welder'])

    def test_a_refusal_is_never_a_wrong_link_no_second_request_to_the_host(self):
        for code in (401, 403, 429):
            with self.subTest(code=code):
                self.asked.clear()
                self.link = http(code)
                titles, log = self.read()
                self.assertEqual(titles, [])
                self.assertNotIn(HOME, self.asked, f'{code}: the home page was asked after a refusal')
                self.assertNotIn('wrong link', log)

    def test_a_link_that_answered_with_no_job_is_a_real_answer_the_form_is_not_asked(self):
        self.link = lambda url: '<html><body>' + 'Nothing matches your search. Try other words. ' * 30 + '</body></html>'
        titles, log = self.read()
        self.assertEqual(titles, [])
        self.assertFalse([url for url in self.asked if '/iskanje?' in url], self.asked)
        self.assertNotIn('wrong link', log)

    def test_past_the_read_cut_no_form_is_asked(self):
        with mock.patch.object(board_wrong_link, 'read_budget', mock.Mock(past_cut=lambda: True)):
            titles, _ = self.read()
        self.assertEqual(titles, [])
        self.assertFalse([url for url in self.asked if '/iskanje?' in url], self.asked)

    def test_no_form_on_the_home_page_leaves_the_0_and_says_so(self):
        with mock.patch.object(found_boards.board_search_first.board_forms, 'home_templates', return_value=[]):
            titles, log = self.read()
        self.assertEqual(titles, [])
        self.assertIn('no search form on its home page', log)


if __name__ == '__main__':
    unittest.main()
