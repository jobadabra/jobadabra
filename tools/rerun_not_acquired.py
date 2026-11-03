"""Re-runs, once, the e2e jobs that never ran their suite: a job that got no runner ("The job was not acquired by Runner of type hosted even after multiple
attempts", ran 0 steps) is GitHub's capacity, not a red suite. Beta 3 (run 40341958250, 26 Oct 2026): interactions waited 29 min for a macOS runner,
was cancelled with no log, and read as "hit the 30-min job limit"; the Free plan runs 5 macOS jobs at once and a beta needs 7.
So is a job whose setup failed before its suite step began (3 Nov 2026, main 4c9233e, run 41566839140: apply-2of3's "Run actions/checkout@v5" timed out
after 5 minutes on a macOS runner; the gate read it as "red, but no failed step is recorded" and stopped the beta). Design: a job is one of ran (its suite step
started: its result counts, red or green), or did not run (no runner, or a step before the suite step failed: infra, re-run once). A job that did not run twice is
said as "not run" and proves nothing, so a safety suite still blocks a beta, by its real name.
A real red stays red: when any job that ran failed, nothing is re-run (the run is red anyway; the next beta tests the never-started suite).
Called by .github/workflows/rerun-not-acquired.yml when a beta or e2e run ends. Tests: tests/tooling/release/test_rerun_not_acquired.py
"""
import json
import os
import re
import subprocess
import sys

NOT_ACQUIRED = re.compile(r'not acquired by Runner', re.I)
SUITE_STEP = re.compile(r'^Run the .+ suite')   # the e2e workflows' one step that plays the suite (e2e.yml, desktop.yml, e2e-windows.yml)
BAD = ('failure', 'cancelled', 'timed_out', 'startup_failure')
DOWNSTREAM = ('Release · ',)   # fail only because an E2E job before them did (needs: test-mac / test-windows); re-run with it


def never_started(job, annotations):
    """GitHub gave this job no runner: it ran no step, and its annotation says so."""
    return (job.get('conclusion') in BAD and not job.get('steps') and not job.get('runner_name')
            and any(NOT_ACQUIRED.search(a.get('message', '')) for a in annotations.get(str(job['id']), [])))


def setup_failed(job):
    """A step before the job's suite step failed, so the suite never began (checkout, runner, cache, install). A job with no suite step (the unit leg) is never this:
    its failing step is the test run itself, a real red. Why (3 Nov 2026): the steps of a job that failed in setup are listed (unlike a never-started one), so the 0-steps test missed it."""
    steps = job.get('steps')
    if job.get('conclusion') not in BAD or not isinstance(steps, list):
        return False
    suite = next((s for s in steps if SUITE_STEP.match(s.get('name', ''))), None)
    if suite is None or suite.get('conclusion') not in ('skipped', None):
        return False   # no suite step, or the suite step ran (success, failure, cancelled): the suite's own result counts
    failed = next((s for s in steps if s.get('conclusion') == 'failure'), None)
    return failed is not None and failed.get('number', 0) < suite.get('number', 0)


def decide(jobs, annotations):
    """(action, did-not-run job names, real red job names): 'rerun' when every red of the run is a job that did not run (never started, or its setup failed) or downstream of one."""
    missed = [j for j in jobs if never_started(j, annotations) or setup_failed(j)]
    ids = {j['id'] for j in missed}
    reds = [j for j in jobs if j.get('conclusion') in BAD and j['id'] not in ids and not j.get('name', '').startswith(DOWNSTREAM)]
    action = 'rerun' if missed and not reds else 'keep'
    return action, [j['name'] for j in missed], [j['name'] for j in reds]


def gh_json(*args):
    out = subprocess.run(['gh', *args], capture_output=True, text=True, check=True).stdout
    return [json.loads(line) for line in out.splitlines() if line.strip()]


def main(argv):
    run_id, repo = argv[0], os.environ.get('GITHUB_REPOSITORY') or 'jobadabra/jobadabra'   # sparse checkout of this one file: no src/repos.py; tests/guards/rules/test_repos_owner.py pins it
    attempt = int(os.environ.get('RUN_ATTEMPT', '1'))
    ask = '--would-rerun' in argv   # tools/red-main-gate.sh asks, exit 0 = the workflow is about to re-run this run (it waits for that instead of judging attempt 1)
    if attempt > 1:
        print(f'run {run_id} is attempt {attempt}: jobs that did not run are re-run once only')
        return 1 if ask else 0
    jobs = gh_json('api', '--paginate', f'repos/{repo}/actions/runs/{run_id}/jobs?per_page=100',
                   '--jq', '.jobs[] | {id, name, conclusion, runner_name, steps: [(.steps // [])[] | {number, name, conclusion}]}')
    annotations = {}
    for job in jobs:
        if job.get('conclusion') in BAD and not job.get('steps'):
            annotations[str(job['id'])] = gh_json('api', f"repos/{repo}/check-runs/{job['id']}/annotations", '--jq', '.[] | {message}')
    action, missed, reds = decide(jobs, annotations)
    if not missed:
        print(f'run {run_id}: every job ran its suite or failed in it')
        return 1 if ask else 0
    print(f"run {run_id}: did not run: {', '.join(missed)} (infra: no runner, or its setup failed before the suite began; not a red suite)")
    if action == 'keep':
        print(f"not re-run: the run is red anyway on {', '.join(reds)} (a real red stays red; the next run tests them)")
        return 1 if ask else 0
    if ask:
        print('would re-run them once')
        return 0
    if '--dry-run' in argv:
        print('dry run: would re-run them once')
        return 0
    subprocess.run(['gh', 'run', 'rerun', run_id, '--failed', '-R', repo], check=True)   # the never-started jobs and the Release jobs that waited on them
    print(f're-run once: {", ".join(missed)}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
