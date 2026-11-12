"""A job board's first jobs are judged while the rest of it is still being read (src/sources/board_rounds.py): in a first search each round of a
board's read (one search word in one place) hands its jobs on as it ends, so a board cut at the search's end after round 1 gives what round 1
read, where it gave 0 (night 43313523472: p3 Brussels had 8 boards open at 124 s and 0 board jobs). No AI call and no live site here."""
import json
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


SEARCH = {'jobs_board_search_queries': ['menuisier', 'charpentier'], 'role_keywords': ['carpenter'],
          'locations': {'top_tier': ['Brussels'], 'country_wide': [], 'abroad': []}}


def board(n):
    return {'name': f'Board {n}', 'host': f'b{n}.example', 'search_url': f'https://b{n}.example/?q={{role}}', 'countries': ['Belgium'],
            'kinds': ['any'], 'source_kind': 'general'}


def job(n, k):
    return {'title': 'Menuisier', 'url': f'https://b{n}.example/{k}', 'company': 'Atelier', 'location': 'Brussels'}


def page(url, title):
    posting = {'@context': 'https://schema.org', '@type': 'JobPosting', 'title': title, 'url': url,
               'hiringOrganization': {'@type': 'Organization', 'name': 'Atelier'},
               'jobLocation': {'@type': 'Place', 'address': {'addressLocality': 'Brussels', 'addressCountry': 'BE'}}}
    return f'<html><script type="application/ld+json">{json.dumps(posting)}</script><body>x</body></html>'


class OneBoardsRounds(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        for patch in (mock.patch('src.paths.DATA', Path(tmp.name)), mock.patch('src.places.load', return_value={})):
            patch.start()
            self.addCleanup(patch.stop)

    def test_each_round_hands_on_its_own_new_jobs_once(self):
        """Two search words: two rounds, each handed as it ends; a job the second page lists again is not handed twice."""
        pages = {'menuisier': page('https://b1.example/1', 'Menuisier'), 'charpentier': page('https://b1.example/1', 'Menuisier')}
        rounds = []
        jobs, state, _ = found_boards.read_board(board(1), SEARCH, fetch=lambda url: pages[url.split('q=')[1]], early=True,
                                                 on_round=lambda found: rounds.append([j['url'] for j in found]))
        self.assertEqual(state, 'ok')
        self.assertEqual(rounds, [['https://b1.example/1']], 'round 1 handed its job; round 2 found only the same one, so it hands none')
        self.assertEqual([j['url'] for j in jobs], ['https://b1.example/1'], 'the board\'s result is what it was')


class RoundsInTheRead(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.rest = threading.Event()   # the board's later rounds end only when the test lets them (a state, never a fixed wait)
        self.addCleanup(self.rest.set)
        for patch in (mock.patch('src.paths.DATA', Path(tmp.name)), mock.patch.object(board_ideas, 'load', return_value={'boards': {}}),
                      mock.patch.object(board_ideas, 'save'), mock.patch.object(found_boards, '_dead', return_value=set()),
                      mock.patch.object(found_boards.board_employers, 'note'), mock.patch('builtins.print')):
            patch.start()
            self.addCleanup(patch.stop)

    def four_rounds(self, b, search, fetch, route=None, early=False, show=None, on_round=None):
        """A board whose 4 rounds give one job each; rounds 2-4 wait for self.rest."""
        n = b['host'][1]
        found = []
        for k in range(1, 5):
            if k > 1:
                self.rest.wait(5)   # hang guard: 5 s
            found.append(job(n, k))
            if on_round is not None:
                on_round([found[-1]])
        return found, 'ok', None

    def test_a_board_cut_after_its_first_round_gives_that_rounds_jobs(self):
        self.addCleanup(time_budget.start, 0)
        time_budget.start(180)
        handed, later = [], []
        cut = time_budget.now() + 0.5   # the search's end comes while rounds 2-4 are still being read
        with mock.patch.object(found_boards, 'read_board', self.four_rounds), mock.patch.object(read_budget, 'cut_at', return_value=cut), \
                mock.patch.object(late_reads, 'when_done', side_effect=lambda future, kind, host, keep: later.append(host)):
            jobs = found_boards.read(SEARCH, [board(1)], early=True, workers=1, is_relevant=list, dead=set(),
                                     on_board=lambda found: handed.append([j['url'] for j in found]))
        self.assertEqual(handed, [['https://b1.example/1']], 'round 1\'s job reached the judge before the cut')
        self.assertEqual([j['url'] for j in jobs], ['https://b1.example/1'], 'and is in the read\'s list')
        self.assertFalse(self.rest.is_set(), 'positive control: rounds 2-4 were still being read at the cut')

    def cut_soon(self):
        """The search's end 0.5 s from now, while rounds 2-4 wait for self.rest; -> the patches to enter."""
        self.addCleanup(time_budget.start, 0)
        time_budget.start(180)
        return (mock.patch.object(read_budget, 'cut_at', return_value=time_budget.now() + 0.5),
                mock.patch.object(late_reads, 'when_done'))

    def test_a_spare_read_in_place_of_a_refusing_board_hands_its_rounds_in_that_boards_turn(self):
        handed = []

        def refusing_first(b, *args, **kwargs):
            if b['host'] == 'b1.example':
                return [], 'browser', None
            return self.four_rounds(b, *args, **kwargs)
        cut, late = self.cut_soon()
        with mock.patch.object(found_boards, 'read_board', refusing_first), cut, late, \
                mock.patch.object(found_boards.board_yield, 'pick', side_effect=lambda boards, *a, **k: list(boards)):
            jobs = found_boards.read(SEARCH, [board(1)], early=True, workers=1, is_relevant=list, dead=set(), spare=[board(3)],
                                     on_board=lambda found: handed.append([j['url'] for j in found]))
        self.assertEqual(handed, [['https://b3.example/1']], 'the spare\'s round 1 reached the judge before the cut')
        self.assertEqual([j['url'] for j in jobs], ['https://b3.example/1'])

    def test_a_board_named_later_hands_its_rounds_too(self):
        handed = []
        cut, late = self.cut_soon()
        with mock.patch.object(found_boards, 'read_board', self.four_rounds), cut, late, \
                mock.patch.object(found_boards.board_yield, 'pick', side_effect=lambda boards, *a, **k: list(boards)):
            jobs = found_boards.read(SEARCH, [board(1)], early=True, workers=2, is_relevant=list, dead=set(), later=lambda: [board(2)],
                                     on_board=lambda found: handed.append([j['url'] for j in found]))
        self.assertEqual(sorted(handed), [['https://b1.example/1'], ['https://b2.example/1']], 'both boards\' round 1 judged before the cut')
        self.assertEqual([j['url'] for j in jobs], ['https://b1.example/1', 'https://b2.example/1'], 'in the list\'s order')

    def test_a_board_that_ends_gives_the_same_jobs_each_judged_once(self):
        handed = []

        def on_board(found):
            handed.extend(j['url'] for j in found)
            if handed == ['https://b1.example/1']:
                self.rest.set()   # round 1 handed while the board was still open: the rest may come now
        with mock.patch.object(found_boards, 'read_board', self.four_rounds):
            jobs = found_boards.read(SEARCH, [board(1), board(2)], early=True, workers=1, is_relevant=list, dead=set(), on_board=on_board)
        everything = [f'https://b{n}.example/{k}' for n in (1, 2) for k in range(1, 5)]
        self.assertEqual(sorted(handed), everything, 'every job handed on, none twice')
        self.assertEqual([j['url'] for j in jobs], everything, 'in = out: the read returns every job once, in the list\'s order')

    def test_a_read_with_no_one_to_hand_to_reads_as_before(self):
        """No on_board (the full read): no round is handed, and a stand-in read_board without on_round still works."""
        def plain(b, search, fetch, route=None, early=False, show=None):
            return [job(b['host'][1], 1)], 'ok', None
        with mock.patch.object(found_boards, 'read_board', plain):
            jobs = found_boards.read(SEARCH, [board(1)], early=True, workers=1, is_relevant=list, dead=set())
        self.assertEqual([j['url'] for j in jobs], ['https://b1.example/1'])


if __name__ == '__main__':
    unittest.main()
