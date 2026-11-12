"""A reader the first-jobs slice took (#2918) is read once per press and its jobs still reach the full stage's report (statuses, counts); a failed read is not
taken. Tests: this file, tests/unit/sources/test_first_jobs_hub.py."""
import sqlite3
import unittest
from unittest import mock

from src.sources import aggregators, careers

_READER = careers.READER


def setUpModule():   # no page read reaches a real model from this file (tests/unit/sources/test_found_boards_ai.py)
    careers.READER = None


def tearDownModule():
    careers.READER = _READER

JOB = {'company': 'A', 'id': '1', 'title': 'Engineer', 'url': 'https://x/1', 'date_posted': '', 'description': '', 'location': 'Town', 'remote': False, 'salary': ''}


class TakenTest(unittest.TestCase):
    def setUp(self):
        aggregators.TAKEN.clear()
        self.addCleanup(aggregators.TAKEN.clear)
        self.db = sqlite3.connect(':memory:')
        patch = mock.patch.object(aggregators, 'kept', lambda db, name, found, now=None, shown=None, owed=None: [dict(j, source=name) for j in found])
        patch.start()
        self.addCleanup(patch.stop)

    def scan(self, read, early):
        return aggregators.scan(self.db, {'role_keywords': ['x']}, readers=[('EURES', read)], early=early)

    def test_a_taken_reader_is_not_read_again_and_its_jobs_stay_in_the_report(self):
        reads = []
        self.scan(lambda search: reads.append(1) or [JOB], early=True)
        report = self.scan(lambda search: reads.append(1) or [JOB], early=False)
        self.assertEqual(len(reads), 1, 'read once in the press')
        self.assertEqual([j['id'] for j in report['jobs']], ['1'], 'its jobs are in the full stage\'s report')
        self.assertEqual([s['company'] for s in report['sources']], ['EURES'])

    def test_a_failed_early_read_is_left_to_the_full_stage(self):
        def refused(search):
            raise OSError('down')
        self.scan(refused, early=True)
        self.assertEqual(aggregators.TAKEN, {})
        reads = []
        self.scan(lambda search: reads.append(1) or [JOB], early=False)
        self.assertEqual(len(reads), 1)


if __name__ == '__main__':
    unittest.main()
