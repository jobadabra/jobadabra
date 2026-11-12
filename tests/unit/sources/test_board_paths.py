"""A path-style board search (`/jobs/{role}/{place}`) that 404s the plus form is read in its slug form (12 Nov 2026, vb: a Vienna sales search
asked a big board four plus-form links, all 404, and listed 0 jobs; its slug link has jobs). Example boards only; no live site here."""
import unittest
import urllib.error
from unittest import mock

from src.ai import board_ideas
from src.sources import board_paths, found_boards

SEARCH = {'role_keywords': ['sales representative'], 'locations': {'top_tier': ['wien'], 'country_wide': [], 'abroad': []}}
PATH_BOARD = {'name': 'Path Board', 'host': 'path.example', 'search_url': 'https://path.example/jobs/{role}/{place}', 'countries': ['Austria'],
              'kinds': ['any'], 'source_kind': 'general'}


def missing(url, code=404):
    return urllib.error.HTTPError(url, code, 'x', {}, None)


class Forms(unittest.TestCase):
    def test_a_path_placeholder_has_a_slug_form_after_the_plus_form(self):
        self.assertEqual(board_paths.forms('https://path.example/jobs/{role}/{place}', 'Sales Representative', 'New York'),
                         ['https://path.example/jobs/Sales+Representative/New+York', 'https://path.example/jobs/sales-representative/new-york'])

    def test_a_query_placeholder_has_one_form_and_a_one_word_path_has_one(self):
        self.assertEqual(board_paths.forms('https://q.example/jobs?q={role}&l={place}', 'sales representative', 'wien'),
                         ['https://q.example/jobs?q=sales+representative&l=wien'])
        self.assertEqual(board_paths.forms('https://p.example/jobs/{role}', 'sales', ''), ['https://p.example/jobs/sales'])

    def test_the_query_of_a_path_link_keeps_its_plus_form(self):
        self.assertEqual(board_paths.forms('https://p.example/{role}/jobs?where={place}', 'a b', 'c d')[1],
                         'https://p.example/a-b/jobs?where=c+d')

    def test_only_a_404_asks_the_next_form(self):
        asked = []

        def fetch(url):
            asked.append(url)
            raise missing(url, 403 if 'a' in url.rsplit('/', 1)[-1] else 404)
        with self.assertRaises(urllib.error.HTTPError) as caught:
            board_paths.get(fetch, ['https://x.example/a', 'https://x.example/b'])
        self.assertEqual((caught.exception.code, asked), (403, ['https://x.example/a']), 'a 403 is a refusal: never asked in another form')


class Read(unittest.TestCase):
    def read(self, serves):
        asked = []

        def fetch(url):
            asked.append(url)
            if url in serves:
                return serves[url]
            raise missing(url)
        page = '<html><body><a href="/job/1">Sales Representative</a></body></html>'
        with mock.patch.object(found_boards.careers, 'jsonld_jobs', side_effect=lambda text, url: [{'title': 'Sales Representative', 'url': url + '#1'}] if text == page else []), \
                mock.patch.object(found_boards.careers, 'read_page_from', return_value=[]), mock.patch.object(found_boards, '_shaped', side_effect=lambda b, found: found), \
                mock.patch.object(found_boards.careers, 'note_refusal'), mock.patch.object(board_ideas, 'load', return_value={'boards': {}}):
            jobs, state, _ = found_boards.read_board(PATH_BOARD, SEARCH, fetch, early=True)
        return jobs, state, asked, page

    def test_a_board_that_404s_the_plus_form_is_read_in_its_slug_form(self):
        page = '<html><body><a href="/job/1">Sales Representative</a></body></html>'
        jobs, state, asked, _ = self.read({'https://path.example/jobs/sales-representative/wien': page})
        self.assertEqual((state, [job['url'] for job in jobs]), ('ok', ['https://path.example/jobs/sales-representative/wien#1']))
        self.assertEqual(asked, ['https://path.example/jobs/sales+representative/wien', 'https://path.example/jobs/sales-representative/wien'])

    def test_a_board_that_404s_every_form_lists_nothing_and_asks_each_form_once(self):
        jobs, state, asked, _ = self.read({})
        self.assertEqual((jobs, state), ([], 'empty'))
        self.assertEqual(len(asked), len(set(asked)), 'no link is asked twice')


if __name__ == '__main__':
    unittest.main()
