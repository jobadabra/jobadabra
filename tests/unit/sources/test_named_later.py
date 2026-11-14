"""The log says what became of every board the AI named beside the measured ones (src/sources/board_later.py join; sa, 14 Nov 2026: c02 Vienna, karriere.at proposed first,
never read, no log line). Log lines only: which boards are read is unchanged (the order and the untried limit are in the branch eo-named-boards-order, held for a design)."""
import unittest
from unittest import mock

from src.sources import board_later, board_yield, careers

_READER = careers.READER


def setUpModule():   # no test here reaches a real model through a page read (guard: tests/unit/sources/test_found_boards_ai.py)
    careers.READER = None


def tearDownModule():
    careers.READER = _READER


def board(n, **extra):
    return {'name': f'B{n}', 'host': f'b{n}.example', 'search_url': f'https://b{n}.example/?q={{role}}', 'countries': ['Austria'], 'kinds': ['any'], 'source_kind': 'general', **extra}


def pick(kept=None):
    return lambda these: board_yield.pick(these, kept if kept is not None else {}, lambda entry: False, frozenset(), remember=False)


class JoinTests(unittest.TestCase):
    def run_join(self, named, hosts, free, kept=None):
        said = []
        with mock.patch('builtins.print', lambda *a, **k: said.append(' '.join(map(str, a)))):
            started = board_later.join(named, pick(kept), hosts, free, lambda b: b['host'], taken=sorted(hosts))
        return started, said

    def test_every_named_board_not_started_says_why(self):
        """The silence: a board cut by the places or by pick left no line."""
        named = [board(n) for n in range(1, 6)]
        started, said = self.run_join(named, {'b1.example'}, free=2)
        self.assertEqual(started, ['b2.example', 'b3.example'])
        text = '\n'.join(said)
        for expected in ('1. B1 (b1.example): already being read in this search', '2. B2 (b2.example): started', '4. B4 (b4.example): no place left',
                         '5. B5 (b5.example): no place left', 'places left 2, held by b1.example'):
            self.assertIn(expected, text)

    def test_a_board_pick_leaves_out_says_its_reason(self):
        """The wiring found_boards passes: board_yield.why_skipped over the board memory (Gitar on #4175: a stub `why` left it untested)."""
        kept = {'b2.example': {'state': 'browser', 'name': 'B2', 'search_url': 'https://b2.example'}}
        said = []
        with mock.patch('builtins.print', lambda *a, **k: said.append(' '.join(map(str, a)))):
            started = board_later.join([board(1), board(2)], pick(kept), set(), 5, lambda b: b['host'], lambda b: board_yield.why_skipped(b, kept))
        self.assertEqual(started, ['b1.example'])
        self.assertIn('2. B2 (b2.example): refuses automated reading', '\n'.join(said))

    def test_why_skipped_names_dead_refusing_and_not_a_board(self):
        self.assertIn('dead', board_yield.why_skipped(board(1), {}, dropped={'b1.example'}))
        self.assertIn('refuses', board_yield.why_skipped(board(2), {'b2.example': {'state': 'browser'}}))
        self.assertIn('not a job board', board_yield.why_skipped(board(3), {'b3.example': {'site_kind': 'one employer'}}))
        self.assertIsNone(board_yield.why_skipped(board(4), {}))


if __name__ == '__main__':
    unittest.main()
