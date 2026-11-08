"""The Find jobs stage table (src/press/stages.py, plan docs/superpowers/plans/2026-11-07-the-press.md 4/6) stays true: each owner file exists,
each budget row is in src/press/budget.json, runs-beside is symmetric, each stage the clock names in its "Time is up" lines is in one row, and
the table has no stage twice."""
import unittest
from pathlib import Path

from src.press import budget, stages
from src.press.clock import Clock

ROOT = Path(__file__).resolve().parents[3]


class StageTableTest(unittest.TestCase):
    def test_ids_are_unique_and_every_owner_file_exists(self):
        self.assertEqual(len(stages.BY_ID), len(stages.TABLE))
        for stage in stages.TABLE:
            for path in stage.owners:
                with self.subTest(stage.id, path=path):
                    self.assertTrue((ROOT / path).is_file(), f'{stage.id}: {path} is not a file')

    def test_each_budget_row_is_in_the_table(self):
        rows = budget.rows()
        for stage in stages.TABLE:
            for name in stage.budget:
                with self.subTest(stage.id, row=name):
                    self.assertIn(name, rows)

    def test_runs_beside_is_symmetric_and_names_stages(self):
        for stage in stages.TABLE:
            for other in stage.beside:
                with self.subTest(stage.id, beside=other):
                    self.assertIn(other, stages.BY_ID, 'a stage that is not in the table')
                    self.assertNotEqual(other, stage.id)
                    self.assertIn(stage.id, stages.BY_ID[other].beside, f'{other} does not list {stage.id} beside it')

    def test_every_clock_stage_is_in_exactly_one_row(self):
        said = [name for stage in stages.TABLE for name in stage.clock]
        self.assertEqual(sorted(said), sorted(Clock.STAGES))


if __name__ == '__main__':
    unittest.main()
