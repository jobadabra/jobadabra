# Compare beta AI artifacts with main's nightly Wilson bands before release approval.
# Job: run tolerant suites as rates
# Invariants: tolerant AI rates and missing credit only report health; backbone values still gate.
import argparse
import json
import re
import subprocess
import time
from pathlib import Path

try:
    from . import pr_ai_number as ai
except ImportError:  # Direct workflow invocation: python3 tools/beta_rate_gate.py.
    import pr_ai_number as ai

LANES = Path(__file__).resolve().parents[1] / 'desktop/e2e/lanes.json'
MAX_NIGHTS_INSPECTED, MAX_PAGES = 21, 2   # three weeks of nights; two pages of 100 runs hold them with manual runs between
SETTLE_LIMIT, SETTLE_POLL = 480, 20   # seconds; a hang guard inside the release step's 10 minutes


def gh(*args, binary=False):
    """The injectable GitHub transport, also used for binary artifact downloads."""
    # Why (31 Oct 2026, a8; beta 41226261602): the jobs read died with "exit 1" when the installation budget was spent; a limit now says so, with its reset time.
    # Imported here: the PR verdict loads this file alone as a companion (tests/tooling/release/test_beta_rate_gate.py), where its sibling may be missing: then gh's plain error stands.
    try:
        try:
            from .github_limit import run_gh
        except ImportError:
            from github_limit import run_gh
    except ImportError:
        run_gh = None
    output = run_gh(*args, binary=True) if run_gh else subprocess.run(['gh', *args], check=True, capture_output=True).stdout
    return output if binary else output.decode('utf-8')


def jobs_of(repo, rid, github):
    """Read every job in the current attempt; pagination must not hide a red backbone job."""
    pages = json.loads(github('api', '--paginate', '--slurp', f'repos/{repo}/actions/runs/{rid}/jobs?per_page=100'))
    return [job for page in pages for job in page['jobs']]


def conclusion_of(job):
    """A job's result, or None while GitHub has not reported one: a job whose every step passed has passed, anything else unreported stays unknown, never green.
    Why (mac-32, beta 41860707305, 4 Nov 2026): in a GitHub incident a finished job kept conclusion null for minutes, and "not success" refused 0.9.8 with wizard green.
    """
    if job.get('conclusion'):
        return job['conclusion']
    steps = job.get('steps') or []
    return 'success' if steps and all(step.get('conclusion') in ('success', 'skipped') for step in steps) else None


def blocking_jobs(jobs, registry, platform):
    """Ignore all tolerant and suspended reds; other unfinished or failed lane jobs block."""
    prefix = 'E2E · Mac + Linux · ' if platform == 'mac' else 'E2E · Windows · '
    lane = [job for job in jobs if job.get('name', '').startswith(prefix)]
    if not lane:
        return ['lane jobs unavailable']
    blocked = []
    for job in lane:
        suite = re.sub(r'-\d+of\d+$', '', job['name'][len(prefix):])
        entry = registry.get(suite, {})
        exempt = entry.get('lane') in ('tolerant', 'suspended')
        if not exempt and conclusion_of(job) != 'success':
            blocked.append(suite)
    return blocked


# Why (30 Oct 2026, owner): Windows runs few suites of its own (the rest were duplicates of Mac + Linux), so each release reads both lanes (--e2e-only).
LANE_NAMES = {'mac': 'Mac + Linux', 'windows': 'Windows'}


def blocking_lanes(jobs, registry):
    """Name each blocking suite with its lane; a red on either lane holds both betas."""
    return [f'{LANE_NAMES[lane]}: {suite}' for lane in LANE_NAMES for suite in blocking_jobs(jobs, registry, lane)]


# Why (1 Nov 2026, owner: "let's go this way"): the desktop unit tests are a leg of each lane's Test matrix, a job named whole ("Unit tests · Mac"), not a step of the Build box.
UNIT_JOBS = ('Unit tests · Mac', 'Unit tests · Windows')


def gate_jobs(jobs, registry):
    """(name to show, job) of every job that decides a release; a missing unit leg comes with an empty job."""
    found = [(name, next((job for job in jobs if job.get('name') == name), {})) for name in UNIT_JOBS]
    for label in LANE_NAMES.values():
        prefix = f'E2E · {label} · '
        for job in jobs:
            if job.get('name', '').startswith(prefix):
                suite = re.sub(r'-\d+of\d+$', '', job['name'][len(prefix):])
                if registry.get(suite, {}).get('lane') not in ('tolerant', 'suspended'):
                    found.append((f'{label}: {suite}', job))
    return found


def unreported(jobs, registry):
    """The deciding jobs GitHub has no result for yet: not a verdict, red or green."""
    return sorted({name for name, job in gate_jobs(jobs, registry) if job and job.get('status', 'completed') != 'completed' and conclusion_of(job) is None})


def settled_jobs(repo, rid, registry, github=gh, sleep=time.sleep, clock=time.monotonic):
    """Read the run's jobs until each deciding job has a result, or SETTLE_LIMIT passes (backbone_check then refuses, naming them)."""
    end = clock() + SETTLE_LIMIT
    while True:
        jobs = jobs_of(repo, rid, github)
        late = unreported(jobs, registry)
        if not late or clock() >= end:
            return jobs
        print('Waiting for GitHub to report: ' + ', '.join(late), flush=True)
        sleep(SETTLE_POLL)


def backbone_check(jobs, registry):
    """Hold either beta on any backbone job that is not green; a suite's single try is the verdict (spec rule L, 31 Oct 2026).

    The "Unit tests · <lane>" job is read here too. Why (31 Oct 2026, owner, "D: unit red still runs e2e"): a red unit test does not stop the e2e (beta 41215677698 lost 45 minutes
    of e2e to 1 flaky unit test), so the release is where one unit red still refuses both platforms. Anything but conclusion 'success' is red, and so is a missing job: a unit leg that was
    cancelled or skipped never passed (Gitar on #2858), and the e2e jobs do not show it.
    """
    late = unreported(jobs, registry)
    red = {name for name, job in gate_jobs(jobs, registry) if conclusion_of(job) != 'success'} - set(late)
    red |= {f'{label}: lane jobs unavailable' for label in LANE_NAMES.values() if not any(job.get('name', '').startswith(f'E2E · {label} · ') for job in jobs)}
    lines = ['Not released: red: ' + ', '.join(sorted(red))] if red else []
    if late:
        lines.append(f'Not released: GitHub has not reported, after {SETTLE_LIMIT // 60} min: ' + ', '.join(late))
    return int(bool(red or late)), lines


def main_nights(repo, suite, github, platform='mac', current_run='', *, first_only=False):
    """Read seven valid desktop nights, or the first eligible night's possibly unavailable rates."""
    selected, page, inspected = [], 1, 0
    prefix = 'E2E · Windows · ' if platform == 'windows' else 'E2E · Mac + Linux · '
    artifact = f"e2e-artifacts-{'windows-' if platform == 'windows' else ''}{suite}"
    # Why (29 Oct 2026, a8, #2504): a new tolerant suite has no nights yet; three weeks of nights bound the scan instead of all of desktop.yml's history.
    while len(selected) < 7 and page <= MAX_PAGES and inspected < MAX_NIGHTS_INSPECTED:
        runs = json.loads(github('api', f'repos/{repo}/actions/workflows/desktop.yml/runs?branch=main&status=completed&per_page=100&page={page}'))['workflow_runs']
        for run in sorted(runs, key=lambda r: r['id'], reverse=True):
            scheduled = (run.get('event'), run.get('display_title')) in (
                ('schedule', 'E2E check · nightly backup'), ('workflow_dispatch', 'Nightly beta'))
            if str(run['id']) == str(current_run) or run.get('head_branch') != 'main' or not scheduled or run.get('status') != 'completed':
                continue
            if inspected == MAX_NIGHTS_INSPECTED:
                break
            inspected += 1
            jobs = [j for j in jobs_of(repo, run['id'], github) if re.sub(r'-\d+of\d+$', '', j.get('name', '')) == prefix + suite]
            if jobs and all(j.get('status') == 'completed' for j in jobs):
                _, rates = ai.artifact_rates(repo, run['id'], github, artifact)
                # Why (29 Oct 2026, qu): the PR number must expose an unreadable newest night instead of silently using an older one.
                if first_only:
                    return [(run['id'], rates)]
                if rates is not None:
                    selected.append((run['id'], rates))
                    if len(selected) == 7:
                        break
        if len(runs) < 100:
            break
        page += 1
    return selected


def check(repo, rid, registry, github=gh, platform='mac'):
    """Return exit status and reviewable rate/health lines for every tolerant AI suite."""
    lines = []
    for suite, entry in registry.items():
        if entry.get('lane') != 'tolerant' or entry.get('input') != 'ai':
            continue
        try:
            prefix = 'e2e-artifacts-windows-' if platform == 'windows' else 'e2e-artifacts-'
            _, current = ai.artifact_rates(repo, rid, github, f'{prefix}{suite}')
            if current is None:
                lines.append(f'{suite}: no band yet: not blocking (this run artifact unavailable)')
                continue
            nights = main_nights(repo, suite, github, platform=platform, current_run=rid)
            ids = [run for run, _ in nights]
            baseline = ai.band([rates for _, rates in nights])
            used = ','.join(str(run) for run in ids) or 'none'
            if not baseline:
                lines.append(f'{suite}: no band yet: not blocking (need 3 main nights and readable artifacts; main runs {used})')
                continue
            for metric, result in ai.verdict(current, baseline).items():
                if result is None:
                    lines.append(f'{suite}: {metric} unavailable; no band yet: not blocking; main runs {used}')
                    continue
                before = baseline[metric]
                raw = current[metric]
                _, numerator, denominator, label = next(m for m in ai.RATE_METRICS if m[0] == metric)
                note = ' (unflagged quality rate)' if metric == 'flags' else ''
                outcome = 'below band (report only)' if result['blocked'] else 'within band'
                lines.append(f"{suite}: {label} {raw[numerator]}/{raw[denominator]}{note}, quality {result['rate']:.2%} "
                             f"(95% {result['lower']:.2%}–{result['upper']:.2%}); main band "
                             f"{before['lower']:.2%}–{before['upper']:.2%}; {outcome}; main runs {used}")
        except (OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
            lines.append(f'{suite}: no band yet: not blocking (GitHub/artifact unavailable: {type(error).__name__})')
    # Why (31 Oct 2026, owner): "Any AI calls/suites should be green. They should not stop a beta."
    return 0, lines


def main():
    """Print rate evidence as health only; backbone failures use the separate --e2e-only gate."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', required=True)
    parser.add_argument('--run', required=True)
    parser.add_argument('--e2e-only', action='store_true', help='block on any red gate suite of either lane')
    parser.add_argument('--platform', choices=('mac', 'windows'), default='mac')
    args = parser.parse_args()
    try:
        registry = json.loads(LANES.read_text())['suites']
    except (OSError, ValueError, KeyError):
        print('::warning::AI rate registry unavailable; report only' if not args.e2e_only else '::error::Backbone registry unavailable')
        return int(args.e2e_only)
    if args.e2e_only:
        status, lines = backbone_check(settled_jobs(args.repo, args.run, registry), registry)
        for line in lines:
            print('::error::' + line)
        if status:
            return status
        print('Tolerant/suspended results do not block; AI rates are report-only.')
        return 0
    status, lines = check(args.repo, args.run, registry, platform=args.platform)
    for line in lines:
        print(('::warning::' if 'below band (report only)' in line else '::notice::') + line)
    return status


if __name__ == '__main__':
    raise SystemExit(main())
