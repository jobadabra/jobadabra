"""Focus's "Apply" row: it names the best jobs to apply to, and never a kit (owner, 5 Nov 2026: "The user cares only about applying")."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from src import focus
from tests import zone
from tests.model_stand_ins import booking  # the model's answer (src/ai/meanings.py)
from tests.unit.notion.test_focus import NOW, row

_pin, tearDownModule = zone.pinned()
setUpModule = lambda: (_pin(), booking())  # noqa: E731


class ApplyRowTests(unittest.TestCase):
    def test_the_apply_row_names_the_best_jobs_and_never_a_kit(self):
        # Owner, 5 Nov 2026: "The user cares only about applying". Saved and the internal Kit ready are the same to the person.
        rows = [row('a', 'Low Fit', 'x', stage='Saved', fit=60), row('b', 'Top Fit', 'y', stage='Kit ready', fit=90),
                row('c', 'Next Fit', 'z', stage='Saved', fit=80), row('d', 'Next Fit', 'w', stage='Saved', fit=70)]
        built = focus.build(rows, [], target=3, now=NOW)
        item = next(i for i in built['items'] if i['kind'] == 'apply')
        self.assertEqual(item['best'], ['Top Fit', 'Next Fit'])
        self.assertEqual(item['meta'], ['Your best: Top Fit, Next Fit', '0 of 3 today'])
        self.assertEqual(built['summary'], 'Apply to your next role.')
        self.assertNotIn('kit', str(item).lower())

    def test_it_names_the_jobs_apply_starts_first_prepared_before_a_higher_fit(self):
        rows = [row('a', 'Not Prepared', 'x', stage='Saved', fit=95), row('b', 'Prepared', 'y', stage='Kit ready', fit=70),
                row('c', 'Saved Prepared', 'z', stage='Saved', fit=60, Next_step='📝 Kit ready: review it, then Apply')]
        item = next(i for i in focus.build(rows, [], target=3, now=NOW)['items'] if i['kind'] == 'apply')
        self.assertEqual(item['best'], ['Prepared', 'Saved Prepared'])

    def test_a_kit_that_says_not_eligible_counts_as_prepared_as_it_does_for_apply(self):
        rows = [row('a', 'Not Prepared', 'x', stage='Saved', fit=95), row('b', 'Flagged', 'y', stage='Saved', fit=70, Next_step='⛔ Not eligible: needs a visa')]
        item = next(i for i in focus.build(rows, [], target=3, now=NOW)['items'] if i['kind'] == 'apply')
        self.assertEqual(item['best'], ['Flagged', 'Not Prepared'])

    def test_with_no_saved_job_the_apply_row_says_the_application_is_prepared_for_you(self):
        # #3227 / #3202: the Focus page told a new person to "review ready applications" with nothing there to review.
        built = focus.build([row('a', 'A', 'x', stage='Found')], [], target=3, now=NOW)
        item = next(i for i in built['items'] if i['kind'] == 'apply')
        self.assertEqual(item['meta'], ['Your application is prepared automatically when you apply', '0 of 3 today'])
        self.assertEqual(built['summary'], 'Apply to your next role.')


if __name__ == '__main__':
    unittest.main()
