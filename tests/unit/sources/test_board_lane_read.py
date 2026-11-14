"""A job board that stops sending requests gives its lane to the next board in found_boards.read; the next board's jobs are judged while the
quiet one is still open (src/sources/board_lanes.py, issue #4255).
Why (xc, 14 Nov 2026): d03 Chisinau's rabota.md sent its last request at +21.8 s and held its lane to the cut at 124 s; c02 Vienna's boards
stalled the same way in 5 of 5 CI searches. A fake board that fetches one page and then waits stands in for it; no AI call and no live site."""
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

from src.ai import board_ideas
from src.sources import board_lanes, careers, found_boards

_READER = careers.READER


def setUpModule():   # no test here reaches a real model through a page read (guard: tests/unit/sources/test_found_boards_ai.py)
    careers.READER = None


def tearDownModule():
    careers.READER = _READER


SEARCH = {'role_keywords': ['developer'], 'locations': {'top_tier': ['Chisinau'], 'country_wide': [], 'abroad': []}}


def board(n):
    return {'name': f'Board {n}', 'host': f'b{n}.example', 'search_url': f'https://b{n}.example/?q={{role}}', 'countries': ['Moldova'],
            'kinds': ['any'], 'source_kind': 'general'}


class AQuietBoardGivesItsLane(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.said = []
        for patch in (mock.patch('src.paths.DATA', Path(tmp.name)), mock.patch.object(board_ideas, 'load', return_value={'boards': {}}),
                      mock.patch.object(board_ideas, 'save'), mock.patch.object(found_boards, '_dead', return_value=set()),
                      mock.patch.object(found_boards.board_employers, 'note'), mock.patch('builtins.print'),
                      mock.patch.object(board_lanes, 'QUIET_S', 0.3), mock.patch.object(board_lanes, 'LOOK_S', 0.05),
                      mock.patch.object(board_lanes, 'said', side_effect=lambda key, now: self.said.append(key)),
                      mock.patch.object(found_boards.board_yield, 'pick', side_effect=lambda boards, *a, **k: list(boards))):
            patch.start()
            self.addCleanup(patch.stop)

    def test_the_next_board_reads_while_the_quiet_one_holds_nothing(self):
        released, judged = threading.Event(), []
        self.addCleanup(released.set)

        def read_board(b, search, fetch, route=None, early=False, show=None):
            fetch(b['search_url'])   # its first page, as rabota.md's
            if b['host'] == 'b1.example':
                released.wait(5)   # then nothing: hang guard 5 s, the assertions say whether it was needed
            return [{'title': 'Developer', 'url': f"https://{b['host']}/1"}], 'ok', None

        def judge(jobs):
            judged.extend(j['url'] for j in jobs)
            if any('b2.example' in j['url'] for j in jobs):
                released.set()   # board 2 judged while board 1 was quiet: board 1 may end now
            return list(jobs)
        with mock.patch.object(found_boards, 'read_board', read_board):
            started = time.monotonic()
            jobs = found_boards.read(SEARCH, [board(1), board(2)], early=True, workers=1, is_relevant=judge, dead=set(), fetch=lambda url: '')
            took = time.monotonic() - started
        self.assertEqual(judged, ['https://b2.example/1', 'https://b1.example/1'], 'one lane: board 2 read in it once board 1 went quiet')
        self.assertLess(took, 3, 'board 2 did not wait for board 1\'s end')
        self.assertEqual(self.said, ['b1.example'], 'the log names the board that stopped sending')
        self.assertEqual([j['url'] for j in jobs], ['https://b1.example/1', 'https://b2.example/1'], 'the quiet board\'s jobs are kept when it ends')


if __name__ == '__main__':
    unittest.main()
