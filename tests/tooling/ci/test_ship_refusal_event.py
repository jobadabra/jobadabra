"""A --background ship refused before it starts leaves a FAILED event, so a waiting tools/ship-wait.sh wakes at once.

Why (8 Nov 2026): ac's R1 body had no Before/After table; ship refused it in the foreground, wrote nothing to the log, and the session's
ship-wait.sh waited 6 h on a log that would never move.
"""
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from ship_fixture import ShipFixture, git  # noqa: E402


class RefusalLeavesAnEvent(ShipFixture):
    def test_bad_body_wakes_the_wait(self):
        self.change(self.tree, 'b.txt', 'b\n', 'Add b')
        body = self.tmp / 'body.md'
        body.write_text('just words, no layout\n')
        env = {**os.environ, 'TMPDIR': str(self.tmp)}
        run = subprocess.run(['bash', str(self.tree / 'tools' / 'ship.sh'), '--background', f'--body={body}'], cwd=self.tree, env=env,
                             capture_output=True, text=True, timeout=60)
        self.assertNotEqual(run.returncode, 0, run.stdout + run.stderr)
        log = self.tmp / 'ship-topic.log'
        wait = subprocess.run(['sh', str(self.tree / 'tools' / 'ship-wait.sh'), str(log)], env={**env, 'SHIP_WAIT_POLL': '1', 'SHIP_WAIT_CAP': '5'},
                              capture_output=True, text=True, timeout=30)
        self.assertEqual(wait.returncode, 0, wait.stdout)
        self.assertRegex(wait.stdout, r'^ship: FAILED \(exit 2\) refused before starting')
        self.assertEqual(git(self.origin, 'branch', '--list', 'topic'), '', 'nothing may be pushed')

    def test_a_started_run_read_through_head_is_no_refusal(self):
        """`ship.sh --background | head -1` closes the pipe after the fork: the parent's next echo fails, and that is not a refusal."""
        self.change(self.tree, 'b.txt', 'b\n', 'Add b')
        env = {**os.environ, 'TMPDIR': str(self.tmp)}
        subprocess.run(['bash', '-c', f'bash {self.tree / "tools" / "ship.sh"} --background | head -1'], cwd=self.tree, env=env,
                       capture_output=True, text=True, timeout=60)
        self.assertNotIn('refused before starting', (self.tmp / 'ship-topic.log').read_text())
