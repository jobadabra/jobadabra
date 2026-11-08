"""Guard: release — the PR's required verdict (tools/pr-verdict.py counted) picks each workflow's newest run; a duplicate GitHub cancelled as a
same-second twin must not read as the newest, or a green PR shows red (#3594, 8 Nov 2026: pr-gate.yml "Guard" 42456650126 success and 42456650156
cancelled, both created 06:54:56Z by a push, a body refresh and a retitle)."""
import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location('pr_verdict', ROOT / 'tools' / 'pr-verdict.py')
pv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pv)


def guard(id, conclusion, at, end=None):
    """One pr-gate.yml run as `gh run list` gives it."""
    return {'databaseId': id, 'workflowName': 'Guard', 'workflowDatabaseId': 7, 'status': 'completed', 'conclusion': conclusion,
            'event': 'pull_request', 'createdAt': at, 'updatedAt': end or at, 'displayTitle': '[ps] 2/6c-2 a title'}


class SameSecondTwins(unittest.TestCase):
    def test_a_cancelled_twin_of_the_same_second_does_not_turn_the_verdict_red(self):
        pair = [guard(42456650126, 'success', '2026-11-08T06:54:56Z', '2026-11-08T06:55:36Z'),
                guard(42456650156, 'cancelled', '2026-11-08T06:54:56Z', '2026-11-08T06:54:57Z')]
        self.assertEqual([r['conclusion'] for r in pv.counted(pair)], ['success'])
        self.assertEqual(pv.verdict(pair)[0], 'success')

    def test_a_run_cancelled_after_it_worked_still_counts_in_the_same_second(self):
        # Gitar on #3596: a push run and an edit run start in one second in separate groups; the push run cancelled minutes later is a real red.
        pair = [guard(42456650126, 'success', '2026-11-08T06:54:56Z', '2026-11-08T06:55:36Z'),
                guard(42456650156, 'cancelled', '2026-11-08T06:54:56Z', '2026-11-08T07:02:10Z')]
        self.assertEqual(pv.verdict(pair)[0], 'failure')

    def test_a_cancel_in_a_later_second_still_counts(self):
        # A run cancelled by hand or by a hang guard, after its workflow's last green, is that workflow's newest result: red.
        pair = [guard(42456650126, 'success', '2026-11-08T06:54:56Z'), guard(42456650156, 'cancelled', '2026-11-08T06:54:57Z')]
        self.assertEqual([r['conclusion'] for r in pv.counted(pair)], ['cancelled'])
        self.assertEqual(pv.verdict(pair)[0], 'failure')


if __name__ == '__main__':
    unittest.main()
