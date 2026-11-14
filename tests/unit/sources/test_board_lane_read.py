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



class OneHostOneRead(unittest.TestCase):
    """d03 Chisinau (14 Nov 2026, run 155622): the pack's delucru.md and the web search's DeLucru.md were read as two boards, side by side, with
    two different search pages; one search read jobs the other never fetched. Two early reads of one search share their hosts."""
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        board_lanes.open_search(self)   # as boards_first.Beside does when a search's boards' lane starts
        self.addCleanup(board_lanes.close_search, self)
        for patch in (mock.patch('src.paths.DATA', Path(tmp.name)), mock.patch.object(board_ideas, 'load', return_value={'boards': {}}),
                      mock.patch.object(board_ideas, 'save'), mock.patch.object(found_boards, '_dead', return_value=set()),
                      mock.patch.object(found_boards.board_employers, 'note'), mock.patch('builtins.print'),
                      mock.patch.object(found_boards.board_yield, 'pick', side_effect=lambda boards, *a, **k: list(boards))):
            patch.start()
            self.addCleanup(patch.stop)

    def test_the_web_searchs_name_of_a_pack_board_is_not_read_again(self):
        read = []

        def read_board(b, search, fetch, route=None, early=False, show=None):
            read.append(b['search_url'])
            return [{'title': 'Developer', 'url': f"https://{b['host']}/job/{len(read)}"}], 'ok', None
        pack = {**board(1), 'name': 'delucru.md', 'host': 'delucru.md', 'search_url': 'https://delucru.md/jobs/{role}'}
        web = {**pack, 'name': 'DeLucru.md', 'search_url': 'https://www.delucru.md/jobs/it-software'}   # the same host (board_ideas._host), its own name and page
        with mock.patch.object(found_boards, 'read_board', read_board):
            first = found_boards.read(SEARCH, [pack], early=True, workers=1, is_relevant=list, dead=set(), fetch=lambda url: '')
            second = found_boards.read(SEARCH, [web, board(2)], early=True, workers=1, is_relevant=list, dead=set(), fetch=lambda url: '')
        self.assertEqual(read, ['https://delucru.md/jobs/{role}', 'https://b2.example/?q={role}'], 'delucru.md read once in the search')
        self.assertEqual(len(first), 1)
        self.assertEqual([j['url'] for j in second], ['https://b2.example/job/2'], 'the second read goes on to its other boards')

    def test_a_board_that_got_no_lane_is_read_by_the_next_read_of_the_search(self):
        """Gitar, #4268: the claim was kept when no lane came before the cut, so no read of the search read that host."""
        read = []

        def read_board(b, search, fetch, route=None, early=False, show=None):
            read.append(b['host'])
            return [{'title': 'Developer', 'url': f"https://{b['host']}/job/1"}], 'ok', None
        with mock.patch.object(found_boards, 'read_board', read_board):
            with mock.patch.object(board_lanes.Lanes, 'take', return_value=False):   # the first read's lanes stay full to its cut
                found_boards.read(SEARCH, [board(1)], workers=1, is_relevant=list, dead=set(), fetch=lambda url: '')
            jobs = found_boards.read(SEARCH, [board(1)], workers=1, is_relevant=list, dead=set(), fetch=lambda url: '')
        self.assertEqual(read, ['b1.example'], 'the read that got no lane read nothing and gave the host back')
        self.assertEqual([j['url'] for j in jobs], ['https://b1.example/job/1'])

    def test_a_spare_board_another_read_took_is_not_read_in_place_of_a_refusing_one(self):
        """Gitar, #4268: only the first board's host was claimed, so a spare read in its place could be a host another read of the search had."""
        read = []

        def read_board(b, search, fetch, route=None, early=False, show=None):
            read.append(b['host'])
            if b['host'] == 'b1.example':
                return [], 'browser', None   # refuses: a spare is read in its place
            return [{'title': 'Developer', 'url': f"https://{b['host']}/job/1"}], 'ok', None
        with mock.patch.object(found_boards, 'read_board', read_board):
            found_boards.read(SEARCH, [board(2)], early=True, workers=1, is_relevant=list, dead=set(), fetch=lambda url: '')
            found_boards.read(SEARCH, [board(1)], early=True, workers=1, spare=[board(2), board(3)], is_relevant=list, dead=set(),
                              fetch=lambda url: '')
        self.assertEqual(read, ['b2.example', 'b1.example', 'b3.example'], 'b2.example read once; the next spare reads in its place')

    def test_a_refused_host_is_not_asked_again_by_another_read_of_the_search(self):
        """Gitar on #4273 asked to give a refused spare's host back; a refusal can be a 403 or a bot check, and CLAUDE.md never retries a 401/403."""
        read = []

        def read_board(b, search, fetch, route=None, early=False, show=None):
            read.append(b['host'])
            return ([], 'browser', None) if b['host'] in ('b1.example', 'b2.example') else ([{'title': 'Developer', 'url': f"https://{b['host']}/job/1"}], 'ok', None)
        with mock.patch.object(found_boards, 'read_board', read_board):
            found_boards.read(SEARCH, [board(1)], early=True, workers=1, spare=[board(2), board(3)], is_relevant=list, dead=set(), fetch=lambda url: '')
            found_boards.read(SEARCH, [board(2), board(4)], early=True, workers=1, is_relevant=list, dead=set(), fetch=lambda url: '')
        self.assertEqual(read, ['b1.example', 'b2.example', 'b3.example', 'b4.example'], 'b2.example refused once and is not asked again')

    def test_a_board_that_was_not_read_shares_nothing_with_the_next_search(self):
        """Gitar on #4273: the not-read results were one list for every search; a consumer extending it would change them all."""
        self.assertEqual((found_boards.NO_LANE[0], found_boards.TAKEN[0]), ((), ()))

    def test_every_board_first_or_spare_gives_its_lane_back_and_keeps_its_host_only_when_asked(self):
        """Design (#4273): one way in for every board (board_lanes.read_in_lane). After the read no lane is held; the host stays claimed when it
        was asked (read or refused: never asked twice in a search) and is given back when no lane came (nothing asked)."""
        from src import time_budget
        for where in ('first', 'spare'):
            for outcome in ('read', 'refused', 'no lane'):
                with self.subTest(where=where, outcome=outcome):
                    board_lanes.open_search(self)
                    target, made = ('b1.example' if where == 'first' else 'b2.example'), []

                    class Spy(board_lanes.Lanes):
                        def __init__(self, *a, **k):
                            super().__init__(*a, **k)
                            made.append(self)

                        def take(self, key, wait=None):
                            return False if outcome == 'no lane' and key == target else super().take(key, wait)

                    def read_board(b, search, fetch, route=None, early=False, show=None):
                        if b['host'] == 'b1.example' and where == 'spare' or outcome == 'refused':
                            return [], 'browser', None
                        return [{'title': 'Developer', 'url': f"https://{b['host']}/job/1"}], 'ok', None
                    with mock.patch.object(found_boards, 'read_board', read_board), mock.patch.object(board_lanes, 'Lanes', Spy):
                        found_boards.read(SEARCH, [board(1)], early=True, workers=1, spare=[board(2)] if where == 'spare' else (), is_relevant=list,
                                          dead=set(), fetch=lambda url: '')
                    self.assertEqual([lanes.reading for lanes in made], [{}], 'no lane held after the read')
                    self.assertEqual(target in time_budget.CLOCK.board_hosts['hosts'], outcome != 'no lane')

    def test_a_new_search_reads_the_board_again(self):
        self.assertTrue(board_lanes.claim('delucru.md', 'read 1'))
        self.assertFalse(board_lanes.claim('delucru.md', 'read 2'))
        self.assertTrue(board_lanes.claim('delucru.md', 'read 1'), 'the read that took it keeps it (its own items of one host)')
        board_lanes.open_search('the next search')
        self.assertTrue(board_lanes.claim('delucru.md', 'read 2'), 'the next search starts with no host taken')
        board_lanes.close_search('the next search')
        self.assertTrue(board_lanes.claim('delucru.md', 'read 3'), 'no lane open: the full read and the scout claim nothing')


if __name__ == '__main__':
    unittest.main()
