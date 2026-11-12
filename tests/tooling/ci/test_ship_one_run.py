"""Guard: release — a second tools/ship.sh on a worktree whose first run is alive is refused. Without this, the second run rebases and pushes the same checkout beside the first and truncates its log
(3 escapes in 30 days: #3370 closed empty on 7 Nov, #3803 on 11 Nov, #3917 on 12 Nov). The lock is a pid file in the worktree's own git dir, checked with kill -0; a stale one is ignored.
Fixture: tests/ship_fixture.py (throwaway origin, stub push hook)."""
import os
import re
import signal
import subprocess
import time
import unittest
from pathlib import Path

from tests.ship_fixture import ShipFixture, git


class ShipOneRunTest(ShipFixture):
    def pidfile(self, tree):
        return Path(git(tree, 'rev-parse', '--path-format=absolute', '--git-dir')) / 'ship-run.pid'

    def background(self, tree, log, *flags):
        return subprocess.run(['bash', str(tree / 'tools' / 'ship.sh'), '--background', *flags], cwd=tree, capture_output=True, text=True, timeout=60, env={**os.environ, 'SHIP_LOG': str(log)})

    def wait_for(self, log, pattern):
        for _ in range(120):
            if log.exists() and re.search(pattern, log.read_text(), re.M):
                return log.read_text()
            time.sleep(0.25)
        self.fail(f'{pattern} never reached {log}: {log.read_text() if log.exists() else "(no log)"}')

    def slow_first_run(self, seconds):
        self.change(self.tree, 'tools/pre-push-check.sh', f'#!/bin/sh\ncat > /dev/null\nsleep {seconds}\n', 'Slow hook')
        log = self.tmp / 'ship.log'
        first = self.background(self.tree, log)
        self.assertEqual(first.returncode, 0, first.stderr)
        pid = int(re.search(r'\(pid (\d+)\)', first.stdout).group(1))
        self.wait_for(log, 'running the push checks')
        return log, pid

    def test_a_second_run_on_a_live_worktree_is_refused_and_the_first_goes_on(self):
        log, pid = self.slow_first_run(4)
        before = log.read_text()
        second = self.background(self.tree, log)
        self.assertNotEqual(second.returncode, 0, 'the second run started beside a live one')
        self.assertIn(str(pid), second.stderr)
        self.assertIn(str(log), second.stderr)
        self.assertIn('kill -0', second.stderr)
        self.assertTrue(log.read_text().startswith(before), 'the second run truncated or rewrote the first run\'s log')
        self.assertRegex(log.read_text(), rf'(?m)^ship: FAILED refused: .*pid {pid}', 'a waiting caller must be woken by the refusal')
        done = self.wait_for(log, r'^ship: DONE')
        self.assertEqual(done.count('ship: DONE'), 1, done)
        self.assertFalse(self.pidfile(self.tree).exists(), 'the pid file outlived its run')

    def test_a_stale_pid_file_does_not_block_and_is_replaced(self):
        dead = subprocess.Popen(['true']); dead.wait()
        self.pidfile(self.tree).write_text(f'{dead.pid}\n')
        self.change(self.tree, 'b.txt', 'b\n', 'Change')
        log = self.tmp / 'ship.log'
        self.assertEqual(self.background(self.tree, log).returncode, 0)
        self.wait_for(log, r'^ship: DONE')
        self.assertFalse(self.pidfile(self.tree).exists())

    def test_runs_racing_for_one_stale_lock_let_exactly_one_through(self):
        # Gitar on #3921: two runs reading the same stale file could each rm the other's fresh lock and both go on.
        self.change(self.tree, 'tools/pre-push-check.sh', '#!/bin/sh\ncat > /dev/null\nsleep 6\n', 'Slow hook')
        for round_ in range(3):
            dead = subprocess.Popen(['true']); dead.wait()
            self.pidfile(self.tree).write_text(f'{dead.pid}\n')
            logs = [self.tmp / f'race-{round_}-{n}.log' for n in range(6)]
            runs = [subprocess.Popen(['bash', str(self.tree / 'tools' / 'ship.sh'), '--background'], cwd=self.tree, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                     env={**os.environ, 'SHIP_LOG': str(log)}) for log in logs]
            codes = [run.wait(timeout=60) for run in runs]
            self.assertEqual(codes.count(0), 1, f'round {round_}: {codes}: more or fewer than one run took the stale lock')
            for run in runs:
                run.stdout.close(); run.stderr.close()
            owner = int(self.pidfile(self.tree).read_text().split()[0])
            os.kill(owner, signal.SIGTERM)
            for _ in range(40):
                if not self.pidfile(self.tree).exists():
                    break
                time.sleep(0.25)

    def test_a_live_pid_that_is_not_a_ship_run_does_not_block(self):
        other = subprocess.Popen(['sleep', '30'])   # a reused pid: alive, but not tools/ship.sh
        self.addCleanup(other.kill)
        self.pidfile(self.tree).write_text(f'{other.pid}\n')
        self.change(self.tree, 'b.txt', 'b\n', 'Change')
        log = self.tmp / 'ship.log'
        self.assertEqual(self.background(self.tree, log).returncode, 0)
        self.wait_for(log, r'^ship: DONE')

    def test_another_worktree_is_not_blocked(self):
        log, pid = self.slow_first_run(4)
        subprocess.run(['sh', str(self.main / 'tools' / 'worktree.sh'), 'topic2'], cwd=self.main, check=True, capture_output=True)
        tree2 = self.main / '.claude' / 'worktrees' / 'topic2'
        self.change(tree2, 'c.txt', 'c\n', 'Other change')
        log2 = self.tmp / 'ship2.log'
        self.assertEqual(self.background(tree2, log2).returncode, 0)
        self.wait_for(log2, r'^ship: DONE')
        self.wait_for(log, r'^ship: DONE')

    def test_a_signal_removes_the_pid_file(self):
        log, pid = self.slow_first_run(30)
        self.assertTrue(self.pidfile(self.tree).exists())
        os.kill(pid, signal.SIGTERM)
        self.wait_for(log, r'^ship: FAILED')
        for _ in range(40):
            if not self.pidfile(self.tree).exists():
                break
            time.sleep(0.25)
        self.assertFalse(self.pidfile(self.tree).exists())
        self.change(self.tree, 'b.txt', 'b\n', 'Change after the stop')
        self.assertEqual(self.background(self.tree, self.tmp / 'again.log').returncode, 0, 'a stopped run left the worktree locked')


if __name__ == '__main__':
    unittest.main()
