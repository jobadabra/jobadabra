"""Guard: release (tools/design-table-check.py, tools/pr-body-format.py) — tools/pr-body.sh lets a desktop-window PR through on the Design system report in its body; without this a ⛔ report could pass, a green one could be refused, or the formatter could drop the commit and verdict the reader needs.
Why (7 Nov 2026, owner: "let's make it one green per column. I don't want to see 100 checkboxes"; chosen "Verdict + only what fails"): both forms of the report, as the check prints them and as the formatter lays them out."""
import importlib.util
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / file)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


GREEN = '**Design system (measured on {sha})** ✅ all 6 rules pass on 12 screens\nvs main: ghost 40 → 31 ▼9'
OLD_GRID = '''**Design system (measured on {sha})**

| Rule | jobs 640 | jobs 1100 |
|---|---|---|
| Spacing scale | ✅ | ✅ |
| 1 primary / card | ✅ | ✅ |
| No ghost button | ✅ | {cell} |
| No card in card | ✅ | ✅ |
| Nothing clipped | ✅ | ✅ |
| Contrast AA (L/D) | ✅ | ✅ |'''
RED = '''**Design system (measured on {sha})** ⛔ 2 new problems
vs main: spacing 64 → 67 ▲3

| Rule | Screen | New | What |
|---|---|---|---|
| Spacing scale | jobs 640 | +1 | `div.card` gap 13px |
| 1 primary / card | focus 1100 | +1 | `section#up-next` 2 primary buttons |'''


class DesignReport(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.check, cls.format = load('design_table_check', 'tools/design-table-check.py'), load('pr_body_format', 'tools/pr-body-format.py')
        cls.old = os.getcwd()
        cls.repo = tempfile.mkdtemp()
        os.chdir(cls.repo)
        run = lambda *a: subprocess.run(['git', '-c', 'user.name=t', '-c', 'user.email=t@t', *a], check=True, capture_output=True, text=True).stdout.strip()
        run('init', '-q', '-b', 'main')
        Path('a.txt').write_text('x')
        run('add', '.')
        run('commit', '-qm', 'base')
        run('checkout', '-qb', 'pr')
        Path('desktop/renderer').mkdir(parents=True)
        Path('desktop/renderer/page.css').write_text('.a{gap:8px}')
        run('add', '.')
        run('commit', '-qm', 'draw')
        cls.sha = run('rev-parse', '--short', 'HEAD')

    @classmethod
    def tearDownClass(cls):
        os.chdir(cls.old)

    def test_the_one_line_green_report_passes(self):
        self.assertIsNone(self.check.problem('main', GREEN.format(sha=self.sha) + '\n\n| What changed | Before | After |\n|---|---|---|\n'))

    def test_a_report_with_failing_rows_is_refused_naming_its_rows(self):
        why = self.check.problem('main', RED.format(sha=self.sha))
        self.assertIn('2 new problems', why)
        self.assertIn('Spacing scale jobs 640 +1; 1 primary / card focus 1100 +1', why)
        self.assertNotIn('What changed', why)

    def test_no_report_no_verdict_and_a_report_on_another_change_are_refused(self):
        self.assertIn('no "Design system', self.check.problem('main', 'nothing here'))
        self.assertIn('no row for', self.check.problem('main', f'**Design system (measured on {self.sha})**\n| Rule | jobs 640 |'))   # a title with no verdict is the old grid, and this one has no rows
        self.assertIn('no verdict', self.check.problem('main', f'**Design system (measured on {self.sha})** looks fine'))
        base = subprocess.run(['git', 'rev-parse', '--short', 'main'], capture_output=True, text=True).stdout.strip()
        self.assertIn('has changed since', self.check.problem('main', GREEN.format(sha=base)))

    def test_a_green_report_does_not_repeat_the_number_of_rules(self):
        self.assertIsNone(self.check.problem('main', f'**Design system (measured on {self.sha})** ✅ all 7 rules pass on 1 screen'))

    def test_the_old_grid_is_still_read_for_the_prs_that_carry_it(self):
        self.assertIsNone(self.check.problem('main', OLD_GRID.format(sha=self.sha, cell='✅')))
        self.assertIn('No ghost button', self.check.problem('main', OLD_GRID.format(sha=self.sha, cell='❌ `button.x` Skip (light)')))
        self.assertIn('no row for', self.check.problem('main', OLD_GRID.format(sha=self.sha, cell='✅').replace('| No ghost button | ✅ | ✅ |\n', '')))
        laid = self.format.lay_out('🎨 x\n\n' + OLD_GRID.format(sha=self.sha, cell='✅') + '\n')
        self.assertIsNone(self.check.problem('main', laid), laid)

    def test_the_formatter_keeps_the_sha_and_verdict_the_reader_needs_in_both_forms(self):
        for form, verdict in ((GREEN, '✅ all 6 rules pass on 12 screens'), (RED, '⛔ 2 new problems')):
            laid = self.format.lay_out('🎨 The jobs screen moved\n\n' + form.format(sha=self.sha) + '\n')   # the first line is the PR's verdict
            self.assertIn(f'### 🎨 Design system (measured on {self.sha}) {verdict}', laid)
            self.assertEqual(self.check.problem('main', laid) is None, '✅' in verdict, laid)
        self.assertIn('| Spacing scale | jobs 640 | +1 |', self.format.lay_out('🎨 x\n\n' + RED.format(sha=self.sha) + '\n'))


if __name__ == '__main__':
    unittest.main()
