"""A first search's own job boards are handed to the list board by board, not when the slowest of them ends.
Why (12 Nov 2026, the 30 fixed profiles): the first-jobs board read (src/first_jobs.py board_jobs) gave its jobs only when the whole read
returned, and with one board still open that is the search's own end, after the last hand-over: Vienna read 41 fitting jobs from three
boards and listed 0, Naples 7 and 0, Krakow 24 and 0. #3892 handed each board as it is kept for the known boards only. A state decides
each verdict (an event the stand-in read waits on), never a clock."""
import io
import sqlite3
import threading
import unittest
from contextlib import redirect_stdout
from unittest import mock

from src import time_budget
from src.sources import boards_first

SEARCH = {'role_keywords': ['sales representative'], 'locations': {'top_tier': ['vienna']}}
FAST = {'url': 'https://fast-board.example.test/jobs/1', 'title': 'Sales Representative', 'location': 'Vienna'}
SLOW = {'url': 'https://slow-board.example.test/jobs/2', 'title': 'Sales Representative', 'location': 'Vienna'}


class AFirstSearchsBoards(unittest.TestCase):
    def setUp(self):
        self.addCleanup(time_budget.start, 0)
        self.db = sqlite3.connect(':memory:')
        self.addCleanup(self.db.close)

    def test_a_board_that_ended_is_in_the_list_while_another_is_still_being_read(self):
        still_open, handed = threading.Event(), threading.Event()
        self.addCleanup(still_open.set)

        def board_list(on_board=None):   # found_boards.read: each kept board goes to on_board at once; the whole list when every board ended
            on_board([dict(FAST)])
            handed.set()
            still_open.wait(10)   # the second board is still being read at the search's end
            return [dict(FAST), dict(SLOW)]
        with mock.patch('src.sources.board_reader.read', return_value=iter(())), mock.patch('src.sources.feeds.triage'), \
                mock.patch('src.sources.aggregators.kept', side_effect=lambda feed_db, name, found, *a, **k: list(found)), \
                redirect_stdout(io.StringIO()):
            lane, shown = boards_first.Beside(SEARCH, listed=board_list), []
            self.assertTrue(handed.wait(5), 'positive control: the first board ended')
            lane.deliver(self.db, shown.extend)   # the search's last hand-over, the slow board still open
            self.assertFalse(lane.done.is_set(), 'positive control: the read had not returned')
            self.assertEqual([job['url'] for job in shown], [FAST['url']], 'the board that ended is in the list')
            still_open.set()
            taken = lane.take(self.db, shown.extend)
        self.assertEqual(sorted(job['url'] for job in taken), [FAST['url'], SLOW['url']], 'the rest follows once, the first board not twice')


if __name__ == '__main__':
    unittest.main()
