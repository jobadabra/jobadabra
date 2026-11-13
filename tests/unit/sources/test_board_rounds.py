"""A job board's rounds are handed to the search as each ends (src/sources/board_rounds.py), not when the board's last round does: run
43416392766 read 40 new local jobs in rounds of four boards that were still in a later round at the search's end, and listed none.
The second round ends only when the test lets it (a state, never a fixed wait). No AI call and no live site here."""
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

from src import time_budget
from src.ai import board_ideas
from src.sources import board_rounds, careers, found_boards, late_reads, read_budget

_READER = careers.READER


def setUpModule():   # no test here reaches a real model through a page read (guard: tests/unit/sources/test_found_boards_ai.py)
    careers.READER = None


def tearDownModule():
    careers.READER = _READER


SEARCH = {'role_keywords': ['sales'], 'locations': {'top_tier': ['Vienna'], 'country_wide': [], 'abroad': []}}
BOARD = {'name': 'Board 1', 'host': 'b1.example', 'search_url': 'https://b1.example/?q={role}', 'countries': ['Austria'], 'kinds': ['any'],
         'source_kind': 'general'}


def job(n):
    return {'title': 'Sales', 'url': f'https://b1.example/{n}'}


class HandedPerRound(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.second_round = threading.Event()   # the board's second round ends only when the test lets it
        self.addCleanup(self.second_round.set)
        for patch in (mock.patch('src.paths.DATA', Path(tmp.name)), mock.patch.object(board_ideas, 'load', return_value={'boards': {}}),
                      mock.patch.object(board_ideas, 'save'), mock.patch.object(found_boards, '_dead', return_value=set()),
                      mock.patch.object(found_boards.board_employers, 'note'), mock.patch('builtins.print')):
            patch.start()
            self.addCleanup(patch.stop)

    def read_board(self, b, search, fetch, route=None, early=False, show=None):
        """Two rounds, as found_boards._read tells them: the first ends at once, the second when the test lets it."""
        board_rounds.ended(fetch, [job(1), job(2)])
        self.second_round.wait(5)   # hang guard: 5 s
        board_rounds.ended(fetch, [job(2), job(3)])
        return [job(1), job(2), job(3)], 'ok', None

    def test_a_rounds_jobs_reach_the_search_while_the_board_is_in_its_next_round(self):
        handed = []

        def on_board(found):
            handed.append([j['url'][-1] for j in found])
            self.second_round.set()   # the first round was handed while the second was open: it may end now
        with mock.patch.object(found_boards, 'read_board', self.read_board), mock.patch.object(read_budget, 'BETWEEN_S', 0.01):
            jobs = found_boards.read(SEARCH, [BOARD], early=True, workers=1, is_relevant=list, dead=set(), on_board=on_board)
        self.assertEqual(handed[0], ['1', '2'], 'the first round is handed before the board ends')
        self.assertEqual(sorted(n for group in handed for n in group), ['1', '2', '3'], 'each job is handed once, by its round or by its board')
        self.assertEqual([j['url'][-1] for j in jobs], ['1', '2', '3'], 'the read returns each job once')

    def test_a_board_still_open_at_the_cut_gave_the_rounds_it_ended(self):
        self.addCleanup(time_budget.start, 0)
        time_budget.start(180)
        handed, cut = [], time_budget.now() + 0.3   # the read cut comes while the board is in its second round
        with mock.patch.object(found_boards, 'read_board', self.read_board), mock.patch.object(read_budget, 'BETWEEN_S', 0.01), \
                mock.patch.object(read_budget, 'cut_at', return_value=cut), mock.patch.object(late_reads, 'when_done'):
            started = time.monotonic()
            found_boards.read(SEARCH, [BOARD], early=False, workers=1, web=False, is_relevant=list, dead=set(),
                              on_board=lambda found: handed.append([j['url'][-1] for j in found]))
            self.assertLess(time.monotonic() - started, 4, 'the read did not wait for the open board past the cut')
        self.assertEqual(handed, [['1', '2']], 'the round that ended is this search\'s; the rest of the board is the next one\'s')

    def test_a_board_read_in_place_of_a_refusing_one_keeps_its_rounds_at_that_boards_turn(self):
        """Gitar on #3985: a spare board's rounds went to the end of the list while the rest of its jobs sat at the refusing board's turn."""
        second, spare = dict(BOARD, name='Board 2', host='b2.example', search_url='https://b2.example/?q={role}'), \
            dict(BOARD, name='Board 9', host='b9.example', search_url='https://b9.example/?q={role}')

        def read_board(b, search, fetch, route=None, early=False, show=None):
            if b['host'] == 'b1.example':
                return [], 'browser', None   # refuses automated reading: the spare is read in its place
            if b['host'] == 'b9.example':
                board_rounds.ended(fetch, [{'title': 'Sales', 'url': 'https://b9.example/1'}])
                return [{'title': 'Sales', 'url': 'https://b9.example/1'}, {'title': 'Sales', 'url': 'https://b9.example/2'}], 'ok', None
            return [{'title': 'Sales', 'url': 'https://b2.example/1'}], 'ok', None
        with mock.patch.object(found_boards, 'read_board', read_board), mock.patch.object(read_budget, 'BETWEEN_S', 0.01), \
                mock.patch.object(found_boards.board_yield, 'pick', side_effect=lambda boards, *a, **k: list(boards)):
            jobs = found_boards.read(SEARCH, [BOARD, second], early=True, workers=1, is_relevant=list, dead=set(), spare=[spare], on_board=lambda found: None)
        self.assertEqual([j['url'] for j in jobs], ['https://b9.example/1', 'https://b9.example/2', 'https://b2.example/1'],
                         'the spare\'s jobs, round and rest, sit at the refusing board\'s turn, before the next board')

    def test_without_a_listener_a_board_is_kept_whole_as_before(self):
        with mock.patch.object(found_boards, 'read_board', lambda *a, **k: ([job(1)], 'ok', None)):
            jobs = found_boards.read(SEARCH, [BOARD], early=True, workers=1, is_relevant=list, dead=set())
        self.assertEqual([j['url'][-1] for j in jobs], ['1'])


if __name__ == '__main__':
    unittest.main()
