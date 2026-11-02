"""The one e2e a pull request runs: the steps it adds or edits (pr-e2e-steps.yml, owner, 2 Nov 2026), and how the PR verdict treats that run.
Moved out of test_pr_verdict.py (500-line limit); same helpers."""
import re
import unittest

from tests.test_pr_verdict import WORKFLOWS, pv, run


class PrE2eSteps(unittest.TestCase):
    # Why (1 Nov 2026, owner: "I'd like to avoid e2e at the PR at all / Cause they're very slow", option "No e2e on PRs"): the journeys run after each merge (main-steps.yml),
    # a red merge is reverted by e2e-revert.yml. Why (2 Nov 2026, owner: "A PR adding a new e2e or modifying the e2e.. should have it as a PR CI check" — "the only exception when we run e2e
    # on the PR level"): one workflow, pr-e2e-steps.yml, starts e2e.yml for the steps a PR adds or edits, on Linux; no other PR workflow starts an e2e run.
    def test_only_the_changed_steps_workflow_starts_an_e2e_run_on_a_pr(self):
        self.assertFalse((WORKFLOWS / 'pr-suites.yml').exists(), 'pr-suites.yml started an e2e run for every PR that touched the app')
        starter = re.compile(r'(?m)^[^#\n]*(\bworkflow run\s+|\bdispatch\s+|uses:\s*\./\.github/workflows/)e2e(-windows)?\.yml')
        for path in WORKFLOWS.glob('*.yml'):
            text = path.read_text(encoding='utf-8')
            if re.search(r'(?m)^  pull_request(_target)?:|^on:.*\bpull_request\b', text) and path.name != 'pr-e2e-steps.yml':
                self.assertNotRegex(text, starter, f'{path.name}: a PR workflow starts an e2e run')
        steps = (WORKFLOWS / 'pr-e2e-steps.yml').read_text()
        self.assertEqual(set(re.findall(r'gh workflow run ([\w.-]+\.yml)', steps)), {'e2e.yml'}, 'Linux e2e only: no Windows or Mac check on a PR')
        trigger = steps.split('\npermissions:')[0]
        self.assertEqual(set(re.findall(r"(?m)^      - '([^']+)'", trigger)), {'desktop/e2e/suites/**', 'desktop/e2e/lib/**', '.github/workflows/pr-e2e-steps.yml'}, 'it starts only for a PR that touches a file of steps')
        self.assertIn('--plan --changed-steps', steps, 'the picker is the one in desktop/e2e/pr-suites.mjs')
        self.assertRegex(steps, r"Start them\n(?:.*\n)*?        if: steps\.plan\.outputs\.suites != ''", 'no changed step: nothing is started')
        self.assertIn('node desktop/e2e/pr-suites.mjs --base "$BEFORE" --plan', (WORKFLOWS / 'main-steps.yml').read_text(), 'positive control: the merge still plans its e2e steps')

    def test_pr_checks_decide_with_no_e2e_run_when_no_step_changed(self):
        # The verdict waits for nothing it cannot see: a PR that changes no step has no e2e run, and only PR workflows are counted.
        runs = [run(name, id=i) for i, name in enumerate(['CI · Pull request', 'CI · Tests · python', 'CI · Tests · desktop', 'CI · Page cases (all cases, real extension, Linux)'], 1)]
        state, why, counted_runs, *_ = pv.verdict(runs, files=['tools/pr-verdict.py', '.github/workflows/pr-verdict.yml'])
        self.assertEqual((state, len(counted_runs)), ('success', 4), why)
        self.assertEqual(pv.verdict(runs + [run('CI · Tests · worker', status='in_progress', id=9)])[0], 'pending', 'positive control: a running PR check still holds it')
        self.assertEqual(pv.verdict(runs + [run('CI · Tests · worker', conclusion='failure', id=9)])[0], 'failure', 'positive control: a red PR check still fails it')
        self.assertTrue({'e2e.yml', 'pr-e2e-steps.yml'} <= set(pv.PR_WORKFLOWS))
        self.assertTrue({'pr-suites.yml'}.isdisjoint(pv.PR_WORKFLOWS))
        # a PR that changed only a comment: the step workflow ran, started nothing, ended green: the verdict is green with that run counted
        quiet = runs + [run('CI · E2E steps a PR changes', id=8)]
        self.assertEqual(pv.verdict(quiet)[0], 'success')

    def test_pr_checks_wait_for_the_e2e_run_when_a_step_changed(self):
        # pr-e2e-steps.yml started e2e.yml (workflow_dispatch, titled "E2E for PR · …"): its run is counted beside the PR workflows, held while it runs, red when a step fails.
        title = 'E2E for PR · jobs · my-branch'
        ended = [run('CI · Pull request', id=1), run('CI · E2E steps a PR changes', id=2)]
        e2e = lambda **kw: run('CI · End-to-end on Mac + Linux', event='workflow_dispatch', title=title, id=3, **kw)
        state, why, *_ = pv.verdict(ended + [e2e(status='in_progress')])
        self.assertEqual(state, 'pending', why)
        self.assertIn('e2e jobs', why)
        self.assertEqual(pv.verdict(ended + [e2e(conclusion='failure')])[0], 'failure')
        self.assertEqual(pv.verdict(ended + [e2e()])[0], 'success', 'the step ran and was green')
        self.assertEqual(pv.verdict(ended)[0], 'success', 'positive control: with no e2e run the same PR is green')
        # an after-merge or nightly run of e2e.yml on the same sha is not a PR run and is never counted
        main_run = run('CI · End-to-end on Mac + Linux', event='workflow_dispatch', title='E2E after merge · abc1234 · jobs', status='in_progress', id=4)
        self.assertEqual(pv.verdict(ended + [main_run])[0], 'success')


if __name__ == '__main__':
    unittest.main()
