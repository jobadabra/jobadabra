"""Guard: release — "anything not a draft is safe to merge" (owner via sa, 13 Nov 2026): READY has ONE definition (tools/ship-watch.sh), and a draft becomes ready only there.
Without it a green PR not yet approved by Gitar was marked ready and merged (12 Nov 2026), or a "DONT MERGE" hold was lifted by a tool.
A draft that meets READY is marked ready (`gh pr ready`) and says READY; a draft titled DONT MERGE says HELD and is never flipped. SHIP_WATCH_DRAFT_OK=1 (the AI fixer's PR) keeps its draft and says READY, as before.
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
class ShipWatchDraftTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        (self.tmp / 'bin').mkdir()
        gh = self.tmp / 'bin' / 'gh'
        gh.write_text(f'#!/bin/sh\nexec "{sys.executable}" "{ROOT / "tests" / "fake_gh_rest.py"}" "$@"\n')
        gh.chmod(gh.stat().st_mode | stat.S_IEXEC)
        (self.tmp / 'fix.sh').write_text('#!/bin/sh\nexit 0\n')
        self.log, self.pidfile = self.tmp / 'ship.log', self.tmp / 'watch.pid'

    def watch(self, labels, draft_ok, drafts='true', titles='', heads='', checks='', states='OPEN\nCLOSED'):
        self.log.write_text('ship: opened\n')
        for name, text in (('states', states + '\n'), ('drafts', drafts + '\n'), ('labels', labels + '\n'), ('mergeables', ''), ('fixes', ''), ('checks', checks), ('runs', ''), ('verdicts', ''),
                           ('heads', heads), ('titles', titles), ('looks', '0'), ('calls', '')):
            (self.tmp / name).write_text(text)
        env = {**os.environ, 'CODEX_THREAD_ID': '', 'CODEX_SESSION_ID': '', 'CMUX_SURFACE_ID': '', 'PATH': f'{self.tmp / "bin"}{os.pathsep}{os.environ["PATH"]}', 'FAKE_GH_DIR': str(self.tmp),
               'PR_REST_CACHE': str(self.tmp / 'cache'), 'SHIP_WATCH_POLL': '0', 'SHIP_WATCH_CAP': '60', 'SHIP_WATCH_FIX': str(self.tmp / 'fix.sh')}
        env.pop('SHIP_WATCH_DRAFT_OK', None)
        if draft_ok:
            env['SHIP_WATCH_DRAFT_OK'] = '1'
        subprocess.run(['bash', str(ROOT / 'tools' / 'ship-watch.sh'), '7', str(self.log), str(self.pidfile), 'o/r'], env=env, timeout=30, check=True)
        self.flips = [line for line in (self.tmp / 'calls').read_text().splitlines() if line.startswith('pr ready')]
        return self.log.read_text().splitlines()[1:]

    def test_a_draft_that_meets_ready_is_marked_ready_then_says_ready(self):
        self.assertEqual(self.watch('Gitar: approved', draft_ok=False), ['ship: GREEN #7', 'ship: READY #7 new1', 'ship: CLOSED #7 (unmerged)'])
        self.assertEqual(self.flips, ['pr ready 7 -R o/r'])

    def test_the_fixers_draft_says_ready_and_stays_a_draft(self):
        self.assertEqual(self.watch('Gitar: approved', draft_ok=True), ['ship: GREEN #7', 'ship: READY #7 new1', 'ship: CLOSED #7 (unmerged)'])
        self.assertEqual(self.flips, [])

    def test_a_dont_merge_draft_is_held_never_flipped(self):
        lines = self.watch('Gitar: approved', draft_ok=False, titles='[rs] DONT MERGE Read boards\n')
        self.assertIn('ship: HELD #7 new1 (every check green and Gitar Approved, but its title says DONT MERGE: it stays a draft)', lines)
        self.assertFalse(any('READY' in line for line in lines), lines)
        self.assertEqual(self.flips, [])

    def test_nothing_short_of_ready_flips_a_draft(self):
        for labels in ('Gitar: approved with suggestions', 'Gitar: changes requested', 'Gitar: approved,Working on PR comments', ''):
            for draft_ok in (False, True):
                self.assertFalse(any('READY' in line for line in self.watch(labels, draft_ok=draft_ok)), (labels, draft_ok))
                self.assertEqual(self.flips, [], labels)

if __name__ == '__main__':
    unittest.main()
