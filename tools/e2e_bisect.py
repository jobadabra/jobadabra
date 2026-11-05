#!/usr/bin/env python3
# Bisect scheduled main reds; after-merge failures belong to the backbone revert job.
"""A red e2e suite on main gets an owner (gate G2b, 26 Oct 2026): bisect it to the PR that broke it, tell that PR, and keep one entry per suite in the red-main list
(the Red main tab of /admin/testing/red-main; D1 store `red-main`, PUT with SELFHEAL_PUBLISH_KEY, read by anyone).

  after-run <run id>        e2e.yml's alert job, after a scheduled main run: drops the entry of each suite this run passed, and starts
                            e2e-bisect.yml for ONE red suite with no entry whose cause is not the test environment (the next check starts the next)
  after-merge <run id>      e2e.yml's alert job, after the steps run after a merge (main-steps.yml): leaves evidence to backbone_red.py
                            in .github/workflows/e2e-revert.yml's completed-run job; no fix-forward comment and no issue closed
  bisect <suite> <bad sha>  e2e-bisect.yml: finds the last main check where <suite> was green, runs <suite> on the commits in between (e2e.yml with
                            target_ref + bisect: titled "Bisect <suite> <sha>", never counted as a main check or filed by the Finder), then names the
                            first red commit's PR in the suite's entry (pr.number, pr.branch) and on the PR itself. The session that
                            shipped branch b reads it at its next prompt (tools/pr-red-check.sh).
Why: 25 Oct 2026, main went red at 21:47 on cardstates, interactions and settings; the Finder filed an issue and no session was woken.
Why (5 Nov 2026, owner: "turn this pinned issues into dashboards/tabs/pages in Admin … and will remove them from GH issue list"): the `red-main` issues are the Red main tab now.
Tests: tests/tooling/ci/test_e2e_bisect.py
Job: run the backbone
"""
import json
import os
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from tools.e2e_causes import ENVIRONMENT_CAUSES, classify  # noqa: E402
from tools.main_e2e_state import NOT_SUITE, counts_green, lane_suites, suite_of  # noqa: E402
from src.repos import PUBLIC_REPO  # noqa: E402

REPO = os.environ.get('GITHUB_REPOSITORY', PUBLIC_REPO)
SITE = os.environ.get('CI_STATE_URL', 'https://www.jobadabra.top')
STATE_URL = f'{SITE}/ci-state/red-main'
PAGE = f'{SITE}/admin/testing/red-main'
BISECT_STALE_S = 6 * 3600   # a bisecting entry older than this lost its workflow: the next check starts it again
MAX_STEPS = 8          # 2^8 = 256 commits between green and red
POLL = int(os.environ.get('E2E_BISECT_POLL', '30'))
STEP_WAIT = int(os.environ.get('E2E_BISECT_STEP_S', '3600'))


def bisect(commits, test):
    """commits: oldest → newest; commits[0] was green, commits[-1] is red. test(sha) → 'success' | 'failure' | None (could not tell).
    Returns (first red sha or None, (lo, hi) the last known green/red indices, tested [(sha, result)])."""
    lo, hi, tested = 0, len(commits) - 1, []
    while hi - lo > 1 and len(tested) < MAX_STEPS:
        mid = (lo + hi) // 2
        result = test(commits[mid])
        tested.append((commits[mid], result))
        if result == 'success':
            lo = mid
        elif result == 'failure':
            hi = mid
        else:
            return None, (lo, hi), tested
    return (commits[hi] if hi - lo == 1 else None), (lo, hi), tested


def now_iso():
    """The current UTC time as the list stores it (2026-11-05T12:00:00Z)."""
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def load():
    """The stored red list. Raises when the site cannot be read, so a failed read never turns into a write that erases the list."""
    request = urllib.request.Request(STATE_URL, headers={'User-Agent': 'jobadabra-ci'})
    with urllib.request.urlopen(request, timeout=30) as response:
        data = json.loads(response.read() or 'null')
    return [red for red in ((data or {}).get('reds') or []) if isinstance(red, dict) and red.get('suite')]


def save(reds):
    """PUTs the whole red list to the site with SELFHEAL_PUBLISH_KEY; raises (nothing is written) when the key is missing or the site refuses."""
    key = os.environ.get('SELFHEAL_PUBLISH_KEY')
    if not key:
        raise RuntimeError('SELFHEAL_PUBLISH_KEY is not set: the red-main list was not written')
    request = urllib.request.Request(STATE_URL, data=json.dumps({'at': now_iso(), 'reds': reds}).encode(), method='PUT',
                                     headers={'Authorization': f'Bearer {key}', 'Content-Type': 'application/json', 'User-Agent': 'jobadabra-ci'})
    urllib.request.urlopen(request, timeout=30).read()


def update(change):
    """Read, change and write the list in one go (the window for a lost update is the milliseconds between the read and the write)."""
    reds = change(load())
    save(reds)
    return reds


def stale(red):
    """A bisecting entry whose workflow never reported back."""
    if red.get('status') != 'bisecting':
        return False
    try:
        return time.time() - datetime.strptime(red['bisectAt'], '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc).timestamp() > BISECT_STALE_S
    except (KeyError, ValueError):
        return True


def red_record(suite, bad, run_url, since_at=None, found=None, pr=None, good=None, tested=(), candidates=(), status='bisecting', bisect_at=None):
    """One entry of the Red main tab: the suite, since which main commit, and what the bisect found (the page and tools/pr-red-check.sh read pr.number and pr.branch)."""
    return {'suite': suite, 'status': status, 'since': bad, 'sinceAt': since_at or now_iso(), 'run': run_url, 'pr': pr, 'found': found, 'good': good,
            'tested': [[sha, result or 'unknown'] for sha, result in tested], 'candidates': list(candidates), 'bisectAt': bisect_at or now_iso()}


def gh(*args, check=True):
    out = subprocess.run(['gh', *args], capture_output=True, text=True)
    if check and out.returncode:
        raise RuntimeError(f"gh {' '.join(args[:3])}: {out.stderr.strip()[:200]}")
    return out.stdout.strip()


def gh_json(*args):
    return json.loads(gh(*args) or 'null')


def jobs_of(run_id):
    return gh_json('api', f'repos/{REPO}/actions/runs/{run_id}/jobs?per_page=100', '--jq', '.jobs') or []


def log_of(job_id):
    return gh('run', 'view', '--job', str(job_id), '-R', REPO, '--log-failed', check=False)


def suite_results(jobs):
    out = {}
    for job in jobs:
        if job.get('name') in NOT_SUITE or job.get('conclusion') not in ('success', 'failure'):
            continue
        suite = suite_of(job['name'])
        out[suite] = 'failure' if job['conclusion'] == 'failure' or out.get(suite) == 'failure' else 'success'
    return out


def red_cause(jobs, suite):
    """The cause of `suite`'s red in this run, from its first failed job's log (tools/e2e_causes.py)."""
    job = next((j for j in jobs if j.get('name') not in NOT_SUITE and suite_of(j['name']) == suite and j.get('conclusion') == 'failure'), None)
    return classify(log_of(job['id']) if job and job.get('id') else '')[0]


def after_run(run_id):
    """Drops the entries of suites green again; starts ONE bisect, for the first new red whose cause is not the environment. The next main check starts
    the next. Why: 26 Oct 2026, the dead Claude key turned 10 suites red, 10 bisects started at once (one concurrency group per suite), each running
    the e2e suite on main's commits, and the job queue held PR checks for 20+ minutes; a key or service red has no breaking PR to find."""
    run = gh_json('api', f'repos/{REPO}/actions/runs/{run_id}')
    jobs = jobs_of(run_id)
    results = suite_results(jobs)
    reds = {red['suite']: red for red in load()}
    excluded = lane_suites()
    drop, added, to_start = [], None, None
    for suite, result in sorted(results.items()):
        red = reds.get(suite)
        if result == 'success' and red:
            drop.append(suite)
            print(f'cleared: {suite} green again')
        elif result == 'failure' and (not red or stale(red)) and suite not in excluded:
            if to_start:
                print(f'{suite}: red, bisected after `{to_start}` (one bisect at a time: the next main check starts it)')
                continue
            cause = red_cause(jobs, suite)
            if cause in ENVIRONMENT_CAUSES:
                print(f'{suite}: red on the test environment ({cause}): not bisected, no PR broke it')
                if red:   # a bisect that never reported, and the red is no PR's: the entry goes
                    drop.append(suite)
                continue
            # A restarted bisect keeps the time the suite first went red.
            added = red_record(suite, red['since'] if red else run['head_sha'], run['html_url'], since_at=(red or {}).get('sinceAt') or run.get('created_at'))
            to_start = suite
            print(f'bisect starting: {suite} red at {run["head_sha"][:7]} ({cause})')
    if drop or added:
        # The entry is written BEFORE the workflow is dispatched: a failed write must not leave a bisect running that no entry knows about (the next check would start a second one).
        update(lambda current: [red for red in current if red['suite'] not in drop and not (added and red['suite'] == added['suite'])] + ([added] if added else []))
    if to_start:
        gh('workflow', 'run', 'e2e-bisect.yml', '-R', REPO, '--ref', 'main', '-f', f'suite={to_start}', '-f', f"bad={run['head_sha']}", '-f', f"run_url={run['html_url']}")
        print(f'bisect started: {to_start}')


def after_merge(run_id):
    """After-merge reds belong to .github/workflows/e2e-revert.yml's completed-run job, never a fix-forward request."""
    # Why (28 Oct 2026, owner): two backbone reds revert the merge; never ask its session for a fix-forward.
    print(f'after-merge run={run_id}: completed-run evidence goes to backbone_red.py in .github/workflows/e2e-revert.yml; no fix-forward request')


def last_green(suite, bad, is_ancestor):
    runs = gh_json('api', f'repos/{REPO}/actions/workflows/e2e.yml/runs?branch=main&status=completed&per_page=100', '--jq', '.workflow_runs') or []
    for run in runs:
        if not counts_green(run) or run['head_sha'] == bad or not is_ancestor(run['head_sha'], bad):
            continue
        if suite_results(jobs_of(run['id'])).get(suite) == 'success':
            return run['head_sha']
    return None


def run_suite_at(suite, sha):
    since = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() - 5))
    gh('workflow', 'run', 'e2e.yml', '-R', REPO, '--ref', 'main', '-f', f'suite={suite}', '-f', f'target_ref={sha}', '-f', 'fixed=true', '-f', 'bisect=true')
    title, start, rid = f'Bisect {suite} {sha}', time.time(), None
    while time.time() - start < STEP_WAIT:
        if rid is None:
            found = gh('api', f'repos/{REPO}/actions/workflows/e2e.yml/runs?event=workflow_dispatch&branch=main&per_page=20', '--jq',
                       f'.workflow_runs[] | select(.created_at >= "{since}" and .display_title == "{title}") | .id', check=False)
            rid = (found.split() or [None])[-1]
        if rid:
            state = gh('api', f'repos/{REPO}/actions/runs/{rid}', '--jq', '"\\(.status) \\(.conclusion // "-")"', check=False)
            if state.startswith('completed '):
                conclusion = state.split(' ', 1)[1]
                print(f'  {sha[:7]}: {conclusion} https://github.com/{REPO}/actions/runs/{rid}')
                return suite_results(jobs_of(rid)).get(suite) if conclusion in ('success', 'failure') else None
        time.sleep(POLL)
    return None


def pr_of(sha):
    pulls = gh_json('api', f'repos/{REPO}/commits/{sha}/pulls') or []
    merged = [p for p in pulls if p.get('merged_at')] or pulls
    return {'number': merged[0]['number'], 'branch': merged[0]['head']['ref'], 'title': merged[0]['title']} if merged else None


def git(*args):
    return subprocess.run(['git', *args], capture_output=True, text=True)


def report(red):
    """Stores the bisect's result in the suite's entry and tells the breaking PR."""
    def replace(current):
        before = next((other for other in current if other['suite'] == red['suite']), None)
        if before:   # the red has lasted since the first check that saw it
            red['sinceAt'], red['since'] = before.get('sinceAt', red['sinceAt']), before.get('since', red['since'])
        return [other for other in current if other['suite'] != red['suite']] + [red]
    update(replace)
    pr = red.get('pr')
    if pr:
        gh('pr', 'comment', str(pr['number']), '-R', REPO, '--body',
           f"🔴 Main's `{red['suite']}` e2e suite went red with this PR (bisect on the Red main tab: {PAGE}). Fix it now: skill fix-failing-e2e, push the fix through tools/ship.sh.")
    print(f"reported on {PAGE}: {red['suite']} {red['status']}")


def run_bisect(suite, bad, run_url):
    if suite_of(suite) in lane_suites():
        print(f"{suite}: non-backbone result; no red-main entry or bisect")
        return
    good = last_green(suite, bad, lambda a, b: git('merge-base', '--is-ancestor', a, b).returncode == 0)
    if not good:
        report(red_record(suite, bad, run_url, status='not-found', candidates=[bad]))   # no green main check of this suite in the last 100 runs: nothing to bisect from
        return
    commits = [good] + [c for c in git('rev-list', '--first-parent', '--reverse', f'{good}..{bad}').stdout.split() if c]
    print(f'{suite}: green at {good[:7]}, red at {bad[:7]}, {len(commits) - 1} commit(s) in range')
    found, (lo, hi), tested = bisect(commits, lambda sha: run_suite_at(suite, sha))
    pr = pr_of(found) if found else None
    report(red_record(suite, bad, run_url, found=found, pr=pr, good=good, tested=tested, candidates=commits[lo + 1:hi + 1], status='found' if found else 'not-found'))


def main(argv):
    if argv[:1] == ['after-run'] and len(argv) == 2:
        after_run(argv[1])
    elif argv[:1] == ['after-merge'] and len(argv) == 2:
        after_merge(argv[1])
    elif argv[:1] == ['bisect'] and len(argv) >= 3:
        run_bisect(argv[1], argv[2], argv[3] if len(argv) > 3 else '')
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
