"""Guard: release — the "Search before/after" row decides whether a search PR looks safe to merge (3/3 makes "All checks passed" read it): a wrong band reds honest PRs or greens a loss,
and a pair that did not count must never read green (owner via sa, 13 Nov 2026: "instead of having \"DONT MERGE\"... we'll just have red check")."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'tools' / 'persona-search'))
import pair_row  # noqa: E402


def moves(before, after):
    return {'before': before, 'after': after, 'd': None, 'line': ''}


def rows(**sides):
    return {person: {'main': [{'valid': True, 'shared': True, 'wait_p90_ms': 1000}], 'pr': [{'valid': True, 'shared': True, 'wait_p90_ms': 1000}]} for person in sides}


class TheRow(unittest.TestCase):
    def test_a_loss_beyond_the_band_is_red_with_the_person_and_the_numbers_and_the_way_out(self):
        out = pair_row.decide({'c04': moves(15, 5)}, ['c04'], {'c04'}, {'c04': None}, 1, rows(c04=1))
        self.assertEqual(out['conclusion'], 'failure')
        self.assertIn('c04 15 → 5', out['title'])
        self.assertIn('ruleset override', out['summary'])

    def test_run_43498213279s_same_code_spread_of_7_is_not_a_loss(self):
        out = pair_row.decide({'c04': moves(15, 8)}, ['c04'], {'c04'}, {'c04': None}, 1, rows(c04=1))   # 8 vs 15, the same code both sides
        self.assertEqual(out['conclusion'], 'success')
        self.assertIn('within the usual difference of 7: not a proven gain', out['title'])

    def test_a_measured_spread_is_the_band_when_there_is_one(self):
        self.assertEqual(pair_row.decide({'p3': moves(10, 8)}, ['p3'], {'p3'}, {'p3': 1}, 1, rows(p3=1))['conclusion'], 'failure')   # lost 2, spread 1
        self.assertEqual(pair_row.decide({'p3': moves(10, 9)}, ['p3'], {'p3'}, {'p3': 1}, 1, rows(p3=1))['conclusion'], 'success')

    def test_a_gain_beyond_the_band_says_so(self):
        out = pair_row.decide({'c15': moves(5, 20)}, ['c15'], {'c15'}, {'c15': None}, 1, rows(c15=1))
        self.assertIn('gain beyond the usual difference of 7', out['title'])

    def test_a_pair_that_did_not_count_runs_once_more_then_is_red_never_green(self):
        flat = {'b10': {'main': [{'valid': False, 'shared': False}], 'pr': [{'valid': False, 'shared': False}]}}
        first = pair_row.decide({}, ['b10'], {'b10'}, {}, 1, flat)
        self.assertEqual((first['conclusion'], first['rerun']), ('neutral', ['b10']))
        self.assertIn('boards not shared', first['title'])
        second = pair_row.decide({}, ['b10'], {'b10'}, {}, 2, flat)
        self.assertEqual((second['conclusion'], second['rerun']), ('failure', []))
        self.assertTrue(second['title'].startswith('not counted: b10'))

    def test_a_newer_head_makes_the_old_row_grey_and_runs_nothing(self):
        out = pair_row.decide({'c04': moves(15, 5)}, ['c04'], {'c04'}, {}, 1, rows(c04=1), newer_head=True)
        self.assertEqual((out['conclusion'], out['rerun']), ('neutral', []))

    def test_a_loss_is_red_even_when_another_person_did_not_count(self):
        out = pair_row.decide({'c04': moves(15, 5)}, ['c04', 'b10'], {'c04', 'b10'}, {}, 1, rows(c04=1, b10=1))
        self.assertEqual((out['conclusion'], out['rerun']), ('failure', []))   # a loss is never run again

    def test_the_clock_text_names_when_it_started_and_about_when_it_ends(self):
        self.assertEqual(pair_row.running('20:29', 'running'), 'running since 20:29Z, ends ~20:40Z')
        self.assertEqual(pair_row.ends('23:55'), '00:06Z')


if __name__ == '__main__':
    unittest.main()
