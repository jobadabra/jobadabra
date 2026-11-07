"""Guard: release (tools/affected-tests.py and tools/affected_readers.py) — a PR's `Unit / desktop (Linux)` and `Unit / desktop (Windows)` jobs run only what tools/affected-tests.py picks, so a test it misses goes red on main instead of on the PR.
Why (4 Nov 2026, owner: "run only the ones that make sense"): the cases below are what that job must never lose. Replay of 40 red PR runs: spec 2026-11-04-pr-time-design.md."""
import importlib.util
import re
import subprocess
import sys
import unittest
from unittest import mock
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

    def test_a_guard_that_keeps_safety_data_money_privacy_or_the_release_runs_for_any_desktop_change(self):
        # 7 Nov 2026, owner: "We should test only the touched parts" (ts 2/2). Before, ALL 98 guards ran for any desktop change; now only the guards that say they guard these five things do.
        tracked = subprocess.run(['git', 'ls-files', 'desktop/test/guards'], cwd=ROOT, capture_output=True, text=True, check=True).stdout.split()
        kept = [f.removeprefix('desktop/') for f in tracked if f.endswith('.test.js') and self.picker.SAFETY_GUARD_RE.search((ROOT / f).read_text(encoding='utf-8')[:1500])]
        self.assertGreaterEqual(len(kept), 4, 'positive control: the guards that name what they keep are found')
        for changed in ('desktop/lib/keychain.js', 'desktop/e2e/lib/broker-client.mjs'):
            self.assertEqual([g for g in kept if g not in self.picker.select([changed])['desktop']], [], changed)

    def test_a_change_picks_the_readers_of_its_folder_and_not_the_readers_of_other_folders(self):
        # 7 Nov 2026, ts 2/2. #3439 changed 2 files under desktop/e2e and picked 341 desktop tests: 219 unit tests imported a helper (toast-scan.js) that reads renderer/ with fs, which counted as "reads the whole tree".
        reader = 'test/guards/rules/design.test.js'   # reads renderer files through toast-scan.js
        e2e = self.picker.select(['desktop/e2e/lib/broker-client.mjs', 'desktop/e2e/test/ai/ai-provider.test.mjs'])['desktop']
        self.assertLess(len(e2e), 120)
        self.assertNotIn(reader, e2e)
        for walker in ('test/unit/main/rename-guard.test.js', 'test/tooling/ci/file-size.test.js'):
            self.assertIn(walker, e2e)   # a test that walks the whole tree still runs
        for changed in ('desktop/renderer/style.css', 'desktop/test/toast-scan.js'):   # the folder it reads, and the helper itself
            self.assertIn(reader, self.picker.select([changed])['desktop'], changed)

    def test_a_test_the_folder_rule_alone_would_drop_is_still_picked(self):
        # 7 Nov 2026, the fresh /code-review of ts 3/3 found five classes the folder rule dropped; one positive control each. A new walker whose root sits in a variable and is not recursive (a plain
        # `readdirSync(dir)`) is a folder reader: it must name its folder, or the picker cannot know what it reads.
        def picks(changed):
            return self.picker.select([changed])['desktop']
        # (1) walks all of desktop from a root held in a variable (readdirSync(dir) + isDirectory): no folder named
        for changed in ('desktop/main.js', 'desktop/preload.cjs'):
            for walker in ('test/guards/safety/owner-guard-wiring.test.js', 'test/guards/rules/legacy-name-literals.test.js'):
                self.assertIn(walker, picks(changed), f'{walker} walks all of desktop: {changed}')
        # (2) names a folder, but our tooling gate dropped it for a change outside the tooling roots
        self.assertIn('test/tooling/ci/recorded-cases.test.js', picks('extension/page/zzz.js'))
        # (3) ratchets that read git ls-files and that nothing else runs
        for changed in ('extension/panel.js', 'desktop/lib/apply.js'):
            for ratchet in ('test/tooling/ci/hardcoded-page-words.test.js', 'test/tooling/ci/unpinned-clock.test.js'):
                self.assertIn(ratchet, picks(changed), f'{ratchet}: {changed}')
        # (4) guards over the test files: a new test file picks them
        new_test = picks('desktop/test/unit/main/zzz.test.js')
        for guard in ('test/guards/rules/skips-name-a-capability.test.js', 'test/guards/rules/unit-tests-no-playwright.test.js'):
            self.assertIn(guard, new_test, guard)
        # (6) the 2nd review: main.js is read by name through a helper (toast-scan.js, main-source.js), and a fixture two folders below test/ is read by a test that never names `test`
        for reader in ('test/unit/renderer/toast-targets.test.js', 'test/unit/main/critical.test.js', 'test/unit/main/run-kinds.test.js'):
            self.assertIn(reader, picks('desktop/main.js'), reader)
        self.assertIn('test/unit/cv/cv-inplace.test.js', picks('desktop/test/fixtures/cv-shapes/band.pdf'))
        self.assertIn('test/tooling/ci/file-size.test.js', picks('extension/panel.js'))   # a ratchet over the real tree
        # (5) and a change that touches no test file does not pick them (the saving stays)
        self.assertNotIn('test/guards/rules/skips-name-a-capability.test.js', picks('desktop/lib/keychain.js'))

    def test_a_test_that_runs_a_tool_as_a_process_is_picked(self):
        self.assertIn('test/unit/main/rename-guard.test.js', self.picked)   # the one test missed in the replay: red on 2 PRs, 3 Nov 2026

    def test_a_test_that_drives_a_script_is_picked_by_what_the_script_reaches(self):
        # 5 Nov 2026, #3257 changed desktop/renderer/*.js and style.css; apply-ui-state.test.js (spawns scripts/shot.mjs, which starts the app) was never picked and went red on main.
        users = subprocess.run(['git', 'grep', '-l', 'scripts/shot.mjs', '--', 'desktop/test/unit'], cwd=ROOT, capture_output=True, text=True, check=True).stdout.split()
        shot_users = [f for f in users if 'spawnSync' in (ROOT / f).read_text(encoding='utf-8')]   # shot-theme.test.js only reads the script's text: a renderer change cannot break it
        self.assertGreater(len(shot_users), 5, 'positive control: the tests that run shot.mjs are found')
        for changed in ('desktop/renderer/background-status.js', 'desktop/renderer/pages/session-log.js', 'desktop/renderer/style.css'):
            picked = self.picker.select([changed])['desktop']
            self.assertEqual([f for f in shot_users if f.removeprefix('desktop/') not in picked], [], changed)
        self.assertIn('test/unit/renderer/apply-ui-state.test.js', self.picker.select(['desktop/lib/main-window.js'])['desktop'])   # the app's own code too
        self.assertNotIn('test/unit/renderer/apply-ui-state.test.js', self.picker.select(['desktop/e2e/lib/extension.mjs'])['desktop'])   # a harness file is not the app

    def test_a_module_the_script_imports_picks_the_tests_that_run_the_script(self):
        # The same class without the app: shot.mjs imports cut-fields.mjs and shot-mark.mjs; the tests that spawn shot.mjs reach them only through the spawn.
        for changed in ('desktop/scripts/cut-fields.mjs', 'desktop/scripts/shot-mark.mjs'):
            self.assertIn('test/unit/renderer/rail-badges.test.js', self.picker.select([changed])['desktop'], changed)

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
        for changed in ('desktop/test/no-live-site.mjs', 'desktop/test/reporter-by-file.mjs', 'tools/check.py', 'tools/affected_readers.py', '.github/workflows/tests-desktop.yml', '.github/workflows/tests-desktop-windows.yml', 'desktop/package.json', 'eslint.config.mjs'):
            self.assertEqual(self.picker.select([changed])['desktop'], 'all', changed)

    def test_a_picked_run_keeps_lint_and_the_no_live_site_import(self):
        commands = [command for _, command in self.check.commands('desktop', False, 'node', 'npm', ['test/unit/main/a.test.js'])]
        self.assertIn(['npm', 'run', 'lint'], commands)
        self.assertIn('./test/no-live-site.mjs', commands[-1])
        self.assertEqual(commands[-1][-1], 'test/unit/main/a.test.js')

    def test_a_pr_windows_run_reaches_what_a_tool_change_breaks_there(self):
        # 5 Nov 2026, owner: "Yes: reached tests, every PR". #3172 changed tools/fixer; its PR never ran Windows (no listed file) and main's Windows was red 12 times on this test.
        fixer = sorted(subprocess.run(['git', 'ls-files', 'tools/fixer'], cwd=ROOT, capture_output=True, text=True, check=True).stdout.split())
        self.assertGreater(len(fixer), 5, 'positive control: the fixer files are found')
        for changed in fixer:
            picked = self.picker.select([changed])['desktop']
            self.assertIn('test/tooling/ci/fixer-loop.test.js', picked, changed)
            plan = [command for _, command in self.check.commands('desktop', False, 'node', 'npm', picked, app_only=True)]
            self.assertIn('test/tooling/ci/fixer-loop.test.js', plan[-1], changed)   # the tooling test it reaches stays on Windows
            self.assertNotIn(['npm', 'run', 'lint'], plan, changed)   # lint runs on Linux on the PR and on main
        self.assertEqual(self.check.commands('desktop', False, 'node', 'npm', [], app_only=True), [])   # a change that reaches no test runs nothing on Windows (the job ends before its install)

    def test_a_long_windows_pick_is_several_commands_that_name_each_picked_file_once(self):
        # Gitar on #3256: a pick of ~800 files is ~33,000 characters, over Windows' 32,767. 7 Nov 2026 (ts 2/3): it used to become every non-tooling test by glob (598 printed, 1,069 run); now it is split.
        picked = [f'test/unit/main/a-long-test-file-name-{n:04d}.test.js' for n in range(700)] + ['test/tooling/ci/fixer-loop.test.js']
        plan = self.check.commands('desktop', False, 'node', 'npm', picked, app_only=True)
        runs = plan[1:]   # the first command is the stage step
        self.assertGreater(len(runs), 1, 'a pick over the budget is more than one command')
        for _, command in runs:
            self.assertLess(sum(len(arg) + 1 for arg in command), 32000)
        self.assertFalse(any('*' in arg for _, command in plan for arg in command), 'no glob: the files run are the files picked')
        self.assertEqual([arg for _, command in runs for arg in command if arg.startswith('test/')], picked)
        self.assertEqual(self.check.files_named(plan), len(picked))

    def test_a_red_chunk_of_a_long_pick_does_not_hide_the_next_chunk_and_a_red_lint_stops_the_run(self):
        # ts 2/3 review: a long pick is several commands; the first red chunk must not hide the reds of the others (one command listed them all before).
        def run(plan, failing):
            seen = []
            def fake(command, **_):
                seen.append(command[-1])
                return mock.Mock(returncode=1 if command[-1] in failing else 0)
            with mock.patch.object(self.check.subprocess, 'run', fake):
                return self.check.run_commands('desktop', [(ROOT, c) for c in plan], {}), seen
        chunks = [['node', '--test', 'test/a.test.js'], ['node', '--test', 'test/b.test.js']]
        self.assertEqual(run(chunks, {'test/a.test.js'}), (False, ['test/a.test.js', 'test/b.test.js']))
        self.assertEqual(run([['npm', 'run', 'lint'], *chunks], {'lint'}), (False, ['lint']))
        self.assertEqual(run(chunks, set()), (True, ['test/a.test.js', 'test/b.test.js']))

    def test_a_run_that_names_other_files_than_it_printed_is_counted_as_a_gap(self):
        # 7 Nov 2026, mac-50: the runner fails when the files it runs differ from the files it printed; a glob names none, so a fallback to one shows up as a gap.
        glob = [(ROOT, ['node', '--test', 'test/**/*.test.js'])]
        self.assertEqual(self.check.files_named(glob), 0)
        named = [(ROOT, ['node', '--import', './test/no-live-site.mjs', '--test', 'test/unit/main/a.test.js', 'test/guards/rules/b.test.js'])]
        self.assertEqual(self.check.files_named(named), 2)
        two = ['test/unit/main/a.test.js', 'test/guards/rules/b.test.js']
        self.assertFalse(self.check.pick_gap('desktop', two, named), 'the files named are the files printed')
        self.assertTrue(self.check.pick_gap('desktop', two + ['test/unit/main/c.test.js'], glob), 'a glob in place of the pick is a gap')
        self.assertFalse(self.check.pick_gap('desktop', 'all', glob), 'main runs everything by glob: no pick, no gap')

    def test_the_windows_plan_counts_what_a_change_reaches(self):
        # The workflow skips its install on 0: a doc no test reads is 0, a tools/fixer file is not, a lock file is all (a package.json is all only when its dependencies changed: the tests below).
        import contextlib, io, os
        def plan(changed):
            out = io.StringIO()
            with mock.patch.dict(os.environ, {'JOBADABRA_AFFECTED_FILES': changed}), contextlib.redirect_stdout(out):
                self.check.main(['--plan', '--area', 'desktop', '--app-only', '--affected-from', 'HEAD^1'])
            return out.getvalue().strip()
        self.assertEqual(plan('docs/rules/change-loop.md'), '0')
        self.assertGreater(int(plan('tools/fixer/loop.mjs')), 0)   # not 0: the fixer's tests reach it (it was "over 100" only while every guard ran for every change; 34 on 7 Nov 2026)
        self.assertEqual(plan('desktop/package-lock.json'), 'all')   # the lock file: 'all' whatever this checkout holds (a package.json's verdict reads git; its tests are below; Gitar on ts 4/5)

    def test_a_package_json_runs_everything_only_when_more_than_its_scripts_changed(self):
        # 7 Nov 2026, owner: "windows tests still takes a lot of time" (ts 4/4): #3475 added one script line to desktop/package.json and ran all 1068 desktop tests for 4m29s.
        def change(*files, result):
            with mock.patch.object(self.picker.readers, 'package_json_change', return_value=result):
                return self.picker.select(list(files), 'origin/main')
        scripts_only = change('desktop/package.json', 'desktop/scripts/design-check.mjs', result=(False, {'drawer-shots'}))
        self.assertIsInstance(scripts_only['desktop'], list)   # not 'all'
        self.assertLess(len(scripts_only['desktop']), 300)
        self.assertIn('test/unit/main/e2e-hidden.test.js', scripts_only['desktop'])   # it names the script that changed
        self.assertNotIn('test/unit/main/e2e-hidden.test.js', change('desktop/package.json', result=(False, set()))['desktop'])
        for changed, area in (('desktop/package.json', 'desktop'), ('package.json', 'desktop'), ('desktop/e2e/package.json', 'e2e'), ('app-core/package.json', 'worker')):   # a dependency bump, in every manifest that counts
            self.assertEqual(change(changed, result=(True, set()))[area], 'all', changed)
        self.assertEqual(self.picker.select(['desktop/package-lock.json'], 'origin/main')['desktop'], 'all')   # the lock file stays 'all'
        self.assertNotEqual(change('package.json', result=(False, {'lint'}))['desktop'], 'all')   # a root manifest follows the same rule

    def test_package_json_change_reads_the_file_at_the_base_and_runs_everything_when_in_doubt(self):
        import json
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            run = lambda *a: subprocess.run(['git', '-c', 'user.name=t', '-c', 'user.email=t@t', *a], cwd=root, capture_output=True, text=True, check=True)
            write = lambda **fields: (root / 'package.json').write_text(json.dumps(fields))
            run('init', '-q', '-b', 'main')
            write(scripts={'keep': 'a', 'edit': 'b', 'gone': 'c'}, devDependencies={'x': '1'})
            run('add', '.'), run('commit', '-q', '-m', 'base')
            run('checkout', '-q', '-b', 'pr')
            read = lambda: self.picker.readers.package_json_change('package.json', 'main', root)
            self.assertEqual(read(), (True, set()))   # listed as changed but identical to the base: not understood, run it
            write(scripts={'keep': 'a', 'edit': 'B', 'new': 'd'}, devDependencies={'x': '1'}, version='2')
            self.assertEqual(read(), (False, {'edit', 'gone', 'new'}))   # scripts and version: the names that changed
            write(scripts={'keep': 'a', 'edit': 'b', 'gone': 'c'}, devDependencies={'x': '2'})
            self.assertEqual(read(), (True, set()))   # a dependency bump
            write(scripts={'keep': 'a', 'edit': 'b', 'gone': 'c'}, devDependencies={'x': '1'}, description='new pitch')
            self.assertEqual(read(), (True, set()))   # a Python guard reads the description
            for name in ('test', 'pretest', 'postinstall'):   # the test run itself goes through these (tools/check.py reads `test`)
                write(scripts={'keep': 'a', 'edit': 'b', 'gone': 'c', name: 'changed'}, devDependencies={'x': '1'})
                self.assertEqual(read(), (True, set()), name)
            write(scripts={'keep': 'a', 'edit': 'b', 'gone': 'c'}, devDependencies={'x': '1'}, type='module')
            self.assertEqual(read(), (True, set()))   # any other field may change what every test loads
            (root / 'package.json').write_text('{ not json')
            self.assertEqual(read(), (True, set()))   # unreadable: run it
            self.assertEqual(self.picker.readers.package_json_change('package.json', None, root), (True, set()))   # no base to compare with
            self.assertEqual(self.picker.readers.package_json_change('missing/package.json', 'main', root), (True, set()))   # a new file

    def test_main_runs_every_windows_test_and_a_full_fallback_still_leaves_tooling_out(self):
        main = [command for _, command in self.check.commands('desktop', False, 'node', 'npm', 'all')]
        self.assertEqual(main, [['npm', 'test']])
        full = self.check.commands('desktop', False, 'node', 'npm', 'all', app_only=True)
        self.assertEqual(full[0][1][1], 'scripts/stage.mjs')
        self.assertTrue(any(arg.startswith('test/') for arg in full[1][1]))


if __name__ == '__main__':
    unittest.main()
