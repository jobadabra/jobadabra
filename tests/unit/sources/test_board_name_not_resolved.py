"""A board whose host has no DNS record says so in its round line, not a bare "ValueError" (d03, run 43478619242: md.jooble.org; issue #4034). Fake DNS only."""
import contextlib
import io
import socket
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from src.ai import board_ideas
from src.sources import careers, found_boards

_READER = careers.READER
BOARD = {'name': 'Jooble Moldova', 'host': 'md.jooble.org', 'search_url': 'https://md.jooble.org/SearchResult?ukw={role}&rgns={place}', 'countries': ['Moldova'],
         'kinds': ['any'], 'source_kind': 'general'}
SEARCH = {'jobs_board_search_queries': ['software engineer'], 'role_keywords': ['software engineer'], 'locations': {'top_tier': ['chisinau'], 'country_wide': [], 'abroad': []}}


def setUpModule():
    careers.READER = None


def tearDownModule():
    careers.READER = _READER


class NameNotResolved(unittest.TestCase):
    def test_a_host_with_no_address_is_named_in_the_round_line_and_still_a_value_error(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        out = io.StringIO()
        with mock.patch('src.paths.DATA', Path(tmp.name)), mock.patch.object(board_ideas, 'load', return_value={}), \
                mock.patch('socket.getaddrinfo', side_effect=socket.gaierror(8, 'nodename nor servname provided')), contextlib.redirect_stdout(out):
            with self.assertRaises(ValueError):
                careers.get_text('https://md.jooble.org/SearchResult?ukw=x')
            found_boards.read(SEARCH, [BOARD], fetch=careers.get_text, is_relevant=lambda jobs: [], dead=set(), early=True)
        log = out.getvalue()
        self.assertIn('page not read (the name does not resolve)', log)
        self.assertNotIn('(ValueError)', log)

    def test_a_private_address_stays_a_plain_refusal(self):
        with mock.patch('socket.getaddrinfo', return_value=[(socket.AF_INET, 0, 0, '', ('10.0.0.1', 0))]):
            with self.assertRaises(ValueError) as caught:
                careers.get_text('https://internal.example/x')
        self.assertNotIsInstance(caught.exception, careers.NameNotResolved)


if __name__ == '__main__':
    unittest.main()
