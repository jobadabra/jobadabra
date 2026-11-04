"""Guard: release — a PR's `desktop (ubuntu)` job runs only what tools/affected-tests.py picks, so a test it misses goes red on main instead of on the PR.
Why (4 Nov 2026, owner: "run only the ones that make sense"): the cases below are what that job must never lose. Replay of 40 red PR runs: spec 2026-11-04-pr-time-design.md."""
import importlib.util
import re
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / file)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


class PrDesktopPicks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.picker, cls.check = load('affected_tests', 'tools/affected-tests.py'), load('check_py', 'tools/check.py')
        cls.picked = cls.picker.select(['desktop/lib/keychain.js'])['desktop']

    def test_every_guard_runs_for_any_desktop_change(self):
        tracked = subprocess.run(['git', 'ls-files', 'desktop/test/guards'], cwd=ROOT, capture_output=True, text=True, check=True).stdout.split()
        guards = [f.removeprefix('desktop/') for f in tracked if f.endswith('.test.js')]
        self.assertTrue(guards)
        self.assertEqual([g for g in guards if g not in self.picked], [])

    def test_a_test_that_runs_a_tool_as_a_process_is_picked(self):
        self.assertIn('test/unit/main/rename-guard.test.js', self.picked)   # the one test missed in the replay: red on 2 PRs, 3 Nov 2026

    def test_every_file_outside_desktop_that_starts_the_job_picks_tests(self):
        # Gitar on PR time 2/2: a PR changing only such a file started the job and ran no test at all.
        graph = self.picker.js_graph()
        self.picker.js_graph = lambda: graph
        listed = re.findall(r"^ {6}- '([^'!*]+)'", (ROOT / '.github/workflows/tests-desktop.yml').read_text(encoding='utf-8').split('\npermissions:')[0], re.M)
        outside = [f for f in listed if not f.startswith(('desktop/', 'extension/'))]
        self.assertGreater(len(outside), 10)
        self.assertEqual([f for f in outside if not self.picker.starts_desktop_job(f)], [])
        self.assertIn('test/unit/main/rename-guard.test.js', self.picker.select(['tools/rename-inventory.mjs'])['desktop'])
        for one_of_each in ('docs/gtm-journeys.json', 'AGENTS.md', '.gitignore', next(f for f in outside if f.startswith('.claude/')), next(f for f in outside if f.startswith('.github/'))):
            picked = self.picker.select([one_of_each])['desktop']
            self.assertTrue(picked and picked != 'all', one_of_each)   # a listed file picks by reach and mention; it never runs everything
        self.assertEqual(self.picker.select(['docs/rules/change-loop.md'])['desktop'], [])   # a doc no test reads still runs nothing

    def test_a_change_to_what_runs_the_tests_runs_everything(self):
        for changed in ('desktop/test/no-live-site.mjs', 'desktop/test/reporter-by-file.mjs', 'tools/check.py', '.github/workflows/tests-desktop.yml', 'desktop/package.json', 'eslint.config.mjs'):
            self.assertEqual(self.picker.select([changed])['desktop'], 'all', changed)

    def test_a_picked_run_keeps_lint_and_the_no_live_site_import(self):
        commands = [command for _, command in self.check.commands('desktop', False, 'node', 'npm', ['test/unit/main/a.test.js'])]
        self.assertIn(['npm', 'run', 'lint'], commands)
        self.assertIn('./test/no-live-site.mjs', commands[-1])
        self.assertEqual(commands[-1][-1], 'test/unit/main/a.test.js')


if __name__ == '__main__':
    unittest.main()
