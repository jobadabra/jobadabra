"""Two first opens of one jobs file both succeed (10 Nov 2026, #3721): store.connect read the columns and then ran ALTER TABLE with no lock, so two openers of a
new or older file both added the same column and the second died ("duplicate column name"); that made the scorer test flaky on #3716 and #3718. The race is
forced here: the first opener holds just before its first ALTER until the second has asked. Code: src/store.py connect."""
import shutil
import sqlite3
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

from src import store


class FirstOpenTests(unittest.TestCase):
    def test_a_second_opener_that_comes_while_the_first_adds_the_columns_gets_them_and_neither_fails(self):
        folder = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, folder, True)
        path = Path(folder) / 'jobs.sqlite'
        real, errors = sqlite3.connect, []
        first_alter, second_asked = threading.Event(), threading.Event()

        def traced(*args, **kwargs):
            db = real(*args, **kwargs)
            who = threading.current_thread().name

            def statement(sql):
                if who == 'first' and sql.startswith('ALTER TABLE') and not first_alter.is_set():
                    first_alter.set()
                    second_asked.wait(60)   # a hang guard only: the second opener sets it when it asks for the lock or adds a column
                if who == 'second' and (sql.startswith('BEGIN IMMEDIATE') or sql.startswith('ALTER TABLE')):
                    second_asked.set()
            db.set_trace_callback(statement)
            return db

        def opener():
            try:
                store.connect(path).close()
            except Exception as error:  # noqa: BLE001 — the test's verdict: no opener fails
                errors.append(error)
            finally:
                if threading.current_thread().name == 'second':
                    second_asked.set()   # an opener that ended (or failed) never asks again

        with mock.patch.object(store.sqlite3, 'connect', side_effect=traced):
            first = threading.Thread(target=opener, name='first')
            first.start()
            self.assertTrue(first_alter.wait(60), 'positive control: the first opener reached its ALTER (a new file lacks the newer columns)')
            second = threading.Thread(target=opener, name='second')
            second.start()
            for thread in (first, second):
                thread.join(60)
        self.assertEqual(errors, [])
        with sqlite3.connect(path) as db:
            columns = {row[1] for row in db.execute('PRAGMA table_info(jobs)')}
        self.assertTrue({'posted_at', 'description', 'identity'} <= columns)


if __name__ == '__main__':
    unittest.main()
