"""A step ended by the app at the press's 180 s (desktop/lib/search-steps.js) can be killed in the middle of saving: the tracker stays whole."""
import os
import shutil
import signal
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

from src.stores import sqlite
from tests.store_contract import JOB

WRITER = """
import sys
from src.stores import sqlite
store = sqlite.open_store({'JOBADABRA_DATA_DIR': sys.argv[1]})
print('ready', flush=True)
n = 0
while True:
    store.applications.create({**%r, 'url': 'https://example.test/job/%%d' %% n}, 'Saved')
    n += 1
""" % (JOB,)


class KilledMidWriteTests(unittest.TestCase):
    def test_a_writer_killed_without_warning_leaves_every_saved_item_whole(self):
        folder = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, folder, True)
        child = subprocess.Popen([sys.executable, '-c', WRITER, str(folder)], stdout=subprocess.PIPE, text=True,
                                 cwd=Path(__file__).resolve().parents[3])
        self.addCleanup(child.kill)
        self.assertEqual(child.stdout.readline().strip(), 'ready')
        time.sleep(0.5)   # long enough that it is saving items, not starting
        os.kill(child.pid, signal.SIGKILL)   # SIGKILL: no handler runs, the worst case of the app's hard end
        child.wait()
        store = sqlite.open_store({'JOBADABRA_DATA_DIR': str(folder)})
        rows = store.applications.list()
        self.assertGreater(len(rows), 0, 'the items saved before the kill are kept')
        for row in rows:
            self.assertTrue(row['url'].startswith('https://example.test/job/'), 'every kept item is whole')
        db = sqlite3.connect(next(folder.rglob('tracker.sqlite')))
        self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0], 'ok')


class StopReasonTests(unittest.TestCase):
    """The app's hard end (a time-up) is told apart from a Stop press: its row is not Failed and does not say Stop was pressed."""
    def test_a_time_up_marker_makes_the_stop_an_ended_by_time_row(self):
        from unittest import mock
        from src.notion import cron_runs
        marker = Path(tempfile.mkdtemp()) / 'timeup'
        self.addCleanup(shutil.rmtree, marker.parent, True)
        with mock.patch.dict(os.environ, {'JOBADABRA_TIME_UP_FILE': str(marker)}):
            self.assertEqual(cron_runs.stop_reason(), (cron_runs.STOPPED_WORDS, True, True), 'no marker: a Stop press')
            marker.write_text('')
            self.assertEqual(cron_runs.stop_reason(), (cron_runs.TIME_UP_WORDS, False, False))


TIME_UP_CHILD = """
import os, sys, threading, time
from src.notion import cron_runs  # installs the SIGTERM handler
def wait_for_the_slow_board():
    password = 'sk-the-secret-value'
    time.sleep(60)
def the_main_thread_waits_here():
    token = 'person-name-in-a-local'
    print('ready', flush=True)
    time.sleep(60)
threading.Thread(target=wait_for_the_slow_board, daemon=True).start()
the_main_thread_waits_here()
"""


ROOT = Path(__file__).resolve().parents[3]


class TimeUpStacks(unittest.TestCase):
    """14 Nov 2026 (issue #4181): a search ended by the app's time-up left no trace of where its main thread waited. The stop writes every thread's stack, names only, never a value."""

    def run_child(self, marker_exists):
        folder = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, folder, True)
        marker = folder / 'timeup'
        if marker_exists:
            marker.write_text('')
        env = {**os.environ, 'JOBADABRA_TIME_UP_FILE': str(marker), 'PYTHONPATH': str(ROOT), 'JOBADABRA_API_SECRET': 'env-secret-value'}
        child = subprocess.Popen([sys.executable, '-c', TIME_UP_CHILD], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env=env, cwd=ROOT)
        self.assertEqual(child.stdout.readline().strip(), 'ready')
        time.sleep(0.3)   # the worker thread has started and sleeps; nothing here waits for an outcome of ours
        child.send_signal(signal.SIGTERM)
        out, _ = child.communicate(timeout=30)
        return out

    @unittest.skipIf(os.name == 'nt', 'POSIX signals')
    def test_a_time_up_writes_every_threads_stack_and_never_a_value(self):
        out = self.run_child(True)
        self.assertIn('Stacks of every thread', out)
        self.assertIn('the_main_thread_waits_here', out, 'the interrupted main thread')
        self.assertIn('wait_for_the_slow_board', out, 'a worker thread')
        for private in ('sk-the-secret-value', 'person-name-in-a-local', 'env-secret-value'):
            self.assertNotIn(private, out)
        self.assertIn('Ended at the search', out, 'the row words still follow the dump')

    @unittest.skipIf(os.name == 'nt', 'POSIX signals')
    def test_a_stop_press_writes_no_stacks(self):
        out = self.run_child(False)
        self.assertNotIn('Stacks of every thread', out)
        self.assertIn('Stopped before it finished', out)


if __name__ == '__main__':
    unittest.main()
