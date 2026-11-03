"""A job GitHub never started (no runner, 0 steps, "not acquired by Runner") is re-run once; a real red stays red. Beta 3 (run 40341958250, 26 Oct 2026):
interactions got no macOS runner for 29 min and read as a red suite. Fixture: tests/fixtures/beta3-jobs.json (that run's jobs and the job's annotations)."""
import copy
import json
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from tools.rerun_not_acquired import decide, setup_failed  # noqa: E402

BETA3 = json.loads((ROOT / 'tests' / 'fixtures' / 'beta3-jobs.json').read_text(encoding='utf-8'))
SETUP = json.loads((ROOT / 'tests' / 'fixtures' / 'setup-fail-jobs.json').read_text(encoding='utf-8'))   # run 41566839140 (3 Nov 2026): apply-2of3 died in actions/checkout, apply-3of3 passed
WORKFLOW = (ROOT / '.github' / 'workflows' / 'rerun-not-acquired.yml').read_text(encoding='utf-8')


def without_real_reds(data):
    """Beta 3 as if activityfailures and Windows interviews had passed: interactions' missing runner is then the only red."""
    data = copy.deepcopy(data)
    for job in data['jobs']:
        if job['name'] in ('E2E · Mac + Linux · activityfailures', 'E2E · Windows · interviews', 'Release · Windows beta'):
            job['conclusion'] = 'success'
    return data


class RerunNotAcquired(unittest.TestCase):
    def test_beta3_names_interactions_but_keeps_the_run_red(self):
        action, missed, reds = decide(BETA3['jobs'], BETA3['annotations'])
        self.assertEqual(missed, ['E2E · Mac + Linux · interactions'])
        self.assertEqual(action, 'keep')
        self.assertEqual(sorted(reds), ['E2E · Mac + Linux · activityfailures', 'E2E · Windows · interviews'])

    def test_only_a_never_started_job_is_rerun(self):
        data = without_real_reds(BETA3)
        self.assertEqual(decide(data['jobs'], data['annotations'])[:2], ('rerun', ['E2E · Mac + Linux · interactions']))

    def test_a_job_cancelled_by_hand_is_not_rerun(self):
        data = without_real_reds(BETA3)
        self.assertEqual(decide(data['jobs'], {})[0], 'keep')   # no "not acquired" annotation: cancelled by a person or a newer run

    def test_a_job_that_ran_is_never_called_never_started(self):
        data = without_real_reds(BETA3)
        job = next(j for j in data['jobs'] if j['name'] == 'E2E · Mac + Linux · interactions')
        job.update(steps=3, runner_name='GitHub Actions 1')
        self.assertEqual(decide(data['jobs'], data['annotations'])[0], 'keep')

    def test_a_job_whose_checkout_failed_before_its_suite_began_is_re_run_not_called_red(self):
        # Why (3 Nov 2026, mac-07): the real jobs of run 41566839140 (listed steps, a runner, "Run actions/checkout@v5" failed, "Run the apply-2of3 suite" skipped) were judged as a red suite.
        self.assertEqual(decide(SETUP['jobs'], {}), ('rerun', ['apply-2of3'], []))

    def test_a_suite_that_began_and_failed_is_a_real_red_even_when_a_setup_step_also_failed(self):
        jobs = copy.deepcopy(SETUP['jobs'])
        suite = next(s for s in jobs[0]['steps'] if s['name'].startswith('Run the apply-2of3 suite'))
        suite['conclusion'] = 'failure'
        self.assertFalse(setup_failed(jobs[0]))
        self.assertEqual(decide(jobs, {})[0], 'keep')

    def test_a_setup_failure_beside_a_real_red_changes_nothing_and_a_job_with_no_suite_step_is_never_setup(self):
        jobs = copy.deepcopy(SETUP['jobs'])
        jobs.append({'id': 7, 'name': 'apply-1of3', 'conclusion': 'failure', 'runner_name': 'r', 'steps': [
            {'number': 1, 'name': 'Set up job', 'conclusion': 'success'}, {'number': 2, 'name': 'Run the apply-1of3 suite (the only try)', 'conclusion': 'failure'}]})
        self.assertEqual(decide(jobs, {}), ('keep', ['apply-2of3'], ['apply-1of3']))
        unit = {'id': 8, 'name': 'unit', 'conclusion': 'failure', 'runner_name': 'r', 'steps': [
            {'number': 1, 'name': 'Set up job', 'conclusion': 'success'}, {'number': 2, 'name': 'Run the unit tests', 'conclusion': 'failure'}]}
        self.assertFalse(setup_failed(unit))   # its failing step is the test run itself

    def test_a_setup_step_stopped_by_a_person_is_not_a_failure(self):
        jobs = copy.deepcopy(SETUP['jobs'])
        for step in jobs[0]['steps']:
            if step['conclusion'] == 'failure': step['conclusion'] = 'cancelled'
        jobs[0]['conclusion'] = 'cancelled'
        self.assertFalse(setup_failed(jobs[0]))

    def test_the_workflow_reruns_once_on_beta_and_e2e_runs(self):
        for name in ('Release · Build, test, beta', 'CI · End-to-end on Mac + Linux', 'CI · End-to-end on Windows'):
            self.assertIn(f"'{name}'", WORKFLOW)
        self.assertIn('run_attempt', WORKFLOW)
        self.assertIn('actions: write', WORKFLOW)


if __name__ == '__main__':
    unittest.main()
