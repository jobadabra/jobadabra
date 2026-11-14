"""Guard: release — a green head with no Gitar review gets ONE `ship: GITAR STALE` line from the watcher, and the watcher never posts a comment (13 Nov 2026, owner: "Close it, retire asks (Recommended)").
Gitar reviews a PR when it opens, not a push to an open PR (#3779, #3781, #3780 sat 7+ min with no review); every ask drew "wait about N minutes", so the fix is a fresh PR (skill reopen-pr-fresh), not a comment.
Runs the real watcher against the fake gh of tests/fake_gh_rest.py (answers from files, no network)."""
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import importlib.util
import unittest
from pathlib import Path

from tests.fake_gh_env import NO_GH_LOGS
from tests.ship_watch_guard import WATCH_HANG_GUARD_S

ROOT = Path(__file__).resolve().parents[3]
FRESH = '~/.claude/skills/reopen-pr-fresh/reopen-fresh.sh o/r 7'


@unittest.skipUnless(shutil.which('jq') and shutil.which('bash'), 'needs jq and bash')
class ShipWatchGitarStaleTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        (self.tmp / 'bin').mkdir()
        gh = self.tmp / 'bin' / 'gh'
        gh.write_text(f'#!/bin/sh\nexec "{sys.executable}" "{ROOT / "tests" / "fake_gh_rest.py"}" "$@"\n')
        gh.chmod(gh.stat().st_mode | stat.S_IEXEC)
        (self.tmp / 'fix.sh').write_text('#!/bin/sh\nexit 0\n')
        self.log, self.pidfile = self.tmp / 'ship.log', self.tmp / 'watch.pid'

    def watch(self, heads, runs='ok', after='0', peek=''):   # runs: one fake check-run answer for every look, or a list with one per look
        """One look per head (the fewest that show the case: a look costs about 3 s of bash; the peek of a green head comes on the look after GREEN, so two), then the PR closes. Returns (the log lines, the number of `gh pr comment` calls)."""
        self.log.write_text('ship: opened\n')
        looks = len(heads)
        files = {'states': 'OPEN\n' * looks + 'CLOSED\n', 'drafts': 'false\n' * (looks + 1), 'labels': 'Gitar: not started\n' * (looks + 1), 'mergeables': '', 'fixes': '',
                 'verdicts': '', 'heads': '\n'.join(heads) + '\n', 'looks': '0', 'mergestates': '', 'twins': '', 'runs': (''.join(r + '\n' for r in runs) if isinstance(runs, list) else (runs + '\n') * looks) + 'ok\n'}
        for name, text in files.items():
            (self.tmp / name).write_text(text)
        env = {**os.environ, **NO_GH_LOGS, 'CODEX_THREAD_ID': '', 'CODEX_SESSION_ID': '', 'CMUX_SURFACE_ID': '', 'PATH': f'{self.tmp / "bin"}{os.pathsep}{os.environ["PATH"]}', 'FAKE_GH_DIR': str(self.tmp),
               'PR_REST_CACHE': str(self.tmp / 'cache'), 'SHIP_WATCH_POLL': '0', 'SHIP_WATCH_CAP': '60', 'SHIP_WATCH_FIX': str(self.tmp / 'fix.sh'), 'SHIP_WATCH_GITAR_AFTER': after}
        (self.tmp / 'peek.sh').write_text(f'#!/bin/sh\nprintf "%s\\n" "{peek}"\n')   # what tools/gitar-label.mjs peek would print for the head
        (self.tmp / 'peek.sh').chmod(0o755)
        env['SHIP_WATCH_GITAR_PEEK'] = str(self.tmp / 'peek.sh')
        env.pop('SHIP_WATCH_DRAFT_OK', None)
        subprocess.run(['bash', str(ROOT / 'tools' / 'ship-watch.sh'), '7', str(self.log), str(self.pidfile), 'o/r'], env=env, timeout=WATCH_HANG_GUARD_S, check=True)
        calls = [c for c in (self.tmp / 'calls').read_text().splitlines() if c.startswith('pr comment')]
        return self.log.read_text().splitlines()[1:], calls

    def stale(self, lines):
        return [l for l in lines if 'GITAR STALE' in l]

    def test_a_green_head_without_a_gitar_check_is_reported_once_and_nothing_is_posted(self):
        lines, calls = self.watch(['aaa1111'] * 2)
        self.assertEqual(self.stale(lines), [f'ship: GITAR STALE #7 aaa1111 (no Gitar review of this head; reopen fresh: {FRESH})'], lines)
        self.assertEqual(calls, [], 'the watcher never asks Gitar')

    def test_a_head_that_keeps_gitars_verdict_is_kept_not_stale_and_not_re_reviewed_is_stale(self):
        lines, _ = self.watch(['aaa1111'] * 2, peek='Gitar: approved')
        self.assertEqual(self.stale(lines), [], lines)
        self.assertIn('ship: GITAR KEPT #7 aaa1111 (Gitar: approved: Gitar already ran on this head)', lines)
        lines, _ = self.watch(['bbb2222'] * 2, peek='Gitar: approved · not re-reviewed')
        self.assertEqual(len(self.stale(lines)), 1, lines)
        self.assertFalse([l for l in lines if 'GITAR KEPT' in l], lines)

    def test_a_head_with_a_gitar_check_is_never_reported(self):
        lines, calls = self.watch(['aaa1111'] * 2, runs='gitar')
        self.assertEqual((self.stale(lines), calls), ([], []))

    def test_each_new_head_is_reported_once(self):
        lines, _ = self.watch(['aaa1111'] * 2 + ['bbb2222'] * 2)
        self.assertEqual([l.split()[3:5] for l in self.stale(lines)], [['#7', 'aaa1111'], ['#7', 'bbb2222']], lines)

    def test_a_head_is_not_reported_while_its_checks_are_not_green(self):
        lines, _ = self.watch(['aaa1111'] * 2, runs='running')
        self.assertEqual(self.stale(lines), [], 'a head still running its checks is not stale yet')

    def test_a_failed_check_read_never_reports_and_the_next_good_reads_report_once(self):
        lines, _ = self.watch(['aaa1111'] * 3, runs=['refused', 'ok', 'ok'])
        self.assertEqual(len(self.stale(lines)), 1, lines)

    def test_it_waits_before_reporting(self):
        lines, _ = self.watch(['aaa1111'] * 2, after='3600')
        self.assertEqual(self.stale(lines), [])

    def test_the_stale_line_wakes_the_session_and_the_kept_line_does_not(self):
        """A line nobody reads is no fix: sessions wait for READY, which a head Gitar never reviews cannot reach."""
        spec = importlib.util.spec_from_file_location('claude_pr_events', ROOT / 'tools' / 'claude-pr-events.py')
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        self.assertTrue(mod.WAKE.match(f'ship: GITAR STALE #7 aaa1111 (no Gitar review of this head; reopen fresh: {FRESH})'))
        self.assertFalse(mod.WAKE.match('ship: GITAR KEPT #7 aaa1111 (Gitar: approved: Gitar already ran on this head)'))


if __name__ == '__main__':
    unittest.main()
