"""Guard: READY needs GitHub's own merge state "clean", not only the newest check row per name (web #459, 6 Nov 2026: a push and a body edit started two runs of the gate,
one cancelled the other; the watcher read the newest row (green) and Gitar approved, GitHub's merge state read BLOCKED beside the cancelled twin, the owner saw a red X).
Runs the real watcher against the fake gh of tests/fake_gh_rest.py (answers from files, no network)."""
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from tests.ship_watch_guard import WATCH_HANG_GUARD_S

ROOT = Path(__file__).resolve().parents[3]
SHA = 'a' * 40


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

    def watch(self, mergestates, twins='', labels='Gitar: approved', reviews=None, heads='', claude=None, variables=None, var_every='0'):
        """One look per line of mergestates, then the PR closes. Every look: Gitar approved, the gate green (newest row), no draft."""
        self.log.write_text('ship: opened\n')
        looks = len(mergestates)
        files = {'states': 'OPEN\n' * looks + 'CLOSED\n', 'drafts': 'false\n' * (looks + 1), 'labels': (labels + '\n') * (looks + 1), 'mergeables': '', 'fixes': '', 'checks': '', 'runs': 'gate\n' * (looks + 1),
                 'verdicts': '', 'heads': (heads + '\n') * 12 if heads else '', 'looks': '0', 'mergestates': '\n'.join(mergestates) + '\n', 'twins': twins}
        for name, text in files.items():
            (self.tmp / name).write_text(text)
        if reviews is not None:
            (self.tmp / 'reviews.json').write_text(json.dumps(reviews))
        if variables is not None:   # the variable per look (true | false | 404), after the PR read of that look
            (self.tmp / 'variables').write_text('\n'.join(variables) + '\n')
        if claude is not None:   # the repository variable CLAUDE_REVIEW_ENABLED (REST body); None = no such variable (404)
            (self.tmp / 'rest').mkdir(exist_ok=True)
            (self.tmp / 'rest' / 'repos_o_r_actions_variables_CLAUDE_REVIEW_ENABLED').write_text(json.dumps({'name': 'CLAUDE_REVIEW_ENABLED', 'value': claude}))
        env = {**os.environ, 'CODEX_THREAD_ID': '', 'CODEX_SESSION_ID': '', 'CMUX_SURFACE_ID': '', 'PATH': f'{self.tmp / "bin"}{os.pathsep}{os.environ["PATH"]}', 'FAKE_GH_DIR': str(self.tmp),
               'PR_REST_CACHE': str(self.tmp / 'cache'), 'SHIP_WATCH_POLL': '0', 'SHIP_WATCH_CAP': '60', 'SHIP_WATCH_FIX': str(self.tmp / 'fix.sh')}
        if var_every is not None:   # 0 = read the variable every look (the flip tests); None = the watcher's own default (every 600 s)
            env['SHIP_WATCH_VAR_EVERY'] = var_every
        env.pop('SHIP_WATCH_DRAFT_OK', None)
        subprocess.run(['bash', str(ROOT / 'tools' / 'ship-watch.sh'), '7', str(self.log), str(self.pidfile), 'o/r'], env=env, timeout=WATCH_HANG_GUARD_S, check=True)
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
        """13-14 Nov 2026 (cr 2a, owner: "replace Gitar with Claude Code review"): a PR carrying a "Claude: …" label is READY only on "Claude: approved" AND a newest review of ours that approves THIS head
        (a stale label, or #4115: "Gitar: approved" beside a Claude "Request changes" on one head, is never ready); "· not re-reviewed" is an older head."""
        def review(sha, verdict, at):
            return {'node_id': at, 'user': {'login': 'github-actions[bot]'}, 'state': 'COMMENTED', 'submitted_at': at, 'body': f'**Claude review: {verdict}**\n\n<!-- claude-review sha={sha} findings= -->'}
        ok, no = review(SHA, '✅ Approve', '2026-11-14T10:00:00Z'), review(SHA, '⛔ Request changes', '2026-11-14T11:00:00Z')
        ready = lambda labels, reviews: any('READY' in line for line in self.watch(['clean', 'clean'], labels=labels, reviews=reviews, heads=SHA, claude='true'))
        self.assertTrue(ready('Claude: approved', [ok]))
        self.assertTrue(ready('Claude: approved,Gitar: reviewing', [ok]), 'Gitar\'s own state no longer matters on a Claude PR')
        filler = [{'node_id': f'f{n}', 'user': {'login': 'github-actions[bot]'}, 'state': 'COMMENTED', 'submitted_at': '2026-11-13T%02d:00:00Z' % (n % 24), 'body': 'x'} for n in range(100)]
        self.assertTrue(ready('Claude: approved', filler + [ok]), 'the newest review is on page 2 of the reviews (Gitar\'s finding on #4124)')
        self.assertFalse(ready('Claude: approved', [ok, no]), 'the newest review asks for changes')
        self.assertFalse(ready('Claude: approved', [dict(ok, body=ok['body'].replace(SHA, 'b' * 40))]), 'the label is stale: the newest review is of another head')
        self.assertFalse(ready('Claude: approved', []), 'no review of ours at all')
        for labels in ('Claude: not reviewed,Gitar: approved', 'Claude: changes requested,Gitar: approved', 'Claude: reviewing,Gitar: approved', 'Claude: approved · not re-reviewed,Gitar: approved', 'Claude: approved,Working on PR comments'):
            self.assertFalse(ready(labels, [ok]), labels)

    def test_with_the_reviewer_off_a_leftover_claude_label_never_holds_a_pr_back(self):
        """14 Nov 2026 (owner: "disable Claude for now"; coordinator mac-95): every new PR carried "Claude: not reviewed" and could never be READY. Off (no variable, or not "true") = Gitar's label alone;
        on = the Claude rule above."""
        for claude in (None, 'false', ''):
            lines = self.watch(['clean', 'clean'], labels='Claude: not reviewed,Gitar: approved', heads=SHA, claude=claude)
            self.assertTrue(any('READY' in line for line in lines), (claude, lines))
        self.assertFalse(any('READY' in line for line in self.watch(['clean', 'clean'], labels='Claude: not reviewed,Gitar: approved', heads=SHA, claude='true')), 'on: the Claude rule holds it')
        self.assertFalse(any('READY' in line for line in self.watch(['clean', 'clean'], labels='Claude: not reviewed,Gitar: reviewing', heads=SHA)), 'off: Gitar still has to approve')

    def test_a_deleted_variable_turns_a_running_watcher_to_gitar_only_at_once(self):
        """Gitar on #4162: a watcher that read "true" and then finds the variable deleted (404) is off, not "keep the last answer" (that is for outages)."""
        labels = 'Claude: not reviewed,Gitar: approved'
        lines = self.watch(['clean', 'clean', 'clean'], labels=labels, heads=SHA, variables=['true', '404', '404'])
        self.assertEqual([line for line in lines if 'READY' in line], [f'ship: READY #7 {SHA[:7]}'], lines)
        lines = self.watch(['clean', 'clean', 'clean'], labels=labels, heads=SHA, variables=['true', 'true', 'true'])
        self.assertFalse(any('READY' in line for line in lines), 'on: the Claude rule holds it')

    def test_a_computing_merge_state_holds_ready_and_does_not_re_arm_it(self):
        lines = self.watch(['clean', 'unknown', 'clean'])
        self.assertEqual([line for line in lines if 'READY' in line], ['ship: READY #7 new1'], lines)

    def test_a_non_clean_state_that_is_not_blocking_checks_never_says_ready(self):
        for state in ('unstable', 'behind', 'dirty', 'draft'):
            self.assertFalse(any('READY' in line for line in self.watch([state, state])), state)

    def variable_reads(self):
        return [c for c in (self.tmp / 'calls').read_text().splitlines() if c.startswith('api') and c.endswith('/actions/variables/CLAUDE_REVIEW_ENABLED')]

    def test_the_variable_is_read_once_per_interval_not_once_per_look(self):
        """14 Nov 2026 (rb; gh-rest-report.sh: 214 spent calls an hour, a missing variable is a 404 and a 404 is charged every look): with the default interval five looks make one read;
        interval 0 reads it at every look, so a flip is still seen by the watcher that lives 48 h."""
        self.watch(['clean'] * 5, variables=['404'] * 5, var_every=None)
        self.assertEqual(len(self.variable_reads()), 1, self.variable_reads())
        (self.tmp / 'calls').unlink()
        self.watch(['clean'] * 5, variables=['404'] * 5, var_every='0')
        self.assertEqual(len(self.variable_reads()), 5, self.variable_reads())


if __name__ == '__main__':
    unittest.main()
