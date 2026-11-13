"""Guard: a pushed head with no Gitar check gets exactly one "Gitar review" comment from the watcher (11 Nov 2026, owner: "the gh labels are not representing the Gitar review state").
Gitar reviews a PR when it opens, not a push to an open PR: #3779, #3781 and #3780 sat 7+ min with no review; a second comment inside ~50 min locks the PR, so one per head, never two.
Runs the real watcher against the fake gh of tests/fake_gh_rest.py (answers from files, no network)."""
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


@unittest.skipUnless(shutil.which('jq') and shutil.which('bash'), 'needs jq and bash')
class ShipWatchGitarAskTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        (self.tmp / 'bin').mkdir()
        gh = self.tmp / 'bin' / 'gh'
        gh.write_text(f'#!/bin/sh\nexec "{sys.executable}" "{ROOT / "tests" / "fake_gh_rest.py"}" "$@"\n')
        gh.chmod(gh.stat().st_mode | stat.S_IEXEC)
        (self.tmp / 'fix.sh').write_text('#!/bin/sh\nexit 0\n')
        self.log, self.pidfile = self.tmp / 'ship.log', self.tmp / 'watch.pid'

    def watch(self, heads, runs='ok', after='0', locked_ago=None, opened=False, opened_wait='3600', peek=''):   # runs: one fake check-run answer for every look, or a list with one per look
        """One look per head, then the PR closes. Returns (the log lines, the number of `gh pr comment` calls, the calls' text)."""
        self.log.write_text('ship: [34s] opened the pull request: https://github.com/o/r/pull/7\n' if opened else 'ship: opened\n')   # ship.sh's own line when it opened the PR
        looks = len(heads)
        files = {'states': 'OPEN\n' * looks + 'CLOSED\n', 'drafts': 'false\n' * (looks + 1), 'labels': 'Gitar: not started\n' * (looks + 1), 'mergeables': '', 'fixes': '',
                 'verdicts': '', 'heads': '\n'.join(heads) + '\n', 'looks': '0', 'mergestates': '', 'twins': '', 'runs': (''.join(r + '\n' for r in runs) if isinstance(runs, list) else (runs + '\n') * looks) + 'ok\n'}
        for name, text in files.items():
            (self.tmp / name).write_text(text)
        if locked_ago is not None:   # Gitar's own "wait about N minutes" reply, written so many seconds ago (an inline thread reply, like #3785's)
            (self.tmp / 'rest').mkdir(exist_ok=True)
            at = (datetime.now(timezone.utc) - timedelta(seconds=locked_ago)).strftime('%Y-%m-%dT%H:%M:%SZ')   # clock: relative, the watcher measures the reply's age against its own now
            (self.tmp / 'rest' / 'repos_o_r_pulls_7_comments_per_page_100').write_text(json.dumps([{'user': {'login': 'gitar-bot[bot]'}, 'created_at': at, 'body': "You've sent several Gitar comments in a short window. Please wait about 10 minutes and comment again."}]))
        env = {**os.environ, 'CODEX_THREAD_ID': '', 'CODEX_SESSION_ID': '', 'CMUX_SURFACE_ID': '', 'PATH': f'{self.tmp / "bin"}{os.pathsep}{os.environ["PATH"]}', 'FAKE_GH_DIR': str(self.tmp),
               'PR_REST_CACHE': str(self.tmp / 'cache'), 'SHIP_WATCH_POLL': '0', 'SHIP_WATCH_CAP': '60', 'SHIP_WATCH_FIX': str(self.tmp / 'fix.sh'), 'SHIP_WATCH_GITAR_AFTER': after, 'SHIP_WATCH_GITAR_OPENED': opened_wait}
        (self.tmp / 'peek.sh').write_text(f'#!/bin/sh\nprintf "%s\\n" "{peek}"\n')   # what tools/gitar-label.mjs peek would print for the head
        (self.tmp / 'peek.sh').chmod(0o755)
        env['SHIP_WATCH_GITAR_PEEK'] = str(self.tmp / 'peek.sh')
        env.pop('SHIP_WATCH_DRAFT_OK', None)
        subprocess.run(['bash', str(ROOT / 'tools' / 'ship-watch.sh'), '7', str(self.log), str(self.pidfile), 'o/r'], env=env, timeout=30, check=True)
        calls = [c for c in (self.tmp / 'calls').read_text().splitlines() if c.startswith('pr comment')]
        return self.log.read_text().splitlines()[1:], calls

    def test_one_head_without_a_gitar_check_is_asked_once_across_many_looks(self):
        lines, calls = self.watch(['aaa1111', 'aaa1111', 'aaa1111'])
        self.assertEqual(calls, ['pr comment 7 -R o/r --body Gitar review'], calls)
        self.assertEqual([l for l in lines if 'GITAR ASKED' in l], ['ship: GITAR ASKED #7 aaa1111'], lines)

    def test_a_head_that_keeps_gitars_verdict_is_not_asked(self):
        """12 Nov 2026, owner, asked via AskUserQuestion: "Keep the verdict (Recommended)": #3886 merged main after Gitar's approval; the label keeps it, so the watcher must not ask."""
        lines, calls = self.watch(['aaa1111', 'aaa1111'], peek='Gitar: approved')
        self.assertEqual(calls, [], calls)
        self.assertEqual([l for l in lines if 'GITAR KEPT' in l], ['ship: GITAR KEPT #7 aaa1111 (Gitar: approved: the push only merged main)'], lines)
        _, calls = self.watch(['bbb2222'], peek='Gitar: not started')
        self.assertEqual(calls, ['pr comment 7 -R o/r --body Gitar review'], calls)

    def test_only_a_plain_verdict_is_kept_never_a_not_re_reviewed_label(self):
        """13 Nov 2026 (gl3, Gitar on #4032): "Gitar: approved \u00b7 not re-reviewed" means Gitar did NOT review this head, so it must be asked; the plain verdicts stay kept. Same test as gq's in #4031."""
        cases = [('Gitar: approved \u00b7 not re-reviewed', True), ('Gitar: approved with suggestions \u00b7 not re-reviewed', True), ('Gitar: changes requested \u00b7 not re-reviewed', True),
                 ('Gitar: approved', False), ('Gitar: approved with suggestions', False), ('Gitar: changes requested', False)]
        before = 0
        for n, (peek, asked) in enumerate(cases):
            with self.subTest(peek=peek):
                lines, calls = self.watch([f'h{n}00000', f'h{n}00000'], peek=peek)   # a head per case: the asked-head marker is per head; the calls file keeps growing
                self.assertEqual(len(calls) - before, int(asked), (peek, calls))
                before = len(calls)
                self.assertEqual(bool([l for l in lines if 'GITAR KEPT' in l]), not asked, (peek, lines))

    def test_a_head_with_a_gitar_check_is_never_asked(self):
        _, calls = self.watch(['aaa1111', 'aaa1111'], runs='gitar')
        self.assertEqual(calls, [])

    def test_each_new_head_is_asked_once(self):
        _, calls = self.watch(['aaa1111', 'aaa1111', 'bbb2222', 'bbb2222'])
        self.assertEqual(len(calls), 2, calls)

    def test_a_failed_check_read_never_asks_and_the_next_good_read_asks_once(self):
        lines, calls = self.watch(['aaa1111'] * 3, runs=['refused', 'ok', 'ok'])
        self.assertEqual(len(calls), 1, (calls, lines))

    def test_a_fresh_gitar_lock_reply_holds_the_ask_and_an_old_one_does_not(self):
        _, calls = self.watch(['aaa1111'] * 2, locked_ago=60)
        self.assertEqual(calls, [], 'a comment inside the lock restarts it')
        _, calls = self.watch(['aaa1111'] * 2, locked_ago=1200)
        self.assertEqual(len(calls), 1, calls)

    def test_the_head_the_pr_opened_with_waits_longer_and_a_later_push_does_not(self):
        """12 Nov 2026, owner chose "One label per push": a push is asked after 30 s, not 180; Gitar starts on an open by itself, so the opening head keeps the long wait."""
        _, calls = self.watch(['aaa1111', 'aaa1111', 'bbb2222', 'bbb2222'], opened=True)
        self.assertEqual(calls, ['pr comment 7 -R o/r --body Gitar review'], 'only the pushed head bbb2222 is asked')

    def test_it_waits_before_asking(self):
        _, calls = self.watch(['aaa1111', 'aaa1111'], after='3600')
        self.assertEqual(calls, [])


if __name__ == '__main__':
    unittest.main()
