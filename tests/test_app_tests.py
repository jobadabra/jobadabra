"""tools/app-tests.py: the release pipeline's unit legs leave out the repo's own tooling tests and keep every test of what ships.

Why (2 Nov 2026, owner: "The harness tests for sure should not be run in the beta pipeline" … "THat's not a blocker or a reliability gate for the release"):
beta 0.9.1's Mac unit leg took 9.6 min; its slowest Python modules (test_ship_pr 220 s, test_affected_tests 215 s, test_ship_watch 152 s, test_pr_red_hook 134 s,
test_pr_comments 100 s) and desktop files (e2e-reliability-check 88 s, ci-intel-e2e-weekly 38 s) test the repo's tooling, not the app.
"""
import importlib.util
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('app_tests', ROOT / 'tools/app-tests.py')
app_tests = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app_tests)
ACTION = (ROOT / '.github/actions/unit-tests/action.yml').read_text()

SLOWEST_TOOLING_OF_0_9_1 = ('test_ship_pr', 'test_affected_tests', 'test_ship_watch', 'test_pr_red_hook', 'test_pr_comments')


class PythonTests(unittest.TestCase):
    def test_the_slowest_tooling_modules_of_beta_0_9_1_are_left_out(self):
        tooling = app_tests.python_tooling_tests()
        self.assertEqual([m for m in SLOWEST_TOOLING_OF_0_9_1 if m not in tooling], [])

    def test_every_module_that_imports_the_engine_is_kept(self):
        tooling = set(app_tests.python_tooling_tests())
        for name in ('test_matching_matrix', 'test_hosted_run', 'test_store'):
            self.assertRegex((ROOT / f'tests/{name}.py').read_text(), re.compile(r'^(from|import) src\b', re.M), name)   # an engine test, by its own imports
            self.assertNotIn(name, tooling, name)
        everything = sorted(p.stem for p in (ROOT / 'tests').glob('test_*.py'))
        self.assertGreater(len(everything) - len(tooling), 300, 'the beta still runs the engine\'s tests')


class DesktopTests(unittest.TestCase):
    def test_the_tooling_files_are_left_out(self):
        tooling = app_tests.desktop_tooling_tests()
        for name in ('e2e-reliability-check', 'ci-intel-e2e-weekly', 'clean-code-js', 'file-size'):
            self.assertIn(f'test/{name}.test.js', tooling)

    def test_a_screen_test_that_reads_the_renderer_as_text_is_kept(self):
        tooling = app_tests.desktop_tooling_tests()
        for name in ('activity-arrow-keys', 'card-system', 'quit-paths', 'automation'):
            self.assertTrue((ROOT / f'desktop/test/{name}.test.js').is_file(), name)
            self.assertNotIn(f'test/{name}.test.js', tooling)
        everything = list((ROOT / 'desktop/test').glob('*.test.js'))
        self.assertLess(len(tooling), len(everything) // 5, 'most desktop tests test the app')

    def test_what_ships_comes_from_the_installer_files_list(self):
        files = app_tests.app_files()
        for shipped in ('desktop/lib/', 'desktop/renderer/', 'desktop/main.js'):
            self.assertIn(shipped, files)
        self.assertFalse([f for f in files if f.endswith('.json') or '!' in f or 'node_modules' in f], files)

    def test_the_glob_names_every_left_out_file_and_only_plain_names(self):
        tooling = app_tests.desktop_tooling_tests()
        glob = app_tests.desktop_glob()
        names = re.fullmatch(r'test/!\(([\w|-]+)\)\.test\.js', glob)
        self.assertTrue(names, glob)   # a name with a glob character would change what node runs
        self.assertEqual(sorted(names.group(1).split('|')), sorted(Path(t).name.removesuffix('.test.js') for t in tooling))
        self.assertLess(len(glob), 8000, 'the pattern stays far below Windows\' 32 KB command line')


class ReleaseLegsTests(unittest.TestCase):
    def test_the_unit_legs_run_only_the_tests_of_what_ships(self):
        runs = [line for line in ACTION.splitlines() if 'bash tools/check.sh --area' in line and not line.lstrip().startswith('#')]
        self.assertTrue(runs, 'the action runs tools/check.sh per area')
        self.assertEqual([line for line in runs if '--app-only' not in line], [])

    def test_the_legs_print_the_machine_at_the_start_and_the_end(self):   # the proof for the desktop half that ran serially in 0.9.1 (503 s for 430 s of files)
        self.assertIn("machine 'Machine at the start'", ACTION)
        self.assertIn("machine 'Machine at the end'", ACTION)


if __name__ == '__main__':
    unittest.main()
