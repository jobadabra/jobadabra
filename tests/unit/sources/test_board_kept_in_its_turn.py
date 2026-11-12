"""Each job board is kept, and so its titles and places judged, as soon as ITS read ends, not after the boards listed before it (#3892: a slow
first board held the boards read before it ended past the titles' time, so their jobs were never asked). A board still open at the read cut
is left for the next search exactly as before. No AI call and no live site here."""
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

from src import time_budget
from src.ai import board_ideas
from src.sources import careers, found_boards, late_reads, read_budget

_READER = careers.READER


def setUpModule():   # no test here reaches a real model through a page read (guard: tests/unit/sources/test_found_boards_ai.py)
    careers.READER = None


def tearDownModule():
    careers.READER = _READER


SEARCH = {'role_keywords': ['sales'], 'locations': {'top_tier': ['Vienna'], 'country_wide': [], 'abroad': []}}


def board(n):
    return {'name': f'Board {n}', 'host': f'b{n}.example', 'search_url': f'https://b{n}.example/?q={{role}}', 'countries': ['Austria'],
            'kinds': ['any'], 'source_kind': 'general'}


def job(n):
    return {'title': 'Sales', 'url': f'https://b{n}.example/1'}


class AFailedRead(unittest.TestCase):
    def test_the_reads_that_ended_with_a_failed_one_are_given_before_it_raises(self):
        """Gitar on #3892: the first board's read failed in the same wait as the second's ended; the second is still kept."""
        from concurrent.futures import Future
        failed, ended, still_open = Future(), Future(), Future()
        failed.set_exception(ValueError('a board read broke'))
        ended.set_result('board 2')
        given = []
        with self.assertRaises(ValueError):
            for future, result in read_budget.as_done([failed, ended, still_open], at=time.monotonic() + 5):
                given.append(result)
        self.assertEqual(given, ['board 2'], 'the read that ended is given; the open one is not taken')


class KeptInItsTurn(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.first_open = threading.Event()   # the slow first board ends only when the test lets it (a state, never a fixed wait)
        self.addCleanup(self.first_open.set)
        for patch in (mock.patch('src.paths.DATA', Path(tmp.name)), mock.patch.object(board_ideas, 'load', return_value={'boards': {}}),
                      mock.patch.object(board_ideas, 'save'), mock.patch.object(found_boards, '_dead', return_value=set()),
                      mock.patch.object(found_boards.board_employers, 'note'), mock.patch('builtins.print')):
            patch.start()
            self.addCleanup(patch.stop)

    def read_board(self, waits_for):
        def read_board(b, search, fetch, route=None, early=False, show=None, on_round=None):
            if b['host'] == 'b1.example':   # the first board in the list is the slow one
                waits_for.wait(5)   # hang guard: 5 s; the assertion below says whether it was released in time
            return [job(b['host'][1])], 'ok', None
        return read_board

    def test_a_slow_first_board_does_not_hold_back_the_judging_of_the_next(self):
        judged, released = [], threading.Event()

        def judge(jobs):
            judged.append([j['url'] for j in jobs])
            if any('b2.example' in j['url'] for j in jobs):
                released.set()   # board 2 judged: the first board may end now
            return list(jobs)
        with mock.patch.object(found_boards, 'read_board', self.read_board(released)):
            jobs = found_boards.read(SEARCH, [board(1), board(2)], early=True, workers=2, is_relevant=judge, dead=set())
        self.assertEqual(judged, [['https://b2.example/1'], ['https://b1.example/1']], 'board 2 judged while board 1 was still being read')
        self.assertEqual([j['url'] for j in jobs], ['https://b1.example/1', 'https://b2.example/1'], 'the read returns the list\'s order, '
                         'whatever the threads\' timing')

    def test_two_items_of_one_host_keep_their_own_turns(self):
        """Gitar on #3892: turns keyed by host put both items of one host at the later turn."""
        first, third = dict(board(1), search_url='https://b1.example/a?q={role}'), dict(board(1), search_url='https://b1.example/b?q={role}')

        def read_board(b, search, fetch, route=None, early=False, show=None, on_round=None):
            return [{'title': 'Sales', 'url': b['search_url'].split('?')[0]}], 'ok', None
        with mock.patch.object(found_boards, 'read_board', read_board), \
                mock.patch.object(found_boards.board_yield, 'pick', side_effect=lambda boards, *a, **k: list(boards)):
            jobs = found_boards.read(SEARCH, [first, board(2), third], early=True, workers=1, is_relevant=list, dead=set())
        self.assertEqual([j['url'] for j in jobs], ['https://b1.example/a', 'https://b2.example/', 'https://b1.example/b'], 'the list\'s order')

    def test_each_board_is_handed_over_as_it_is_kept(self):
        handed, released = [], threading.Event()

        def on_board(found):
            handed.append([j['url'] for j in found])
            if any('b2.example' in j['url'] for j in found):
                released.set()   # board 2 handed over: the first board may end now
        with mock.patch.object(found_boards, 'read_board', self.read_board(released)):
            found_boards.read(SEARCH, [board(1), board(2)], early=True, workers=2, is_relevant=list, dead=set(), on_board=on_board)
        self.assertEqual(handed, [['https://b2.example/1'], ['https://b1.example/1']], 'each board handed over once, as it is kept')

    def test_a_board_still_open_at_the_cut_is_left_for_the_next_search_as_before(self):
        self.addCleanup(time_budget.start, 0)
        time_budget.start(180)
        later = []
        cut = time_budget.now() + 0.3   # the read cut comes while board 1 is still open
        with mock.patch.object(found_boards, 'read_board', self.read_board(self.first_open)), \
                mock.patch.object(read_budget, 'cut_at', return_value=cut), \
                mock.patch.object(late_reads, 'when_done', side_effect=lambda future, kind, host, keep: later.append((kind, host))):
            started = time.monotonic()
            jobs = found_boards.read(SEARCH, [board(1), board(2)], early=False, workers=2, web=False, is_relevant=list, dead=set())
            self.assertLess(time.monotonic() - started, 4, 'the read did not wait for the open board past the cut')
        self.assertEqual([j['url'] for j in jobs], ['https://b2.example/1'], 'the board that ended is kept')
        self.assertEqual(later, [('board', 'b1.example')], 'the open board\'s page result goes to the next search (late_reads)')

    def test_in_the_boards_lane_a_board_reaches_the_list_while_its_group_is_still_read(self):
        """The lane (boards_first.Beside, the known boards and the web search's): board 2's jobs are kept and shown while board 1 is still open."""
        import sqlite3
        from src.sources import aggregators, board_reader, boards_first, feeds
        db, shown, released = sqlite3.connect(':memory:'), [], threading.Event()
        self.addCleanup(db.close)
        with mock.patch.object(found_boards, 'read_board', self.read_board(released)), \
                mock.patch.object(board_reader, '_groups', return_value=iter([('the 2 that gave you jobs', [board(1), board(2)])])), \
                mock.patch.object(found_boards.board_yield, 'is_relevant', side_effect=list), mock.patch.object(feeds, 'triage'), \
                mock.patch.object(aggregators, 'kept', side_effect=lambda feed_db, name, found, *a, **k: list(found)):
            lane = boards_first.Beside(SEARCH, wait=0)
            deadline = time.monotonic() + 5   # hang guard
            while not shown and time.monotonic() < deadline:
                lane.deliver(db, shown.extend)   # the thread that owns the job cache, as after each employer site
                lane.done.wait(0.05)
            self.assertEqual([j['url'] for j in shown], ['https://b2.example/1'], 'board 2 listed while board 1 is still being read')
            self.assertFalse(lane.done.is_set(), 'positive control: board 1 was still open')
            released.set()
            taken = lane.take(db, shown.extend)
        self.assertEqual([j['url'] for j in shown], ['https://b2.example/1', 'https://b1.example/1'], 'each board listed once, as it ended')
        self.assertEqual([j['url'] for j in taken], ['https://b1.example/1', 'https://b2.example/1'], 'the gather gets them in the list\'s order, '
                         'whatever the threads\' timing (CI on #3892: test_board_reader read that order)')


if __name__ == '__main__':
    unittest.main()
