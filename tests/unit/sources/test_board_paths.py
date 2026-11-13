"""A path-style board search (`/jobs/{role}/{place}`) that 404s the plus form is read in its slug form (12 Nov 2026, vb: a Vienna sales search
asked a big board four plus-form links, all 404, and listed 0 jobs; its slug link has jobs). Example boards only; no live site here."""
import unittest
import urllib.error
from unittest import mock

from src.ai import board_ideas
from src.sources import board_paths, careers, found_boards

_READER = careers.READER


def setUpModule():   # no test here reaches a real model through a page read (guard: tests/unit/sources/test_found_boards_ai.py)
    careers.READER = None


def tearDownModule():
    careers.READER = _READER

SEARCH = {'role_keywords': ['sales representative'], 'locations': {'top_tier': ['wien'], 'country_wide': [], 'abroad': []}}
PATH_BOARD = {'name': 'Path Board', 'host': 'path.example', 'search_url': 'https://path.example/jobs/{role}/{place}', 'countries': ['Austria'],
              'kinds': ['any'], 'source_kind': 'general'}


def missing(url, code=404):
    return urllib.error.HTTPError(url, code, 'x', {}, None)


class Forms(unittest.TestCase):
    def test_a_link_with_its_own_letters_outside_ascii_is_asked_in_ascii(self):
        """Why (13 Nov 2026, benchmark run 43344553172, a driver in Sofia): a board whose own address holds Cyrillic letters answered
        "page not read (UnicodeEncodeError)" on all four rounds, 0 jobs: only the search word and the place were encoded, not the link."""
        links = board_paths.forms('https://path.example/работа-{role}/{place}?вид=всички&q={role}', 'шофьор на камион', 'софия')
        for link in links:
            link.encode('ascii')   # raises when a letter outside ASCII is left
        self.assertEqual(links[0], 'https://path.example/%D1%80%D0%B0%D0%B1%D0%BE%D1%82%D0%B0-%D1%88%D0%BE%D1%84%D1%8C%D0%BE%D1%80+%D0%BD%D0%B0+'
                                   '%D0%BA%D0%B0%D0%BC%D0%B8%D0%BE%D0%BD/%D1%81%D0%BE%D1%84%D0%B8%D1%8F?%D0%B2%D0%B8%D0%B4=%D0%B2%D1%81%D0%B8%D1%87%D0%BA%D0%B8'
                                   '&q=%D1%88%D0%BE%D1%84%D1%8C%D0%BE%D1%80+%D0%BD%D0%B0+%D0%BA%D0%B0%D0%BC%D0%B8%D0%BE%D0%BD')

    def test_a_path_place_with_an_accent_is_asked_last_without_it(self):
        self.assertEqual(board_paths.forms('https://path.example/{role}/{place}', 'kucharz', 'Kraków'),
                         ['https://path.example/kucharz/Krak%C3%B3w', 'https://path.example/kucharz/krak%C3%B3w', 'https://path.example/kucharz/krakow'])
        self.assertEqual(len(board_paths.forms('https://q.example/jobs?l={place}', 'kucharz', 'Kraków')), 1, 'a query takes the accent as it is')

    def test_an_ascii_link_is_asked_as_before(self):
        self.assertEqual(board_paths.forms('https://path.example/search?q={role}&x=a%20b', 'sales rep'), ['https://path.example/search?q=sales+rep&x=a%20b'])

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

class OtherReaders(unittest.TestCase):
    """The headless and refused-site readers build the same links through board_paths (one mechanism, not a quote_plus chain each)."""
    def test_the_rendered_read_asks_the_slug_link_too_and_a_persons_browser_opens_the_plus_link(self):
        from src.sources import board_rendered, refused_reads
        shown = []

        def show(url):
            shown.append(url)
            raise OSError('no browser here')
        with mock.patch.object(found_boards.careers, 'note_refusal'):
            board_rendered._rendered(PATH_BOARD, {}, PATH_BOARD['search_url'], ('https://path.example/',), SEARCH, None, show, list)
        self.assertEqual(shown, ['https://path.example/jobs/sales+representative/wien', 'https://path.example/jobs/sales-representative/wien',
                                 'https://path.example/'])
        self.assertEqual(refused_reads._board_url(PATH_BOARD, SEARCH), 'https://path.example/jobs/sales+representative/wien')


if __name__ == '__main__':
    unittest.main()
