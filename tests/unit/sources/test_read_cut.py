"""No read holds a timed search past its cut (src/sources/read_budget.py cut_at; owner's run d4561921e533, 26 Oct 2026: no new employer site
after 2 minutes, but ~22 slow ones already open held the read until 5 min 37 s). One loop over every reader inside a run: employer sites,
job boards (also the boards the web search found, read the same way), the web search itself. A site that hangs is left, never waited for.
Design (E2b, 8 Nov 2026; the old test asserted `took < CUT + 1.5` on the wall clock and joined real threads): what this proves is what the code
DECIDES at the cut: it waits for an open site no longer than the cut, it leaves that site (the pool is not waited for) and keeps its late answer for
the next run. Those are functions of the clock and of which site never answers, so both are scripted (tests/unit/sources/scripted_read.py): the open
site is a future that never ends, the time to the cut is spent on the clock, a wait with no limit fails the test at once (the old code waited for the
site). No sleep, thread or load enters a result. Real threads: tests/unit/ai/test_three_minutes_resume.py."""
import io
import sqlite3
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

from src import time_budget
from src.sources import board_web, careers, feeds, found_boards, late_reads, read_budget
from tests.unit.sources import scripted_read
from tests.unit.sources.scripted_read import Hangs, StillOpen

TABLE = 'CREATE TABLE feed_jobs (board TEXT, id TEXT, fingerprint TEXT, first_seen TEXT, last_seen TEXT, PRIMARY KEY(board, id))'
CUT = 0.6   # scripted seconds from the run's start (read_budget.READ_SECONDS + READ_GRACE, patched below)
_READER = careers.READER


def setUpModule():   # no test here reaches a real model through a page read (guard: tests/unit/sources/test_found_boards_ai.py)
    careers.READER = None


def tearDownModule():
    careers.READER = _READER


def job(i):
    return {'id': str(i), 'title': 'First Officer A320', 'location': 'Vienna, Austria', 'url': f'https://x.test/{i}', 'date_posted': '',
            'description': 'd', 'remote': False, 'salary': ''}


def employer_sites(clock):
    db = sqlite3.connect(':memory:')
    db.execute(TABLE)

    def fetcher(source):
        n = int(source['slug'][1:])
        if n == 3:
            raise Hangs(lambda: ([job(3)], None))   # what the site gives if it ends after the cut
        return [job(n)]
    report = feeds.scan([{'company': f'Co{i}', 'ats': 'lever', 'slug': f's{i}'} for i in range(8)], db, fetcher=fetcher, details={})
    return sorted(source['company'] for source in report['sources'])


def job_boards(clock, web=True):
    def read_board(board, *args, **kwargs):
        if board['host'] == 'b3.test':
            raise Hangs(lambda: ([job('b3.test')], 'ok', None))
        return [job(board['host'])], 'ok', None
    boards = [{'host': f'b{i}.test', 'name': f'b{i}.test', 'search_url': f'https://b{i}.test/?q={{role}}'} for i in range(6)]
    with mock.patch('src.ai.board_ideas.load', return_value={'boards': {}}), mock.patch('src.ai.board_ideas.save'), \
            mock.patch.object(found_boards, 'read_board', side_effect=read_board), mock.patch.object(board_web, 'start', return_value=None), \
            mock.patch.object(found_boards.board_employers, 'note'):
        jobs = found_boards.read({'role_keywords': ['first officer']}, boards, fetch=lambda url: '', is_relevant=lambda found: found,
                                 dead=set(), web=web)
    return sorted(str(item['id']) for item in jobs)


def web_search(clock):
    future = StillOpen(clock, lambda: [])
    scripted_read.Pool.open.append(future)
    return board_web.finish((future, None), [])


READERS = {   # every reader a run waits for: (read, what it read, the late answer it keeps for the next run); a new one goes here with the site it leaves
    'employer sites': (employer_sites, lambda got: 'Co3' not in got and len(got) == 7, ('employer', 'lever:s3')),
    'job boards': (job_boards, lambda got: 'b3.test' not in got and len(got) == 5, ('board', 'b3.test')),
    "the web search's boards": (lambda clock: job_boards(clock, web=False), lambda got: 'b3.test' not in got and len(got) == 5, ('board', 'b3.test')),
    'the web search': (web_search, lambda got: got == [], None),
}


class NoReadHoldsTheRun(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.clock = scripted_read.Clock()
        self.pool = scripted_read.install(self, self.clock)
        for patch in (mock.patch('src.paths.DATA', Path(tmp.name)), mock.patch('src.paths.JOBS_DB', Path(tmp.name) / 'jobs.sqlite'),   # decide's cache
                      mock.patch.object(read_budget, 'READ_SECONDS', CUT / 2),
                      mock.patch.object(read_budget, 'READ_GRACE', CUT / 2, create=True)):
            patch.start()
            self.addCleanup(patch.stop)
        self.addCleanup(time_budget.start, 0)

    def read_alone(self, read):
        """One reader as its own run. -> (what it read, scripted seconds it took)."""
        time_budget.start(180)
        began = self.clock.now
        with redirect_stdout(io.StringIO()):
            got = read(self.clock)
        return got, self.clock.now - began

    def test_every_reader_leaves_a_hanging_site_at_the_cut(self):
        for name, (read, expected, kept) in READERS.items():
            with self.subTest(name):
                self.setUp()   # each reader its own run: its own clock, pools and kept pages
                got, took = self.read_alone(read)
                self.assertAlmostEqual(took, CUT, msg=f'{name}: waited {took:.2f} s for a site that hangs, the cut is at {CUT} s')
                self.assertTrue(expected(got), f'{name}: {got}')
                self.assertTrue(self.pool.open and not any(future.done() for future in self.pool.open), f'{name}: the hanging site must still be open')
                self.assertNotIn(True, self.pool.waited, f'{name}: the pool was waited for at the cut')
                for future in self.pool.open:   # the site answers after the cut: its page is kept for the next run
                    future.release()
                if kept:
                    self.assertIsNotNone(late_reads.take(*kept), f'{name}: the late answer of the site left at the cut is not kept')

    def test_without_a_budget_every_site_is_waited_for(self):
        time_budget.start(0)
        scripted_read.StillOpen.patient = True   # no cut: the site answers while it is waited for
        with redirect_stdout(io.StringIO()):
            got = employer_sites(self.clock)
        self.assertEqual(len(got), 8)

    def test_the_cut_counts_from_the_search_start_in_the_runs_own_budget(self):
        time_budget.start(180, now=100.0)
        self.assertEqual(read_budget.cut_at(), 100.0 + read_budget.READ_SECONDS + read_budget.READ_GRACE)
        time_budget.start(3, now=0.0)   # a 3-second run reads for the same part of its budget (time_budget.part)
        self.assertAlmostEqual(read_budget.cut_at(), (read_budget.READ_SECONDS + read_budget.READ_GRACE) * 3 / 180)


if __name__ == '__main__':
    unittest.main()
