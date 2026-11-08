"""Every second and count of a Find jobs run is one row of src/press/budget.json (plan docs/superpowers/plans/2026-11-07-the-press.md 3/6;
owner, 7 Nov 2026: "we overwrite one another and we never get it right"): each row has its why and the PR or date that set it, each stage
file's name is the table's value, the seconds fit in the run, and the app's own numbers (desktop/lib, JavaScript) equal their rows."""
import importlib
import re
import unittest
from pathlib import Path

from src.press import budget

ROOT = Path(__file__).resolve().parents[3]
MODULES = {'time_budget': 'src.time_budget', 'read_budget': 'src.sources.read_budget', 'boards': 'src.sources.boards',
           'boards_first': 'src.sources.boards_first', 'eures': 'src.sources.eures', 'first_jobs': 'src.first_jobs', 'title_triage': 'src.ai.title_triage'}
APP = {'SEARCH_BUDGET_S': 'desktop/lib/pipeline-args.js', 'SCOUT_SHARE_S': 'desktop/lib/search-steps.js',
       'STOP_MARGIN_S': 'desktop/lib/search-steps.js', 'STEP_MIN_S': 'desktop/lib/search-steps.js'}
UNITS = {'s', 's/item', 'count', 'share'}


def where(name):
    """(module, attribute, key or None) of a row's name: time_budget.SHARE.score -> (time_budget module, 'SHARE', 'score')."""
    parts = name.split('.')
    return importlib.import_module(MODULES[parts[0]]), parts[1], (parts[2] if len(parts) == 3 else None)


class BudgetTableTest(unittest.TestCase):
    def test_every_row_says_why_and_which_pr_set_it(self):
        for name, row in budget.rows().items():
            with self.subTest(name):
                self.assertEqual(set(row), {'name', 'value', 'unit', 'why', 'pr'})
                self.assertIn(row['unit'], UNITS)
                self.assertGreater(len(row['why']), 20, 'a reason a reader can check')
                self.assertRegex(row['pr'], r'^(#\d+|\d{4}-\d\d-\d\d)$')

    def test_each_stage_file_reads_its_number_from_the_table(self):
        engine = [name for name in budget.rows() if not name.startswith('app.')]
        for name in engine:
            with self.subTest(name):
                module, attr, key = where(name)
                held = getattr(module, attr)
                self.assertEqual(held[key] if key else held, budget.value(name))
        self.assertEqual({where(n)[1] for n in engine} >= {'PLANNED', 'SHARE', 'PACE', 'READ_SECONDS', 'SLICE', 'MAX_NEW'}, True)

    def test_the_numbers_fit_in_the_run(self):
        planned = budget.value('time_budget.PLANNED')
        for name, row in budget.rows().items():
            with self.subTest(name):
                value = row['value']
                self.assertIsInstance(value, float if row['unit'] in ('share', 's/item') else int)
                if row['unit'] == 'share':
                    self.assertTrue(0 < value <= 1)
                elif row['unit'] == 's':
                    self.assertTrue(0 <= value <= planned, 'a second of the run is within its 180')
                else:
                    self.assertGreater(value, 0)
        self.assertEqual(budget.value('app.SEARCH_BUDGET_S'), planned, "the engine's seconds are planned for the app's budget")
        self.assertLess(budget.value('read_budget.READ_SECONDS') + budget.value('read_budget.READ_GRACE'), planned - budget.value('app.SCOUT_SHARE_S'))
        self.assertLess(budget.value('boards.SHARE_S'), budget.value('read_budget.READ_SECONDS'))

    def test_the_apps_numbers_equal_their_rows(self):
        # The packaged app runs desktop/lib's JavaScript, not this table: the two are pinned equal here (read as text, no JS run).
        for name, path in APP.items():
            with self.subTest(name):
                text = (ROOT / path).read_text(encoding='utf-8')
                held = re.search(rf'^(?:export )?const {name} = (?:.*\? CEILING : )?(\d+);', text, re.M)
                self.assertIsNotNone(held, f'{name} in {path}')
                self.assertEqual(int(held.group(1)), budget.value(f'app.{name}'))

    def test_a_name_the_table_lacks_is_an_error_not_a_guess(self):
        with self.assertRaises(KeyError):
            budget.value('time_budget.PLANED')


if __name__ == '__main__':
    unittest.main()
