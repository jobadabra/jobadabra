"""The employer sites past the first-jobs slice are downloaded from second 0 and the full read takes them (src/sources/feed_scan.py EarlySites).
sa's read of 32 Search check logs (11 Nov 2026): the full read started when the slice ended, 96-121 s into the press and past the read cut, and read
"0 of 130 sites" for every person with more than the slice's 15 employers. Fake sites only; the clock is set, never waited for."""
import sqlite3
import tempfile
import threading
import time
import unittest
from concurrent.futures import wait
from pathlib import Path
from unittest import mock

from src import time_budget
from src.sources import feed_scan, feeds

TABLE = 'CREATE TABLE feed_jobs (board TEXT, id TEXT, fingerprint TEXT, first_seen TEXT, last_seen TEXT, PRIMARY KEY(board, id))'


def job(i):
    return {'id': str(i), 'title': 'Site Reliability Engineer', 'location': 'Zurich, Switzerland', 'url': f'https://x.test/{i}',
            'date_posted': '', 'description': 'd', 'remote': False, 'salary': ''}


class EarlySitesTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        patch = mock.patch('src.paths.DATA', Path(self.tmp.name))
        patch.start()
        self.addCleanup(patch.stop)
        self.addCleanup(self.tmp.cleanup)
        self.addCleanup(lambda: time_budget.start(0))
        self.db = sqlite3.connect(':memory:')
        self.db.execute(TABLE)
        self.sources = [{'company': f'Co{i}', 'ats': 'lever', 'slug': f's{i}'} for i in range(12)]
        self.reads, self.lock = [], threading.Lock()

    def fetcher(self, source):
        with self.lock:
            self.reads.append(source['slug'])
        return [job(int(source['slug'][1:]))]

    def past_the_cut(self):
        time_budget.start(180, now=time.monotonic() - 120)   # the press began 120 s ago: its read cut (90 s) is behind

    def test_past_the_cut_the_full_read_takes_the_sites_read_since_second_0_and_reads_none_twice(self):
        time_budget.start(180)
        early = feed_scan.EarlySites(self.sources, self.db, skip=self.sources[:2], fetcher=self.fetcher)
        self.addCleanup(early.close)
        wait(early.reads.values(), timeout=30)
        self.assertEqual(sorted(self.reads), sorted(f's{i}' for i in range(2, 12)), 'every site but the slice\'s two was read beside the slice')
        self.past_the_cut()
        report = feeds.scan(self.sources[2:], self.db, fetcher=self.fetcher, details={}, early=early)
        self.assertEqual(len(self.reads), 10, 'no site is read a second time')
        self.assertEqual([s['company'] for s in report['sources']], [f'Co{i}' for i in range(2, 12)], 'the full read holds all 10 sites, in read order')
        self.assertEqual(len(report['jobs']), 10)

    def test_a_sites_turn_is_its_place_in_the_full_read_order_the_slices_sites_counted(self):
        """Review of #3832: the floor (the first READ_FLOOR sites beat the read's time) is counted over the full order, as in scan; counted over the
        remainder it also protected the first sites past the slice."""
        time_budget.start(180)
        turns = []
        with mock.patch('src.sources.read_budget.over', side_effect=lambda stop, n: turns.append(n) or False):
            early = feed_scan.EarlySites(self.sources, self.db, skip=self.sources[:2], fetcher=self.fetcher)
            self.addCleanup(early.close)
            wait(early.reads.values(), timeout=30)
        self.assertEqual(sorted(turns), list(range(2, 12)))

    def test_positive_control_without_them_a_full_read_that_starts_past_the_cut_reads_nothing(self):
        self.past_the_cut()
        report = feeds.scan(self.sources, self.db, fetcher=self.fetcher, details={})
        self.assertEqual((self.reads, report['sources']), ([], []), 'the state every log showed: "read 0 of N sites"')

    def test_a_site_whose_turn_comes_after_the_reads_time_is_left_for_the_next_search(self):
        self.past_the_cut()
        early = feed_scan.EarlySites(self.sources, self.db, fetcher=self.fetcher)
        self.addCleanup(early.close)
        wait(early.reads.values(), timeout=30)
        report = feeds.scan(self.sources, self.db, fetcher=self.fetcher, details={}, early=early)
        self.assertEqual((self.reads, report['sources']), ([], []), 'nothing starts past the cut, read ahead or not')


if __name__ == '__main__':
    unittest.main()
