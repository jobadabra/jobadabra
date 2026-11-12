"""A board read in place of one that refused is kept, and so judged, at its replaced board's turn, not after the slowest board (12 Nov 2026, vb:
its titles reached the title judge when the AI time was gone and went unjudged). No AI call and no live site here."""
import threading
import unittest
from unittest import mock

from src.ai import board_ideas
from src.sources import found_boards

SEARCH = {'role_keywords': ['sales'], 'locations': {'top_tier': ['Vienna'], 'country_wide': [], 'abroad': []}}


def board(n):
    return {'name': f'Board {n}', 'host': f'b{n}.example', 'search_url': f'https://b{n}.example/?q={{role}}', 'countries': ['Austria'],
            'kinds': ['any'], 'source_kind': 'general'}


class SpareJudgedEarly(unittest.TestCase):
    def test_a_replacement_is_judged_while_a_slower_board_is_still_being_read(self):
        """Board 2 stays open until Board 3's jobs (read in place of the refusing Board 1) have been judged."""
        judged = threading.Event()

        def read_board(b, search, fetch, route=None, early=False, show=None):
            if b['host'] == 'b2.example':
                self.assertTrue(judged.wait(5), 'the replacement is judged while Board 2 is still open, not after it')
            if b['host'] == 'b1.example':
                return [], 'browser', None
            return [{'title': 'Sales', 'url': f"https://{b['host']}/1"}], 'ok', None

        def judge(jobs):
            if any('b3.example' in job['url'] for job in jobs):
                judged.set()
            return list(jobs)
        with mock.patch.object(board_ideas, 'load', return_value={'boards': {}}), mock.patch.object(board_ideas, 'save'), \
                mock.patch.object(found_boards, 'read_board', read_board), mock.patch.object(found_boards, '_dead', return_value=set()), \
                mock.patch.object(found_boards.board_employers, 'note'), mock.patch('builtins.print'):
            jobs = found_boards.read(SEARCH, [board(1), board(2)], early=True, workers=2, spare=[board(3)], is_relevant=judge, dead=set())
        self.assertEqual(sorted(job['url'] for job in jobs), ['https://b2.example/1', 'https://b3.example/1'])


if __name__ == '__main__':
    unittest.main()
