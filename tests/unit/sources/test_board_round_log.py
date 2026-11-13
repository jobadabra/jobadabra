"""A job board's read says what each round asked and found (src/sources/board_round_log.py): one line per search word and place, with the
page's jobs, the new ones and how the page was read, or why it was not read. Benchmark 13 Nov 2026: alo.bg gave 25 jobs in one run and 0 in the
next on the same code and the log could not say which round gave what. No AI call and no live site here."""
import json
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

from src.sources import careers, found_boards

_READER = careers.READER


def setUpModule():   # no test here reaches a real model through a page read (guard: tests/unit/sources/test_found_boards_ai.py)
    careers.READER = None


def tearDownModule():
    careers.READER = _READER


SEARCH = {'jobs_board_search_queries': ['menuisier', 'charpentier'], 'role_keywords': ['carpenter'],
          'locations': {'top_tier': ['Brussels'], 'country_wide': [], 'abroad': []}}
BOARD = {'name': 'Board 1', 'host': 'b1.example', 'search_url': 'https://b1.example/?q={role}', 'countries': ['Belgium'],
         'kinds': ['any'], 'source_kind': 'general'}


def page(*urls):
    postings = [{'@context': 'https://schema.org', '@type': 'JobPosting', 'title': 'Menuisier', 'url': url,
                 'hiringOrganization': {'@type': 'Organization', 'name': 'Atelier'},
                 'jobLocation': {'@type': 'Place', 'address': {'addressLocality': 'Brussels', 'addressCountry': 'BE'}}} for url in urls]
    return f'<html><script type="application/ld+json">{json.dumps(postings)}</script><body>x</body></html>'


class EachRoundSaysWhatItFound(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        for patch in (mock.patch('src.paths.DATA', Path(tmp.name)), mock.patch('src.places.load', return_value={})):
            patch.start()
            self.addCleanup(patch.stop)

    def lines(self, fetch):
        with mock.patch('builtins.print') as said:
            jobs, state, _ = found_boards.read_board(BOARD, SEARCH, fetch=fetch, early=True)
        return jobs, state, [str(c.args[0]) for c in said.call_args_list if c.args and ' round ' in str(c.args[0])]

    def test_each_round_names_its_words_and_counts_its_jobs(self):
        pages = {'menuisier': page('https://b1.example/1', 'https://b1.example/2'), 'charpentier': page('https://b1.example/2', 'https://b1.example/3')}
        jobs, state, lines = self.lines(lambda url: pages[url.split('q=')[1]])
        self.assertEqual(state, 'ok')
        self.assertEqual(len(jobs), 3, 'positive control: the read itself is unchanged')
        self.assertEqual(len(lines), 2, lines)
        self.assertRegex(lines[0], r"^Job boards: Board 1 round 'menuisier': 2 job\(s\) on the page, 2 new, \d+ s$")
        self.assertRegex(lines[1], r"^Job boards: Board 1 round 'charpentier': 2 job\(s\) on the page, 1 new, \d+ s$")

    def test_a_round_whose_page_was_not_read_says_why(self):
        def fetch(url):
            if 'menuisier' in url:
                raise urllib.error.HTTPError(url, 404, 'Not Found', {}, None)
            return page('https://b1.example/3')
        jobs, _, lines = self.lines(fetch)
        self.assertEqual([job['url'] for job in jobs], ['https://b1.example/3'])
        self.assertRegex(lines[0], r"^Job boards: Board 1 round 'menuisier': page not read \(HTTP 404\), \d+ s$")
        self.assertRegex(lines[1], r"^Job boards: Board 1 round 'charpentier': 1 job\(s\) on the page, 1 new, \d+ s$")


if __name__ == '__main__':
    unittest.main()
