"""Guard: a pushed head with no Gitar check gets exactly one "Gitar review" comment from the watcher (11 Nov 2026, owner: "the gh labels are not representing the Gitar review state").
Gitar reviews a PR when it opens, not a push to an open PR: #3779, #3781 and #3780 sat 7+ min with no review; a second comment inside ~50 min locks the PR, so one per head, never two.
Runs the real watcher against the fake gh of tests/fake_gh_rest.py (answers from files, no network).
13 Nov 2026 (gq): the watcher never posts itself; the ask goes through tools/gitar-queue.mjs, shared by every session on the Mac (its own tests: test_gitar_queue.py)."""
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import time
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

    def watch(self, heads, runs='ok', after='0', locked_ago=None, opened=False, opened_wait='3600', peek='', pr='7', gap='0', now_plus=0):   # runs: one fake check-run answer for every look, or a list with one per look
        """One look per head, then the PR closes. Returns (the log lines, the number of `gh pr comment` calls, the calls' text)."""
        self.log.write_text(f'ship: [34s] opened the pull request: https://github.com/o/r/pull/{pr}\n' if opened else 'ship: opened\n')   # ship.sh's own line when it opened the PR
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
               'PR_REST_CACHE': str(self.tmp / 'cache'), 'SHIP_WATCH_POLL': '0', 'SHIP_WATCH_CAP': '60', 'SHIP_WATCH_FIX': str(self.tmp / 'fix.sh'), 'SHIP_WATCH_GITAR_AFTER': after, 'SHIP_WATCH_GITAR_OPENED': opened_wait,
               'GITAR_QUEUE_DIR': str(self.tmp / 'queue'), 'GITAR_QUEUE_SETTLE_MS': '0', 'GITAR_QUEUE_GAP_S': gap, 'GITAR_QUEUE_PR_GAP_S': '0', 'GITAR_QUEUE_GH': str(self.tmp / 'bin' / 'gh'), 'GITAR_QUEUE_NOW': str(int(time.time() * 1000) + now_plus * 1000)}   # clock: relative the queue compares only readings of this same clock
        (self.tmp / 'peek.sh').write_text(f'#!/bin/sh\nprintf "%s\\n" "{peek}"\n')   # what tools/gitar-label.mjs peek would print for the head
        (self.tmp / 'peek.sh').chmod(0o755)
        env['SHIP_WATCH_GITAR_PEEK'] = str(self.tmp / 'peek.sh')
        env.pop('SHIP_WATCH_DRAFT_OK', None)
        subprocess.run(['bash', str(ROOT / 'tools' / 'ship-watch.sh'), pr, str(self.log), str(self.pidfile), 'o/r'], env=env, timeout=30, check=True)
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
        """13 Nov 2026 (gl3, #4032): "Gitar: approved · not re-reviewed" means Gitar did NOT review this head, so it must be asked; the plain verdicts stay kept."""
        for peek in ('Gitar: approved · not re-reviewed', 'Gitar: approved with suggestions · not re-reviewed', 'Gitar: changes requested · not re-reviewed'):
            lines, calls = self.watch(['aaa1111', 'aaa1111'], peek=peek)
            self.assertEqual(calls, ['pr comment 7 -R o/r --body Gitar review'], (peek, calls))
            self.assertFalse([l for l in lines if 'GITAR KEPT' in l], (peek, lines))
            (self.tmp / 'queue').exists() and shutil.rmtree(self.tmp / 'queue')
            (self.tmp / 'calls').unlink()
        for peek in ('Gitar: approved', 'Gitar: approved with suggestions', 'Gitar: changes requested'):
            lines, calls = self.watch(['aaa1111', 'aaa1111'], peek=peek)
            self.assertEqual(calls, [], (peek, calls))
            self.assertTrue([l for l in lines if 'GITAR KEPT' in l], (peek, lines))

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

    def test_two_watchers_post_one_comment_and_the_second_waits_its_turn(self):
        """13 Nov 2026, gq: 22 asks in 70 min from every session at once drew 11 refusals. Two PRs' watchers with a 1 h gap: one comment now, the other queued; once the gap has passed the queued one goes, once."""
        _, calls = self.watch(['aaa1111', 'aaa1111'], pr='7', gap='3600')
        self.assertEqual(calls, ['pr comment 7 -R o/r --body Gitar review'], calls)
        lines, calls = self.watch(['bbb2222', 'bbb2222'], pr='8', gap='3600')
        self.assertEqual(len(calls), 1, 'the second PR must not post inside the gap: ' + str(calls))
        self.assertEqual([l for l in lines if 'GITAR queued' in l][:1], ['ship: GITAR queued #8 bbb2222 (position 1, next ask ~' + lines[[i for i, l in enumerate(lines) if 'GITAR queued' in l][0]].split('~')[1]], lines)
        lines, calls = self.watch(['bbb2222', 'bbb2222'], pr='8', gap='3600', now_plus=4000)
        self.assertEqual(calls, ['pr comment 7 -R o/r --body Gitar review', 'pr comment 8 -R o/r --body Gitar review'], calls)
        self.assertIn('ship: GITAR ASKED #8 bbb2222', lines)

    def test_a_merged_pr_leaves_the_queue(self):
        self.watch(['aaa1111', 'aaa1111'], pr='7', gap='3600')
        self.watch(['bbb2222', 'bbb2222'], pr='8', gap='3600')   # queued behind #7
        (self.tmp / 'queue_pr_state').write_text('MERGED\n')
        lines, calls = self.watch(['bbb2222', 'bbb2222'], pr='8', gap='3600', now_plus=4000)
        self.assertEqual(len(calls), 1, calls)
        self.assertTrue(any('GITAR DROPPED (merged) #8' in l for l in lines), lines)

    def test_it_waits_before_asking(self):
        _, calls = self.watch(['aaa1111', 'aaa1111'], after='3600')
        self.assertEqual(calls, [])


if __name__ == '__main__':
    unittest.main()
