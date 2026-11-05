"""Guard: release — the AI fixer's driver stops on READY, which has ONE definition (tools/ship-watch.sh). Without this, either a draft could say READY to a session (#2618) or the fixer's draft PR could never say it and every run would end on the cap.
SHIP_WATCH_DRAFT_OK=1 drops only the "not a draft" condition: a draft with Gitar's exact approval is READY; "approved with suggestions" and a "Working on PR comments" label still are not; without the switch a draft is never READY.
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

    def watch(self, labels, draft_ok):
        self.log.write_text('ship: opened\n')
        for name, text in (('states', 'OPEN\nCLOSED\n'), ('drafts', 'true\n'), ('labels', labels + '\n'), ('mergeables', ''), ('fixes', ''), ('checks', ''), ('runs', ''), ('verdicts', ''), ('heads', ''), ('looks', '0')):
            (self.tmp / name).write_text(text)
        env = {**os.environ, 'CODEX_THREAD_ID': '', 'CODEX_SESSION_ID': '', 'CMUX_SURFACE_ID': '', 'PATH': f'{self.tmp / "bin"}{os.pathsep}{os.environ["PATH"]}', 'FAKE_GH_DIR': str(self.tmp),
               'PR_REST_CACHE': str(self.tmp / 'cache'), 'SHIP_WATCH_POLL': '0', 'SHIP_WATCH_CAP': '60', 'SHIP_WATCH_FIX': str(self.tmp / 'fix.sh')}
        env.pop('SHIP_WATCH_DRAFT_OK', None)
        if draft_ok:
            env['SHIP_WATCH_DRAFT_OK'] = '1'
        subprocess.run(['bash', str(ROOT / 'tools' / 'ship-watch.sh'), '7', str(self.log), str(self.pidfile), 'o/r'], env=env, timeout=30, check=True)
        return self.log.read_text().splitlines()[1:]

    def test_a_draft_is_ready_only_with_the_switch(self):
        self.assertEqual(self.watch('Gitar: approved', draft_ok=False), ['ship: GREEN #7', 'ship: CLOSED #7 (unmerged)'])
        self.assertEqual(self.watch('Gitar: approved', draft_ok=True), ['ship: GREEN #7', 'ship: READY #7 new1', 'ship: CLOSED #7 (unmerged)'])

    def test_the_switch_drops_only_the_draft_condition(self):
        for labels in ('Gitar: approved with suggestions', 'Gitar: changes requested', 'Gitar: approved,Working on PR comments', ''):
            self.assertFalse(any('READY' in line for line in self.watch(labels, draft_ok=True)), labels)


if __name__ == '__main__':
    unittest.main()
