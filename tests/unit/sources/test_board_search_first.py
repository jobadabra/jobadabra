"""A general board whose link has no search word is searched through its own form first (src/sources/board_search_first.py; 13 Nov 2026, run 43473395249:
kariera.si, itjobs.pt, colegios.es and airlinejobs.com were read as their general list, 0-1 right jobs of 20-40). Fake AI off, fake pages only."""
import contextlib
import io
import json
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

from src.ai import board_ideas
from src.sources import careers, found_boards

_READER = careers.READER
HOME = 'https://listing.example/'
LIST = 'https://listing.example/delovna-mesta'
SEARCH = {'jobs_board_search_queries': ['welder'], 'role_keywords': ['welder'], 'locations': {'top_tier': ['ljubljana'], 'country_wide': [], 'abroad': []}}
BOARD = {'name': 'Listing', 'host': 'listing.example', 'search_url': LIST, 'countries': ['Slovenia'], 'kinds': ['any'], 'source_kind': 'general'}


def setUpModule():   # no test here reaches a real model through a page read
    careers.READER = None


def tearDownModule():
    careers.READER = _READER


def posting(title, n):
    job = {'@context': 'https://schema.org', '@type': 'JobPosting', 'title': title, 'url': f'https://listing.example/job/{n}',
           'hiringOrganization': {'@type': 'Organization', 'name': 'Acme'},
           'jobLocation': {'@type': 'Place', 'address': {'addressLocality': 'Ljubljana', 'addressCountry': 'SI'}}}
    return f'<html><script type="application/ld+json">{json.dumps(job)}</script><body>x</body></html>'


FORM = '<html><body><form action="/iskanje" method="get"><input name="q"><button>Search</button></form></body></html>'


class SearchFirst(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        for patch in (mock.patch('src.paths.DATA', Path(tmp.name)), mock.patch('src.places.load', return_value={}),
                      mock.patch.object(found_boards.board_yield, 'pick', lambda boards, *a, **k: boards),
                      mock.patch.object(found_boards, '_retry_due', return_value=True)):
            patch.start()
            self.addCleanup(patch.stop)
        self.asked, self.home, self.search_page, self.list_title = [], FORM, lambda url: posting('Welder', 1), 'Production worker'

    def fetch(self, url):
        self.asked.append(url)
        if url.endswith('/robots.txt'):
            return ''
        if url == HOME:
            if isinstance(self.home, Exception):
                raise self.home
            return self.home
        if '/iskanje?' in url:
            return self.search_page(url)
        return posting(self.list_title, 2)   # the general list

    def read(self, board=BOARD, early=False):
        relevant = lambda jobs: [job for job in jobs if 'Welder' in job['title']]
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            jobs = found_boards.read(SEARCH, [board], fetch=self.fetch, is_relevant=relevant, dead=set(), early=early)
        return [job['title'] for job in jobs], out.getvalue()

    def test_a_list_link_with_no_word_is_searched_through_the_boards_own_form_not_read_as_its_list(self):
        titles, log = self.read(early=True)
        self.assertEqual(titles, ['Welder'])
        self.assertFalse([url for url in self.asked if url == LIST], f'the general list was read: {self.asked}')
        self.assertIn('searched through its own search form: 1 job(s), 1 relevant', log)
        self.assertRegex(log, r'home page and form links \d+ s, form rounds \d+ s')
        entry = board_ideas.load()['boards']['listing.example']
        self.assertEqual((entry['form_url'], entry['form_for'], entry['search_url']), ('https://listing.example/iskanje?q={role}', LIST, LIST),
                         "kept per install; the board's shared link (src/contribute.py reads search_url) is unchanged")

    def test_the_next_search_asks_the_kept_form_at_once(self):
        self.read()
        self.asked.clear()
        self.read()
        self.assertTrue(self.asked[0].startswith('https://listing.example/iskanje?q='), self.asked)
        self.assertNotIn(HOME, self.asked)

    def test_a_board_with_no_search_form_is_read_as_its_list_and_says_so_once(self):
        self.home = '<html><body>jobs</body></html>'
        titles, log = self.read()
        self.assertEqual(titles, ['Production worker'], 'read as its list, as before')
        self.assertIn(LIST, self.asked)
        self.assertIn('general list, no search found', log)
        self.asked.clear()
        self.read()
        self.assertNotIn(HOME, self.asked, 'asked once for this link')

    def test_a_search_that_answered_with_no_job_is_a_real_answer_the_list_is_not_read_for_it(self):
        self.search_page = lambda url: '<html><body>' + 'Nothing matches your search. Try other words. ' * 30 + '</body></html>'   # a long page: a short one is read as a frame scripts fill (a visit)
        titles, log = self.read(early=True)
        self.assertEqual(titles, [])
        self.assertNotIn(LIST, self.asked)
        self.assertIn('searched through its own search form: 0 job(s), 0 relevant; its general list is not read for it', log)

    def test_a_form_that_refuses_or_fails_leaves_the_list_to_be_read(self):
        def refuse(url):
            raise urllib.error.HTTPError(url, 403, 'Forbidden', None, None)
        self.search_page = refuse
        self.read(early=True)
        self.assertIn(LIST, self.asked)

    def test_a_field_boards_category_page_and_a_board_with_the_word_in_its_link_are_left_alone(self):
        self.list_title = 'Welder'
        self.read({**BOARD, 'source_kind': 'sector'})
        self.assertNotIn(HOME, self.asked, "a field board's category page IS the field's list (tests/unit/sources/test_board_category_pages.py)")
        self.asked.clear()
        self.read({**BOARD, 'search_url': 'https://listing.example/jobs?kw={role}'})
        self.assertNotIn(HOME, self.asked, 'a link with {role} is already a search: the ladder (tests/unit/ai/test_board_forms.py) is unchanged')


if __name__ == '__main__':
    unittest.main()
