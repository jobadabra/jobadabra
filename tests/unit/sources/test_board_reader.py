"""Job boards as one reader (src/sources/board_reader.py, contract C3 of docs/superpowers/specs/2026-11-10-find-jobs-code-shape.md, cr 3/5): the
boards' first pages come as Listed jobs in today's order, and the reader keeps, judges and scores nothing (a reader never decides what is kept).
Half 1 of the proof (cr): the same boards in the same order give the same Listed jobs, and keeping them (aggregators.kept, as the run does)
gives the jobs the boards' lane keeps today (boards_first.Beside). Half 2 (sf's cutover: kept()/triage() called from src/daily_search.py) reuses the setUp of
test_boards_first.OldState and listed_then_kept below. Offline: the fixture of tests/unit/sources/test_boards_first.py (fake web search, fixture boards, fake jobs only)."""
import io
import unittest
from contextlib import redirect_stdout
from unittest import mock

from src.ai import slots
from src.sources import aggregators, board_reader, board_web, boards_ahead, boards_first, read_budget
from tests.unit.sources import test_boards_first as fixture   # the module, not its OldState class: its own tests run in their own file
from tests.unit.sources.test_boards_first import SEARCH, FakeClient, fetch, setUpModule, tearDownModule  # noqa: F401 (the page reader stays off)


def listed(where='before'):
    """The reader's early groups for SEARCH, with the web search's fake answer given at once: [(said, Listed jobs)], and the log."""
    with mock.patch.object(board_web, '_searcher', return_value=FakeClient()), redirect_stdout(io.StringIO()) as out:
        searching = board_web.early(SEARCH, fetch=fetch)
        groups = list(board_reader.read(None, SEARCH, early=True, where=where))
        searching.exception(timeout=10)
    return groups, out.getvalue()


def listed_then_kept(db):
    """What the run keeps of the reader's groups, kept one group at a time in the order read (the shape sf's cutover keeps them in)."""
    groups, _ = listed()
    return [job for _, jobs in groups for job in aggregators.kept(db, boards_ahead.NAME, jobs)]


def no_judging():
    """Patches that fail the test when the reader keeps or sorts titles (C3: what is kept is the run's)."""
    def refuse(name):
        return mock.Mock(side_effect=AssertionError(f'the board reader called {name}'))
    return mock.patch('src.sources.aggregators.kept', refuse('aggregators.kept')), mock.patch('src.sources.feeds.triage', refuse('feeds.triage'))


class BoardReaderTest(unittest.TestCase):
    setUp = fixture.OldState.setUp   # the owner's old state: boards read 37 min ago, a fake web search, fixture boards
    no_search_thread_left = fixture.OldState.no_search_thread_left

    def test_the_boards_first_pages_come_as_listed_jobs_in_todays_order_and_nothing_is_kept_here(self):
        patches = no_judging()
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)
        groups, out = listed()
        self.assertEqual([said for said, _ in groups], ['the 3 the web search found'], 'no board worked before: the web search\'s boards only')
        jobs = groups[0][1]
        self.assertEqual(sorted({job['url'].split('/')[2] for job in jobs}), ['crew-board.test', 'cv-board.test'], 'the quiet board lists no job')
        self.assertEqual(len(jobs), 14, 'every job the two boards list on their first pages: 8 by id, 6 by card')
        self.assertIn('Job boards first: reading the 3 the web search found, before the employer sites: '
                      'crew-board.test, cv-board.test, quiet-board.test', out)

    def test_the_beside_read_says_beside_in_the_line_the_find_jobs_card_reads(self):
        _, out = listed(where='beside')
        self.assertIn('Job boards first: reading the 3 the web search found, beside the employer sites', out)

    def test_keeping_what_the_reader_listed_keeps_what_the_boards_lane_keeps(self):
        with mock.patch.object(board_web, '_searcher', return_value=FakeClient()), redirect_stdout(io.StringIO()):
            searching = board_web.early(SEARCH, fetch=fetch)
            today = boards_first.Beside(SEARCH).take(self.db, lambda jobs: None)
            searching.exception(timeout=10)
        self.setUp()   # the same old state again: a fresh job cache, no board read early
        went_on = []   # read where the lane reads: in it, a board's slice hands its read-on to the lane (Beside.go_on), run here at once (ab, 14 Nov 2026)
        with slots.in_lane(read_budget.run_end(), lambda read_on, name: went_on.append(read_on(None))):
            again = listed_then_kept(self.db)
        seen = {job['url'] for job in again}
        again += aggregators.kept(self.db, boards_ahead.NAME, [job for more in went_on for job in more if job['url'] not in seen])
        self.assertEqual([job['url'] for job in again], [job['url'] for job in today])
        self.assertEqual(len(today), 17, "the two boards' 14 first-page jobs and the 3 more cv-board gives once its read goes on")

    def test_the_full_read_is_one_group_of_the_found_boards(self):
        calls = []
        with mock.patch('src.sources.found_boards.read', side_effect=lambda search, since=None: calls.append(since) or [{'url': 'u'}]):
            self.assertEqual(list(board_reader.read(None, SEARCH, since='2026-11-10T00:00:00+00:00')),
                             [('the found boards', [{'url': 'u'}])])
        self.assertEqual(calls, ['2026-11-10T00:00:00+00:00'])


if __name__ == '__main__':
    unittest.main()
