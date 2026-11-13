"""Guard: READY needs GitHub's own merge state "clean", not only the newest check row per name (web #459, 6 Nov 2026: a push and a body edit started two runs of the gate,
one cancelled the other; the watcher read the newest row (green) and Gitar approved, GitHub's merge state read BLOCKED beside the cancelled twin, the owner saw a red X).
Runs the real watcher against the fake gh of tests/fake_gh_rest.py (answers from files, no network)."""
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


@unittest.skipUnless(shutil.which('jq') and shutil.which('bash'), 'needs jq and bash')
class ShipWatchReadyCleanTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        (self.tmp / 'bin').mkdir()
        gh = self.tmp / 'bin' / 'gh'
        gh.write_text(f'#!/bin/sh\nexec "{sys.executable}" "{ROOT / "tests" / "fake_gh_rest.py"}" "$@"\n')
        gh.chmod(gh.stat().st_mode | stat.S_IEXEC)
        (self.tmp / 'fix.sh').write_text('#!/bin/sh\nexit 0\n')
        self.log, self.pidfile = self.tmp / 'ship.log', self.tmp / 'watch.pid'

    def watch(self, mergestates, twins='', labels='Gitar: approved'):
        """One look per line of mergestates, then the PR closes. Every look: Gitar approved, the gate green (newest row), no draft."""
        self.log.write_text('ship: opened\n')
        looks = len(mergestates)
        files = {'states': 'OPEN\n' * looks + 'CLOSED\n', 'drafts': 'false\n' * (looks + 1), 'labels': (labels + '\n') * (looks + 1), 'mergeables': '', 'fixes': '', 'checks': '', 'runs': 'gate\n' * (looks + 1),
                 'verdicts': '', 'heads': '', 'looks': '0', 'mergestates': '\n'.join(mergestates) + '\n', 'twins': twins}
        for name, text in files.items():
            (self.tmp / name).write_text(text)
        env = {**os.environ, 'CODEX_THREAD_ID': '', 'CODEX_SESSION_ID': '', 'CMUX_SURFACE_ID': '', 'PATH': f'{self.tmp / "bin"}{os.pathsep}{os.environ["PATH"]}', 'FAKE_GH_DIR': str(self.tmp),
               'PR_REST_CACHE': str(self.tmp / 'cache'), 'SHIP_WATCH_POLL': '0', 'SHIP_WATCH_CAP': '60', 'SHIP_WATCH_FIX': str(self.tmp / 'fix.sh')}
        env.pop('SHIP_WATCH_DRAFT_OK', None)
        subprocess.run(['bash', str(ROOT / 'tools' / 'ship-watch.sh'), '7', str(self.log), str(self.pidfile), 'o/r'], env=env, timeout=30, check=True)
        return self.log.read_text().splitlines()[1:]

    def test_the_459_case_is_not_ready(self):
        """Green newest row, a cancelled twin beside it, merge state BLOCKED: GREEN may be said, READY never."""
        lines = self.watch(['blocked', 'blocked'], twins='cancelled')
        self.assertFalse(any('READY' in line for line in lines), lines)

    def test_ready_comes_when_the_merge_state_turns_clean_and_only_once(self):
        lines = self.watch(['blocked', 'clean', 'clean'])
        self.assertEqual([line for line in lines if 'READY' in line], ['ship: READY #7 new1'], lines)

    def test_a_stale_approval_beside_a_pending_gitar_label_is_never_ready(self):
        """11 Nov 2026: the label keeps the older verdict beside "reviewing" / "not started"; READY needs the approval to be for the current head."""
        for pending in ('Gitar: reviewing', 'Gitar: not started'):
            lines = self.watch(['clean', 'clean'], labels=f'Gitar: approved,{pending}')
            self.assertFalse(any('READY' in line for line in lines), (pending, lines))

    def test_a_pr_with_a_claude_label_is_ready_on_claude_approved_only(self):
        """13 Nov 2026 (cr 2a, owner: "replace Gitar with Claude Code review"): a PR carrying a "Claude: …" label is READY only on "Claude: approved"; Gitar's approval beside another Claude state never counts, and "· not re-reviewed" is an older head."""
        ready = lambda labels: any('READY' in line for line in self.watch(['clean', 'clean'], labels=labels))
        self.assertTrue(ready('Claude: approved'))
        self.assertTrue(ready('Claude: approved,Gitar: reviewing'), 'Gitar\'s own state no longer matters on a Claude PR')
        for labels in ('Claude: not reviewed,Gitar: approved', 'Claude: changes requested,Gitar: approved', 'Claude: approved · not re-reviewed,Gitar: approved', 'Claude: approved,Working on PR comments', 'Claude: changes requested'):
            self.assertFalse(ready(labels), labels)

    def test_a_computing_merge_state_holds_ready_and_does_not_re_arm_it(self):
        lines = self.watch(['clean', 'unknown', 'clean'])
        self.assertEqual([line for line in lines if 'READY' in line], ['ship: READY #7 new1'], lines)

    def test_a_non_clean_state_that_is_not_blocking_checks_never_says_ready(self):
        for state in ('unstable', 'behind', 'dirty', 'draft'):
            self.assertFalse(any('READY' in line for line in self.watch([state, state])), state)


if __name__ == '__main__':
    unittest.main()
