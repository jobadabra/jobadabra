"""Guard: release — the gate's "Fix ledger kept" step judges what THIS PR changed, never what main changed after the PR started, so a rerun or an edit on a branch behind main is not red for a change it never made.
Why (10 Nov 2026, fr; #3643, Guard rerun 01:03Z): tools/press-ledger-check.py read the lock from the current origin/main; #3649 had changed it after #3643's base, so the check said #3643 "changes or removes" L01 and L04.
It now compares with `git merge-base <base> HEAD`. Runs the real script in a throwaway repo: main moves the lock after the branch left it."""
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
LOCK = 'tests/unit/press/ledger.lock.json'


@unittest.skipUnless(shutil.which('git'), 'needs git')
class OwnBaseTest(unittest.TestCase):
    def setUp(self):
        self.repo = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.repo, True)
        self.git('init', '-q', '-b', 'main')
        self.git('config', 'user.email', 't@example.test')
        self.git('config', 'user.name', 't')
        self.lock({'L01': {'hash': 'a', 'gets': 'the first 3 jobs are scored'}})
        self.git('add', '-A'); self.git('commit', '-q', '-m', 'base')
        self.git('branch', 'pr')   # the PR leaves main here

    def git(self, *args):
        subprocess.run(['git', *args], cwd=self.repo, check=True, capture_output=True)

    def lock(self, rows):
        path = self.repo / LOCK
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(rows))

    def check(self, body=''):
        return subprocess.run([sys.executable, str(ROOT / 'tools' / 'press-ledger-check.py'), '--base', 'main'], cwd=self.repo, input=body, capture_output=True, text=True)

    def test_main_moving_the_lock_after_the_branch_left_is_not_the_prs_change(self):
        self.lock({'L01': {'hash': 'b', 'gets': 'the first 3 jobs are scored'}})   # another PR changed L01 on main
        self.git('add', '-A'); self.git('commit', '-q', '-m', 'main moves the lock')
        self.git('checkout', '-q', 'pr')
        result = self.check()
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_the_prs_own_change_still_needs_the_owners_words(self):
        self.git('checkout', '-q', 'pr')
        self.lock({'L01': {'hash': 'c', 'gets': 'the first 3 jobs are scored'}})
        self.git('add', '-A'); self.git('commit', '-q', '-m', 'the PR changes L01')
        refused = self.check()
        self.assertEqual(refused.returncode, 1)
        self.assertIn('L01 (changed', refused.stderr)
        self.assertEqual(self.check('Ledger-change: L01 "the owner said so"').returncode, 0)


if __name__ == '__main__':
    unittest.main()
