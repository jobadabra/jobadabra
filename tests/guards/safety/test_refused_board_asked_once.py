"""Guard: safety — a job board that refused us (a 401/403 or a bot check) is never asked again in the same search by another of its reads.
Why (14 Nov 2026, owner via sa, asked via AskUserQuestion: "The search owns it (Recommended)"; CLAUDE.md "never retry a 401 or 403"): the boards'
lane and the full read both read boards in one search; the host claims are the search's (src/press/clock.py start, src/sources/board_lanes.py),
so a host the lane asked and that refused is skipped by the full read, even after the lane ended (Gitar on #4277)."""
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from src import time_budget
from src.ai import board_ideas
from src.sources import careers, found_boards

_READER = careers.READER


def setUpModule():   # no test here reaches a real model through a page read (guard: tests/unit/sources/test_found_boards_ai.py)
    careers.READER = None


def tearDownModule():
    careers.READER = _READER


SEARCH = {'role_keywords': ['developer'], 'locations': {'top_tier': ['Chisinau'], 'country_wide': [], 'abroad': []}}


def board(n):
    return {'name': f'Board {n}', 'host': f'b{n}.example', 'search_url': f'https://b{n}.example/?q={{role}}', 'countries': ['Moldova'],
            'kinds': ['any'], 'source_kind': 'general'}


class ARefusedBoardIsAskedOnce(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        for patch in (mock.patch('src.paths.DATA', Path(tmp.name)), mock.patch.object(board_ideas, 'load', return_value={'boards': {}}),
                      mock.patch.object(board_ideas, 'save'), mock.patch.object(found_boards, '_dead', return_value=set()),
                      mock.patch.object(found_boards.board_employers, 'note'), mock.patch('builtins.print'),
                      mock.patch.object(found_boards.board_yield, 'pick', side_effect=lambda boards, *a, **k: list(boards))):
            patch.start()
            self.addCleanup(patch.stop)
        self.addCleanup(setattr, time_budget.CLOCK, 'board_hosts', None)

    def test_the_full_read_does_not_ask_a_board_that_refused_the_lane(self):
        asked = []

        def read_board(b, search, fetch, route=None, early=False, show=None):
            asked.append(b['host'])
            return ([], 'browser', None) if b['host'] == 'b1.example' else ([{'title': 'Developer', 'url': f"https://{b['host']}/job/1"}], 'ok', None)
        time_budget.start(60)   # the search's clock opens its claims
        with mock.patch.object(found_boards, 'read_board', read_board):
            found_boards.read(SEARCH, [board(1)], early=True, workers=1, is_relevant=list, dead=set(), fetch=lambda url: '')   # the lane: b1 refuses
            found_boards.read(SEARCH, [board(1), board(2)], workers=1, is_relevant=list, dead=set(), fetch=lambda url: '', web=False)   # the full read
        self.assertEqual(asked, ['b1.example', 'b2.example'], 'the refusing board was asked once in the search')


if __name__ == '__main__':
    unittest.main()
