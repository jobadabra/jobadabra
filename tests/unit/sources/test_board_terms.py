"""A found board is asked in the language of the person's places too (12 Nov 2026, ch: "warehouse operator" gave 3 jobs on a Swiss board, "Lagerist" 10).
Example words only; the AI's local-language searches are a fake here."""
import unittest
from unittest import mock

from src.sources import board_terms, boards, found_boards

SEARCH = {'role_keywords': ['warehouse operator'], 'jobs_board_search_queries': ['warehouse operator', 'warehouse worker', 'forklift driver'],
          'locations': {'top_tier': ['zurich'], 'country_wide': [], 'abroad': []}}
LOCAL = ['Lagerist', 'Logistikmitarbeiter', 'Staplerfahrer']


class Merged(unittest.TestCase):
    def test_own_and_local_words_alternate_each_once(self):
        self.assertEqual(board_terms.merged(['a', 'b', 'c'], ['x', 'A', 'y'], 5), ['a', 'x', 'b', 'c', 'y'])

    def test_the_longer_list_is_not_cut_short_and_the_limit_holds(self):
        self.assertEqual(board_terms.merged(['a'], ['x', 'y', 'z'], 4), ['a', 'x', 'y', 'z'])
        self.assertEqual(board_terms.merged(['a', 'b'], [], 5), ['a', 'b'])
        self.assertEqual(board_terms.merged(['a', 'b'], ['x', 'y'], 2), ['a', 'x'])


class Terms(unittest.TestCase):
    def test_the_slice_gets_both_languages_in_its_two_words(self):
        with mock.patch.object(boards, 'kept_queries', return_value=LOCAL), mock.patch.object(boards, 'board_queries', side_effect=AssertionError('the slice never waits for the AI')):
            self.assertEqual(found_boards._terms(SEARCH, found_boards.MAX_SEARCHES, True), ['warehouse operator', 'Lagerist'])

    def test_the_full_read_asks_the_ai_once_kept_and_reaches_five_words_of_both(self):
        with mock.patch.object(boards, 'board_queries', return_value=LOCAL):
            self.assertEqual(found_boards._terms(SEARCH, found_boards.FULL_SEARCHES),
                             ['warehouse operator', 'Lagerist', 'warehouse worker', 'Logistikmitarbeiter', 'forklift driver'])

    def test_no_local_words_leaves_the_persons_own(self):   # the AI off or failed: nothing changes for a person asked in their own language
        with mock.patch.object(boards, 'board_queries', return_value=[]):
            self.assertEqual(found_boards._terms(SEARCH, 5), SEARCH['jobs_board_search_queries'])


if __name__ == '__main__':
    unittest.main()
