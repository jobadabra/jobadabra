"""A board whose pages are not UTF-8 is searched with the words in its own charset (src/sources/board_paths.py read).
Why (13 Nov 2026, sa; lab run 43432640838): a Portuguese board that declares ISO-8859-1 matched 'designer gr%E1fico' to its graphic-design jobs, and
'designer gr%C3%A1fico' (the UTF-8 form every search link was filled with) to an electrician, a fitter and a logistics job; discovery then judged
"no kinds of work" from those. Example boards only; no live site here."""
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


SEARCH = {'role_keywords': ['designer gráfico'], 'locations': {'top_tier': ['Lisboa'], 'country_wide': [], 'abroad': []}}
BOARD = {'name': 'Latin Board', 'host': 'latin.example', 'search_url': 'https://latin.example/pesquisa.asp?chaves={role}&cidade={place}',
         'countries': ['Portugal'], 'kinds': ['any'], 'source_kind': 'general'}
LATIN = 'https://latin.example/pesquisa.asp?chaves=designer+gr%E1fico&cidade=Lisboa'
UTF8 = 'https://latin.example/pesquisa.asp?chaves=designer+gr%C3%A1fico&cidade=Lisboa'


def listing(title):
    return f'<html><head><meta charset="ISO-8859-1"></head><body><a href="/1234567/x/">{title}</a></body></html>'


PAGES = {LATIN: listing('Designer Gráfico (m/f)'), UTF8: listing('Eletricista Industrial')}   # the board matches only its own charset's bytes


class Read(unittest.TestCase):
    def read(self, board=BOARD):
        asked = []

        def fetch(url):
            asked.append(url)
            if url in PAGES:
                return PAGES[url]
            raise urllib.error.HTTPError(url, 404, 'x', {}, None)
        lines = []
        with mock.patch.object(careers, 'jsonld_jobs', side_effect=lambda text, url: [{'title': text.split('">')[-1].split('<')[0], 'url': url + '#1'}]
                               if 'pesquisa.asp' in url else []), \
                mock.patch.object(careers, 'read_page_from', return_value=[]), mock.patch.object(found_boards, '_shaped', side_effect=lambda b, found: found), \
                mock.patch.object(careers, 'note_refusal'), mock.patch.object(board_ideas, 'load', return_value={'boards': {}}), \
                mock.patch('builtins.print', side_effect=lambda *a, **k: lines.append(' '.join(map(str, a)))):
            jobs, state, _ = found_boards.read_board(board, SEARCH, fetch, early=True)
        return jobs, asked, lines

    def test_an_accented_term_on_a_latin_1_board_is_asked_in_latin_1_and_finds_its_jobs(self):
        board = dict(BOARD)
        jobs, asked, _ = self.read(board)
        self.assertEqual([job['title'] for job in jobs], ['Designer Gráfico (m/f)'])
        self.assertEqual(asked, [UTF8, LATIN], 'the UTF-8 link first (the board is not known yet), then once in the charset its page declares')
        self.assertEqual(board.get('charset'), 'cp1252', 'kept on the board: its next searches ask in it at once')

    def test_a_board_whose_charset_is_known_is_asked_once_in_it(self):
        _, asked, _ = self.read({**BOARD, 'charset': 'cp1252'})
        self.assertEqual(asked, [LATIN])

    def test_the_round_line_shows_the_link_it_asked(self):
        """sa, 13 Nov 2026: a board whose search page is the same whatever the words could not be told from the log, which never printed the link."""
        _, _, lines = self.read(dict(BOARD))
        self.assertIn(LATIN, next(line for line in lines if " round 'designer gráfico'" in line))

    def test_an_ascii_term_or_a_utf_8_board_is_asked_once_as_before(self):
        self.assertEqual(board_paths.forms(BOARD['search_url'], 'designer', 'Lisboa', 'cp1252'),
                         ['https://latin.example/pesquisa.asp?chaves=designer&cidade=Lisboa'])
        self.assertEqual(board_paths.forms(BOARD['search_url'], 'designer gráfico', 'Lisboa', 'utf-8'), [UTF8])

    def test_a_word_the_boards_charset_cannot_write_is_asked_in_utf_8(self):
        self.assertEqual(board_paths.forms('https://latin.example/q?k={role}', 'шофьор', '', 'cp1252'), ['https://latin.example/q?k=%D1%88%D0%BE%D1%84%D1%8C%D0%BE%D1%80'])


class OtherReaders(unittest.TestCase):
    """Every search link a board's memory fills (a person's browser, the headless read, a visit) is filled in the board's known charset."""
    def test_a_persons_browser_and_the_headless_read_ask_in_the_boards_charset(self):
        from src.sources import board_rendered, refused_reads
        shown = []

        def show(url):
            shown.append(url)
            raise OSError('no browser here')
        with mock.patch.object(careers, 'note_refusal'):
            board_rendered._rendered(BOARD, {'charset': 'cp1252'}, BOARD['search_url'], ('https://latin.example/',), SEARCH, None, show, list)
        self.assertEqual(shown[0], LATIN)
        self.assertEqual(refused_reads._board_url({**BOARD, 'charset': 'cp1252'}, SEARCH), LATIN)


if __name__ == '__main__':
    unittest.main()
