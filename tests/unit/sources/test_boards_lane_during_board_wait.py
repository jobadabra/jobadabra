"""The boards lane's groups reach the job cache while the full board read is awaited (13 Nov 2026, c04 pair run 43517140431, PR side). The employer stage ended at 51 s, the
first-jobs slice at 62 s, and the main thread then sat in `ahead.wait()` until the last full-read board ended at 115 s: the lane's group (23 kept jobs, titled at 60 s) was kept
at 114 s ("matches 12 → 35"), so the scorer beside the search saw none of them and the run ended at 175 s with 11 jobs against 19 on main. The three triggers of
`Beside.deliver` (the slice's hub post, `on_read` after each employer site, `take_boards_first` after the gather) all end before that wait does.
Tests: an employer scan that ends first, a board read still open, and the lane's deliver called by the waiting thread when a group lands (no clock: the wait wakes on the lane's put
or the read's end); the same under load."""
import os
import tempfile
import threading
import unittest
from unittest import mock

from src import jobs_so_far, store
from src.sources import aggregators, boards_ahead

HANG_GUARD = 10   # seconds: only a guard against a hang when the hand-over is missing (the test then fails with its message)


class Lane:
    """What scan_beside needs of a boards_first.Beside: `wait` (the full read starts after the first pages) and `deliver` (the owner thread keeps what landed)."""
    def __init__(self, delivered):
        self.delivered, self.calls, self.arrived = delivered, 0, threading.Event()

    def wait(self):
        pass

    def deliver(self, _db, _on_jobs):
        self.calls += 1
        self.delivered.set()


LOCAL = threading.local()   # one press's lane and reads per thread: the patches below are made once for all of them (mock.patch is not thread-safe)


def one_run(tmp):
    """-> (delivered while the board read was still open, the lane's deliver calls) for an employer stage that ended before the boards."""
    delivered = threading.Event()
    lane = Lane(delivered)
    seen = []

    def read(_search):
        lane.arrived.set()   # the lane's group lands while the boards are still being read
        seen.append(delivered.wait(HANG_GUARD))   # the boards end only after the lane's group was handed over, or the guard
        return []
    LOCAL.read = read
    db = store.connect(f'{tmp}/jobs.sqlite')
    try:
        boards_ahead.scan_beside([], db, {}, jobs_so_far.SoFar(db, say=lambda _: None), due=True, scan=lambda *a, **k: {'jobs': []}, first=lane)
    finally:
        db.close()
    return seen[0], lane.calls


class HandOverDuringTheBoardWait(unittest.TestCase):
    def setUp(self):
        for patch in (mock.patch.object(aggregators, 'kept', side_effect=lambda _db, _name, found, *_args, **_kw: found),
                      mock.patch.object(boards_ahead, 'start', side_effect=lambda *a, **k: boards_ahead.Ahead({}, LOCAL.read))):
            patch.start()
            self.addCleanup(patch.stop)

    def test_the_lanes_group_is_kept_while_the_board_read_is_awaited(self):
        with tempfile.TemporaryDirectory() as tmp:
            handed, calls = one_run(tmp)
        self.assertTrue(handed, 'the employer stage ended first: the lane was never asked for its groups while the boards were awaited (boards_ahead.py ahead.wait)')
        self.assertGreaterEqual(calls, 1)

    def test_several_runs_at_once_each_hand_over_theirs(self):
        """A concurrency change: eight presses side by side (the app's side-by-side runs share nothing but the process)."""
        with tempfile.TemporaryDirectory() as tmp:
            results = []

            def run(n):
                os.makedirs(f'{tmp}/{n}')
                results.append(one_run(f'{tmp}/{n}'))
            threads = [threading.Thread(target=run, args=(n,)) for n in range(8)]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join(HANG_GUARD * 2)
        self.assertEqual([handed for handed, _ in results], [True] * 8)


if __name__ == '__main__':
    unittest.main()
