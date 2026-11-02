"""The 10-min budget of a CI-changing PR (tools/pr-verdict.py): what it counts, and the Search check it leaves out.
Why (2 Nov 2026, owner, option "Budget skips Search check"): #2994 went red only on "checks ran 14.0 min running … over the 10-min budget"; every job ended by
14:24 except the Search check, whose six personas run two at a time (owner, 30 Oct 2026: the broker has four slots), ~13.5 min whatever the PR changed."""
import json
import unittest
from unittest import mock

from tests.test_pr_verdict import pv, run

CI_FILES = ['.github/workflows/tests-python.yml', 'src/repos.py']


def search(id=9, end='2026-11-02T14:32:03Z'):
    return run(pv.BUDGET_SKIPS[0], id=id, at='2026-11-02T14:18:00Z', end=end)


class BudgetSkipsTheSearchCheck(unittest.TestCase):
    def test_a_ci_change_is_green_when_only_the_search_check_runs_past_ten_minutes(self):
        # #2994's shape: the PR's own checks ended within 6.4 min, the Search check at 14.0.
        tests = run('CI · Tests · python', id=1, at='2026-11-02T14:18:00Z', end='2026-11-02T14:24:22Z')
        state, why, *_ = pv.verdict([tests, search()], files=CI_FILES, now=pv._at('2026-11-02T14:33:00Z'))
        self.assertEqual(state, 'success', why)

    def test_positive_control_any_other_check_past_ten_minutes_still_fails_a_ci_change(self):
        slow = run('CI · Tests · python', id=1, at='2026-11-02T14:18:00Z', end='2026-11-02T14:32:00Z')
        state, why, *_ = pv.verdict([slow, search()], files=CI_FILES)
        self.assertEqual(state, 'failure', why)
        self.assertIn('over the 10-min budget', why)
        self.assertEqual(pv.verdict([slow, search()], files=CI_FILES, messages=['x\n\nCI-budget: a long migration'])[0], 'success', 'the CI-budget line still lifts it')

    def test_a_red_search_check_still_fails_the_pr(self):
        state, why, *_ = pv.verdict([run('CI · Tests · python', id=1), dict(search(), conclusion='failure')], files=CI_FILES)
        self.assertEqual(state, 'failure', why)
        self.assertIn('Search check', why)

    def test_job_spans_leave_out_the_search_check_s_jobs(self):
        listed = {1: [{'name': 'python', 'started_at': '2026-11-02T14:18:56Z', 'completed_at': '2026-11-02T14:23:42Z'}],
                  9: [{'name': 'Persona 5', 'started_at': '2026-11-02T14:27:15Z', 'completed_at': '2026-11-02T14:31:32Z'}]}
        fake = lambda *args: json.dumps(listed[int(args[1].split('/runs/')[1].split('/')[0])])
        with mock.patch.object(pv, 'gh', side_effect=fake):
            spans = pv.job_spans('o/r', [run('CI · Tests · python', id=1), search()])
        self.assertEqual(spans, [('2026-11-02T14:18:56Z', '2026-11-02T14:23:42Z')])


if __name__ == '__main__':
    unittest.main()
