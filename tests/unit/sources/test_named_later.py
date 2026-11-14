"""The boards the AI names beside the measured ones take the places the measured boards left, in the right order, and the log says what became of each
(src/sources/board_later.py join, src/first_jobs.py _named_meanwhile, src/ai/board_ideas.py _merge; sa, 14 Nov 2026: c02 Vienna, karriere.at proposed first, never read, no log line).
Why: a local run's log showed 6 places (4 proven boards + steirerjobs.at, a Styria board at install rank 28 with 0 relevant jobs, + booming.jobs); the AI's karriere.at came 9th in ideas() and
the boards 7+ were cut by pick's untried limit counting the 4 boards already being read."""
import unittest
from unittest import mock

from src import first_jobs
from src.ai import board_ideas
from src.sources import board_later, board_yield, careers, read_budget

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

    def test_boards_already_being_read_do_not_use_up_the_untried_limit(self):
        """c02: the 4 measured boards were in the list pick cut at MAX_UNTRIED, so a named board 7th in the list was never picked."""
        named = [board(n) for n in range(1, 11)]
        started, _ = self.run_join(named, {f'b{n}.example' for n in range(1, 5)}, free=board_yield.MAX_UNTRIED)
        self.assertEqual(started, [f'b{n}.example' for n in range(5, 11)], 'the 4 boards being read are not asked: the 6 new ones take the places')

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


class OrderTests(unittest.TestCase):
    def test_merge_marks_the_boards_named_for_this_search(self):
        merged = board_ideas._merge([board(2), board(7)], [{**board(2), 'rank': 4.0}, {**board(1), 'rank': 28.0}])
        self.assertEqual({b['host']: bool(b.get('proposed')) for b in merged}, {'b1.example': False, 'b2.example': True, 'b7.example': True})

    def test_the_places_left_go_to_the_boards_named_for_this_search_before_a_board_that_only_has_a_rank(self):
        """c02: steirerjobs.at (rank 28, another region, 0 relevant) came before karriere.at in ideas(); each group keeps its order."""
        ideas = [board(1, rank=28.0), board(2, proposed=True), board(3, rank=17.0), board(4, proposed=True), board(5)]
        with mock.patch.object(first_jobs, '_wait_early'), mock.patch.object(first_jobs, '_proposed', return_value=ideas), mock.patch.object(read_budget, 'past_cut', return_value=False):
            named = first_jobs._named_meanwhile(board_ideas, {})
        self.assertEqual([b['host'] for b in named], ['b2.example', 'b4.example', 'b1.example', 'b3.example', 'b5.example'])

    def test_nothing_is_named_past_the_cut(self):
        with mock.patch.object(first_jobs, '_wait_early'), mock.patch.object(read_budget, 'past_cut', return_value=True):
            self.assertEqual(first_jobs._named_meanwhile(board_ideas, {}), [])


if __name__ == '__main__':
    unittest.main()
