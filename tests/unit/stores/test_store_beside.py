"""The waiting jobs' scores reach this Mac's Job Matches from the thread that scores them beside the search (ps E2a-1, 8 Nov 2026): that thread
gets its own connection to the tracker file, as the run's connection belongs to the run's thread (src/stores/beside.py)."""
import sqlite3
import tempfile
import threading
import unittest
from pathlib import Path

from src.stores import beside, memory, sqlite as tracker


def in_thread(fn):
    """fn() run in a new thread: (its result, the error it raised)."""
    out = {}

    def run():
        try:
            out['result'] = fn()
        except Exception as error:  # noqa: BLE001 — handed back to the test
            out['error'] = error
    thread = threading.Thread(target=run)
    thread.start()
    thread.join()
    return out.get('result'), out.get('error')


class BesideTest(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.stores = tracker.open_store({'JOBADABRA_DATA_DIR': folder.name})
        self.addCleanup(self.stores.matches.db.close)
        self.job = {'url': 'https://example.test/jobs/one', 'title': 'SRE', 'company': 'Example', 'status': 'Open', 'fit': 81}

    def test_the_run_s_own_connection_fails_in_another_thread(self):
        # The positive control: what a scoring thread would hit with the run's store.
        _, error = in_thread(lambda: self.stores.matches.upsert(self.job))
        self.assertIsInstance(error, sqlite3.ProgrammingError)

    def test_a_thread_beside_the_run_writes_job_matches_on_its_own_connection(self):
        here = beside.opener(self.stores)   # in the run's thread, as daily_search_scoring does

        def write():
            with here() as stores:
                stores.matches.upsert(self.job)
                return stores.matches.db
        own, error = in_thread(write)
        self.assertIsNone(error)
        self.assertIsNot(own, self.stores.matches.db)
        self.assertEqual([row['fit'] for row in self.stores.matches.list()], [81], 'the run reads what the thread wrote, from the same file')
        with self.assertRaises(sqlite3.ProgrammingError, msg='closed when the thread is done'):
            own.execute('SELECT 1')

    def test_a_store_with_nothing_bound_to_a_thread_is_shared(self):
        stores = memory.open_store()
        with beside.opener(stores)() as here:
            self.assertIs(here, stores)


if __name__ == '__main__':
    unittest.main()
