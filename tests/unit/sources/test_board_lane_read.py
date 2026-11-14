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
from src import time_budget
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


def new_search():
    """A search's refused set, as its clock's start opens it (src/press/clock.py), without the rest of a start."""
    time_budget.CLOCK.refused_hosts = set()


class AQuietBoardGivesItsLane(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.said = []
        for patch in (mock.patch('src.paths.DATA', Path(tmp.name)), mock.patch.object(board_ideas, 'load', return_value={'boards': {}}),
                      mock.patch.object(board_ideas, 'save'), mock.patch.object(found_boards, '_dead', return_value=set()),
                      mock.patch.object(found_boards.board_employers, 'note'), mock.patch('builtins.print'),
                      mock.patch.object(board_lanes, 'QUIET_S', 0.3), mock.patch.object(board_lanes, 'LOOK_S', 0.05),
                      mock.patch.object(board_lanes, 'said', side_effect=self.said.append),
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



class ARefusingHostIsAskedOnce(unittest.TestCase):
    """The search keeps one thing between its board reads: the hosts that refused (src/sources/board_lanes.py read_in_lane). Two pages of one
    host are both read (d03, 14 Nov 2026: delucru.md's pack page and its web search page gave different jobs; the read-once claim cost 2 right
    jobs in CI pair 43621918836); a host that refused is not asked again, on any page (CLAUDE.md: never retry a 401 or 403)."""
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        new_search()
        self.addCleanup(setattr, time_budget.CLOCK, 'refused_hosts', None)
        for patch in (mock.patch('src.paths.DATA', Path(tmp.name)), mock.patch.object(board_ideas, 'load', return_value={'boards': {}}),
                      mock.patch.object(board_ideas, 'save'), mock.patch.object(found_boards, '_dead', return_value=set()),
                      mock.patch.object(found_boards.board_employers, 'note'), mock.patch('builtins.print'),
                      mock.patch.object(found_boards.board_yield, 'pick', side_effect=lambda boards, *a, **k: list(boards))):
            patch.start()
            self.addCleanup(patch.stop)

    def read_board(self, refusing=()):
        self.read = []

        def read_board(b, search, fetch, route=None, early=False, show=None):
            self.read.append(b['search_url'])
            if b['host'] in refusing:
                return [], 'browser', None
            return [{'title': 'Developer', 'url': f"{b['search_url']}#job{len(self.read)}"}], 'ok', None
        return mock.patch.object(found_boards, 'read_board', read_board)

    def test_both_search_pages_of_one_host_are_read_in_one_search(self):
        pack = {**board(1), 'name': 'delucru.md', 'host': 'delucru.md', 'search_url': 'https://delucru.md/jobs/{role}'}
        web = {**pack, 'name': 'DeLucru.md', 'search_url': 'https://www.delucru.md/jobs/it-software'}   # the same host (board_ideas._host), its own page
        with self.read_board():
            first = found_boards.read(SEARCH, [pack], early=True, workers=1, is_relevant=list, dead=set(), fetch=lambda url: '')
            second = found_boards.read(SEARCH, [web], early=True, workers=1, is_relevant=list, dead=set(), fetch=lambda url: '')
        self.assertEqual(self.read, ['https://delucru.md/jobs/{role}', 'https://www.delucru.md/jobs/it-software'])
        self.assertEqual((len(first), len(second)), (1, 1), 'each page\'s jobs are kept')

    def test_a_host_that_refused_on_one_page_is_not_asked_on_its_other_page(self):
        pack = {**board(1), 'search_url': 'https://b1.example/jobs/{role}'}
        web = {**board(1), 'name': 'B1', 'search_url': 'https://b1.example/jobs/it'}
        with self.read_board(refusing={'b1.example'}):
            found_boards.read(SEARCH, [pack], early=True, workers=1, is_relevant=list, dead=set(), fetch=lambda url: '')
            jobs = found_boards.read(SEARCH, [web, board(2)], early=True, workers=1, is_relevant=list, dead=set(), fetch=lambda url: '')
        self.assertEqual(self.read, ['https://b1.example/jobs/{role}', 'https://b2.example/?q={role}'], 'b1.example refused once, asked once')
        self.assertEqual(len(jobs), 1)

    def test_a_refused_spare_is_not_asked_again_and_the_next_spare_reads(self):
        with self.read_board(refusing={'b1.example', 'b2.example'}):
            found_boards.read(SEARCH, [board(1)], early=True, workers=1, spare=[board(2), board(3)], is_relevant=list, dead=set(), fetch=lambda url: '')
            found_boards.read(SEARCH, [board(2), board(4)], early=True, workers=1, is_relevant=list, dead=set(), fetch=lambda url: '')
        self.assertEqual([url.split('/')[2] for url in self.read], ['b1.example', 'b2.example', 'b3.example', 'b4.example'])

    def test_a_board_that_got_no_lane_is_read_by_the_next_read_of_the_search(self):
        with self.read_board():
            with mock.patch.object(board_lanes.Lanes, 'take', return_value=False):   # the first read's lanes stay full to its cut
                found_boards.read(SEARCH, [board(1)], workers=1, is_relevant=list, dead=set(), fetch=lambda url: '')
            jobs = found_boards.read(SEARCH, [board(1)], workers=1, is_relevant=list, dead=set(), fetch=lambda url: '')
        self.assertEqual((len(self.read), len(jobs)), (1, 1), 'the read that got no lane asked nothing')

    def test_a_board_that_was_not_read_shares_nothing_with_the_next_search(self):
        """Gitar on #4273: the not-read results were one list for every search; a consumer extending it would change them all."""
        self.assertEqual((found_boards.NO_LANE[0], found_boards.REFUSED[0]), ((), ()))

    def test_every_board_first_or_spare_gives_its_lane_back(self):
        """Every board, first or spare, read, refused or with no lane: no lane is held after the read; only a refusal is kept."""
        for where in ('first', 'spare'):
            for outcome in ('read', 'refused', 'no lane'):
                with self.subTest(where=where, outcome=outcome):
                    new_search()
                    target, made = ('b1.example' if where == 'first' else 'b2.example'), []

                    class Spy(board_lanes.Lanes):
                        def __init__(self, *a, **k):
                            super().__init__(*a, **k)
                            made.append(self)

                        def take(self, key, wait=None, rank=0):
                            return False if outcome == 'no lane' and key == target else super().take(key, wait, rank)
                    refusing = {'b1.example'} if where == 'spare' else set()
                    with self.read_board(refusing=refusing | ({target} if outcome == 'refused' else set())), mock.patch.object(board_lanes, 'Lanes', Spy):
                        found_boards.read(SEARCH, [board(1)], early=True, workers=1, spare=[board(2)] if where == 'spare' else (), is_relevant=list,
                                          dead=set(), fetch=lambda url: '')
                    self.assertEqual([lanes.reading for lanes in made], [{}], 'no lane held after the read')
                    self.assertEqual(target in time_budget.CLOCK.refused_hosts, outcome == 'refused')

    def test_a_new_search_asks_a_refusing_host_again(self):
        time_budget.CLOCK.refused_hosts.add('b1.example')
        time_budget.start(60)   # the next search's clock (owner, 14 Nov 2026: "The search owns it")
        self.assertEqual(time_budget.CLOCK.refused_hosts, set(), 'the next search starts with no host refused')
        time_budget.start(None)
        self.assertIsNone(time_budget.CLOCK.refused_hosts, 'no search clock (the scout, tests): nothing kept')

if __name__ == '__main__':
    unittest.main()
