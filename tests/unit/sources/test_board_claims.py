"""One early read per job board per Find jobs press (src/sources/board_claims.py; sa, 14 Nov 2026, #4139): CI run 43531583871 (a truck driver in Sofia)
read alo.bg from the first-jobs slice (14 s to 79 s) and again from the web search's group as "ALO.bg" (57 s to 85 s): one host, two names, two reads."""
import os
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

from src.ai import board_ideas
from src.sources import careers, found_boards
from src.time_budget import SEARCH_AT

_READER = careers.READER
_DATA = []
SEARCH = {'role_keywords': ['lkw fahrer'], 'locations': {'top_tier': ['sofia'], 'country_wide': [], 'abroad': []}}


def setUpModule():   # no test here reaches a real model through a page read (guard: tests/unit/sources/test_found_boards_ai.py)
    careers.READER = None
    import tempfile
    _DATA.append(tempfile.TemporaryDirectory())
    _DATA.append(mock.patch('src.paths.DATA', Path(_DATA[0].name)))
    _DATA[1].start()


def tearDownModule():
    careers.READER = _READER
    _DATA[1].stop()
    _DATA[0].cleanup()


def board(name, host='alo.bg'):
    return {'name': name, 'host': host, 'search_url': f'https://www.{host}/searchq/?q={{role}}', 'countries': ['Bulgaria'], 'kinds': ['any'],
            'source_kind': 'general'}


class OneEarlyReadPerBoardTests(unittest.TestCase):
    def setUp(self):
        patches = [mock.patch.dict(os.environ, {SEARCH_AT: '1794613349.0'}), mock.patch.object(board_ideas, 'load', return_value={'boards': {}}),
                   mock.patch.object(board_ideas, 'save'), mock.patch.object(found_boards, '_dead', return_value=set()),
                   mock.patch.object(found_boards.board_employers, 'note')]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)
        found_boards._early.clear()
        self.addCleanup(found_boards._early.clear)
        self.reads, self.said, self.gate = [], [], None
        self.fetch = lambda url: '<html></html>'   # no test here reaches a real site (the full read looks at a board's home page)

    def read(self, boards, early=True, spare=()):
        def read_board(board, search, fetch, route=None, early=False, show=None):
            self.reads.append((board['name'], early))
            if self.gate is not None and board['host'] == 'alo.bg':   # only the board under test is held
                self.gate.wait(5)
            return ([{'title': 'LKW Fahrer', 'url': f"https://{board['host']}/1"}], 'ok', None)
        with mock.patch.object(found_boards, 'read_board', read_board), mock.patch('builtins.print', lambda *a, **k: self.said.append(' '.join(map(str, a)))):
            return found_boards.read(SEARCH, boards, early=early, web=False, workers=2, spare=list(spare), is_relevant=list, dead=set(), fetch=self.fetch)

    def test_a_board_the_slice_read_is_not_read_again_under_another_name(self):
        """The alo.bg case: the slice's "alo.bg", then the web lane's "ALO.bg" (the same host)."""
        first = self.read([board('alo.bg')])
        second = self.read([board('ALO.bg')])
        self.assertEqual(self.reads, [('alo.bg', True)], 'one read of the address')
        self.assertEqual(len(first), 1)
        self.assertEqual(second, [])
        self.assertTrue(any('ALO.bg is already being read in this search; not read twice' in line for line in self.said), self.said)

    def test_a_board_still_being_read_is_not_read_a_second_time_beside_it(self):
        """Claimed when the read STARTS: the web lane's read begins at 57 s while the slice's is open until 79 s."""
        self.gate = threading.Event()
        running = threading.Thread(target=self.read, args=([board('alo.bg')],))
        running.start()
        while not self.reads:
            self.gate.wait(0.01)
        self.read([board('ALO.bg')])
        self.gate.set()
        running.join(10)
        self.assertEqual([name for name, _ in self.reads], ['alo.bg'])

    def test_another_board_is_read(self):
        self.read([board('alo.bg')])
        self.read([board('TRANS.BG', 'trans.bg')])
        self.assertEqual([name for name, _ in self.reads], ['alo.bg', 'TRANS.BG'])

    def test_the_full_read_is_never_held_back_by_an_early_one(self):
        self.read([board('alo.bg')])
        self.read([board('alo.bg')], early=False)
        self.assertEqual(self.reads, [('alo.bg', True), ('alo.bg', False)])

    def test_a_spare_read_in_place_of_a_refusing_board_is_taken_too(self):
        def read_board(board, search, fetch, route=None, early=False, show=None):
            self.reads.append(board['name'])
            return ([], 'browser', None) if board['name'] == 'refuses' else ([{'title': 'LKW Fahrer', 'url': f"https://{board['host']}/1"}], 'ok', None)
        with mock.patch.object(found_boards, 'read_board', read_board), mock.patch('builtins.print', lambda *a, **k: None):
            found_boards.read(SEARCH, [board('refuses', 'a.example')], early=True, web=False, workers=2, spare=[board('spare', 'b.example')],
                              is_relevant=list, dead=set(), fetch=self.fetch)
            found_boards.read(SEARCH, [board('Spare', 'b.example')], early=True, web=False, workers=2, is_relevant=list, dead=set(), fetch=self.fetch)
        self.assertEqual(self.reads, ['refuses', 'spare'], 'the spare was read once, in place of the refusing board')

    def test_a_spare_another_read_took_meanwhile_is_not_read(self):
        def read_board(board, search, fetch, route=None, early=False, show=None):
            self.reads.append(board['name'])
            return ([], 'browser', None)
        found_boards._claims.take(board('lane', 'b.example'))
        with mock.patch.object(found_boards, 'read_board', read_board), mock.patch('builtins.print', lambda *a, **k: None):
            found_boards.read(SEARCH, [board('refuses', 'a.example')], early=True, web=False, workers=2, spare=[board('spare', 'b.example')],
                              is_relevant=list, dead=set(), fetch=self.fetch)
        self.assertEqual(self.reads, ['refuses'])

    def test_without_a_press_every_read_reads(self):
        """A CLI run or a unit test (no JOBADABRA_SEARCH_AT): nothing is held."""
        with mock.patch.dict(os.environ, clear=False) as env:
            env.pop(SEARCH_AT)
            self.read([board('alo.bg')])
            self.read([board('ALO.bg')])
        self.assertEqual([name for name, _ in self.reads], ['alo.bg', 'ALO.bg'])

    def test_a_past_presss_entry_is_taken_over(self):
        """The registry is found_boards._early: an entry older than its hand-over time (60 min) is a past press's."""
        found_boards._early['alo.bg'] = (time.monotonic() - found_boards.EARLY_MINUTES * 60 - 1, {})
        self.read([board('alo.bg')])
        self.assertEqual([name for name, _ in self.reads], ['alo.bg'])

    def test_a_board_named_later_and_cut_by_the_places_left_is_not_taken(self):
        """Gitar on #4145: join's pick took every named board, so one it cut stayed taken and was never read by anyone."""
        def read_board(board, search, fetch, route=None, early=False, show=None):
            self.reads.append((board['name'], early))
            return ([{'title': 'LKW Fahrer', 'url': f"https://{board['host']}/1"}], 'ok', None)
        with mock.patch.object(found_boards, 'read_board', read_board), mock.patch('builtins.print', lambda *a, **k: None):
            found_boards.read(SEARCH, [board('alo.bg')], early=True, web=False, workers=1, later=lambda: [board('Named', 'named.example')],
                              is_relevant=list, dead=set(), fetch=self.fetch)   # no place is left for the named board
            self.read([board('Named', 'named.example')])
        self.assertEqual([name for name, _ in self.reads], ['alo.bg', 'Named'], 'the lane read what the first read had no place for')

    def test_an_early_read_leaves_the_registry_to_the_full_read(self):
        """It took an entry per board and used to pop it: the full read then fetched the first page again (found_boards item)."""
        self.read([board('alo.bg')])
        self.assertIn('alo.bg', found_boards._early)

    def test_a_board_being_read_is_not_handed_to_the_full_read_until_it_has_its_pages(self):
        """Gitar on #4145: an entry for a read still open fed not_read_since(handed=) as 'read early, next pages still to read'."""
        self.gate, handed = threading.Event(), []
        running = threading.Thread(target=self.read, args=([board('alo.bg')],))
        running.start()
        while not self.reads:
            self.gate.wait(0.01)
        self.assertIsNone(found_boards._early['alo.bg'][1], 'being read: no pages yet')
        def seen(boards, kept, since, handed=()):
            handed_seen.append(set(handed))
            return list(boards)
        handed_seen = handed
        with mock.patch.object(found_boards.board_yield, 'not_read_since', seen):
            self.read([board('TRANS.BG', 'trans.bg')], early=False)
        self.gate.set()
        running.join(10)
        self.assertEqual(handed, [set()], 'nothing handed while the early read has no pages')
        self.read([board('TRANS.BG', 'trans.bg')], early=False)
        self.assertIsNotNone(found_boards._early['alo.bg'][1], 'finished: its pages are the full read\'s')


class NamedLaterTests(unittest.TestCase):
    def test_only_the_boards_that_started_are_said_and_read(self):
        """Gitar on #4145: "also reading X" named a board another read took between pick and start."""
        from src.sources import board_later
        said, taken = [], {'taken.example'}
        with mock.patch('builtins.print', lambda *a, **k: said.append(' '.join(map(str, a)))):
            futures = board_later.join([board('Free', 'free.example'), board('Taken', 'taken.example')], list, set(), 5,
                                       lambda b: None if b['host'] in taken else 'future')
        self.assertEqual(futures, ['future'])
        self.assertEqual(said, ['Job boards: also reading Free, named for your search meanwhile'])

if __name__ == '__main__':
    unittest.main()
