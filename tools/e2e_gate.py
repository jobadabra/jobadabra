"""The end-to-end gate of tools/release-stable.sh: may this build be promoted, judging by the e2e runs GitHub lists (newest first)?

    gh run list ... --json conclusion,headSha,createdAt | python3 tools/e2e_gate.py <commit-sha> commit|latest
    -> green | red <sha7> | stale | none
    gh run list --workflow build.yml --commit <sha> --status completed --json conclusion,databaseId | python3 tools/e2e_gate.py ci <repo>
    -> green | red | none

`commit`: a human promotion needs a run of THIS build's commit. `latest`: the daily canary auto-promote cannot start a run, so the newest run stands in.
A cancelled or skipped run says nothing about the product, so it is no verdict. A green run older than two days no longer vouches for anything.
"""
import importlib.util
import json
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Why (3 Nov 2026, owner: "Both (Recommended)"): every gh call of the release path goes through tools/gh_retry.py, one retry on GitHub's 500/502/503/504 only.
_spec = importlib.util.spec_from_file_location('gh_retry', Path(__file__).resolve().parent / 'gh_retry.py')
gh_retry = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gh_retry)

MAX_AGE = timedelta(days=2)
# Jobs of main's build.yml that test our own tooling, not the app a user runs (the job name starts with the called workflow's key): a red one does not stop a beta.
# Why (3 Nov 2026, owner, "Only app tests block (Recommended)": "tooling/harness tests… There will be no impact for the users, it will be easy to fix/ack"): the Linux job also holds the python and
# desktop tooling tests, which cannot be told apart until the tests/tooling and desktop/test/tooling move (planned, owner 3 Nov 2026); then its steps join this list.
NON_BLOCKING_JOBS = ('harness / ',)


def verdict(runs, sha, mode, now=None):
    now = now or datetime.now(timezone.utc)
    decided = [run for run in runs if run.get('conclusion') in ('success', 'failure')]
    own = [run for run in decided if run.get('headSha') == sha]
    run = own[0] if own else (decided[0] if mode == 'latest' and decided else None)
    if run is None:
        return 'none'
    if run['conclusion'] != 'success':
        return f"red {run['headSha'][:7]}"
    if now - datetime.fromisoformat(run['createdAt'].replace('Z', '+00:00')) > MAX_AGE:
        return 'stale'
    return 'green'


def beta_verdict(notes, sha):
    """The release notes of a beta that BOTH platforms approved, each line naming this build's commit: the proof a manual promotion accepts (owner, 12 Oct 2026: the beta-approved
    artifact goes to stable as it is, same tag, same version, same build; no fresh run). One platform alone, or an approval of another commit, is none."""
    short = (sha or '')[:7]
    lines = [line.strip() for line in (notes or '').splitlines()]
    mac = any(line.startswith('Beta-approved:') and f'commit {short}' in line for line in lines)
    windows = any(line.startswith('Beta-approved (Windows):') and f'commit {short}' in line for line in lines)
    return 'green' if short and mac and windows else 'none'


def tooling_only_red(failed):
    """True when `failed` (the names of a run's failed jobs, None when they could not be read) are all tooling jobs: an unread or empty list is never a pass."""
    return bool(failed) and all(name.startswith(NON_BLOCKING_JOBS) for name in failed)


def failed_jobs(repo, run_id):
    """The names of the jobs of a run that did not end well (failed, cancelled, timed out, never started), or None when GitHub cannot say.
    Why (Gitar on #3053): an app job that timed out is reported cancelled, and listing only "failure" let it hide behind a red harness job."""
    out = gh_retry.run(['api', '--paginate', f'repos/{repo}/actions/runs/{run_id}/jobs?per_page=100', '--jq', '.jobs[] | select(.conclusion != "success" and .conclusion != "skipped" and .conclusion != "neutral") | .name'])
    return out.stdout.splitlines() if out.returncode == 0 else None


def ci_verdict(runs, repo=None):
    """build.yml (the unit suites) on the build's commit: green when every run of it succeeded and there is one. A run red only in tooling jobs counts as succeeded (NON_BLOCKING_JOBS), said on stderr."""
    if not runs:
        return 'none'
    def app_red(run):
        if run.get('conclusion') in ('success', 'cancelled'):
            return False
        failed = failed_jobs(repo, run['databaseId']) if repo and run.get('conclusion') == 'failure' and run.get('databaseId') else None
        if tooling_only_red(failed):
            print(f"build.yml run {run['databaseId']}: red only in tooling tests ({', '.join(failed)}): not blocking", file=sys.stderr)
            return False
        return True
    if any(app_red(run) for run in runs):
        return 'red'
    runs = [{**run, 'conclusion': 'success' if run.get('conclusion') == 'failure' else run.get('conclusion')} for run in runs]
    return 'green' if all(run.get('conclusion') == 'success' for run in runs) else 'superseded'   # cancelled only: a newer push to main replaced it (15 Oct 2026)


def run_verdict(repo, ids):
    """The verdict of build.yml runs read one by one by id: 'pending' while any is not completed (or cannot be read), else ci_verdict of their conclusions.
    Why (1 Nov 2026, a8; mac-07 on beta 9): a run the wait saw open has an id; its verdict comes from reading that run, never from a list that can lag behind it."""
    conclusions = []
    for run_id in ids:
        out = gh_retry.run(['api', f'repos/{repo}/actions/runs/{run_id}', '--jq', '.status + " " + (.conclusion // "")'])
        status, _, conclusion = out.stdout.strip().partition(' ')
        if out.returncode != 0 or status != 'completed':
            return 'pending'
        conclusions.append({'conclusion': conclusion, 'databaseId': run_id})
    return ci_verdict(conclusions, repo)


def _newer_main_build(repo, sha, query, jq):
    """Return the first matching main build SHA ahead of sha, or '' when gh yields no match."""
    def gh(*args):
        return gh_retry.run(['api', *args]).stdout.strip()
    for head in gh(f'repos/{repo}/actions/workflows/build.yml/runs?branch=main&{query}', '--jq', jq).split():
        if head != sha and gh(f'repos/{repo}/compare/{sha}...{head}', '--jq', '.status') == 'ahead':
            return head
    return ''


def newer_green(repo, sha):
    """The sha of a NEWER commit of main whose build.yml run succeeded, or '' (a push to main cancels the older commit's run: the newest commit's run decides)."""
    return _newer_main_build(repo, sha, 'status=success&per_page=30', '.workflow_runs[].head_sha')


def newer_running(repo, sha):
    """Return the newest pending main build's SHA only when its commit is ahead of sha, or ''."""
    # Why (28 Oct 2026, owner): queued or running newer builds still decide a cancelled beta's verdict.
    return _newer_main_build(repo, sha, 'per_page=30', '.workflow_runs[] | select(.status != "completed") | .head_sha')


def latest_beta(repo, gh=None):
    """The tag of the newest pre-release newer than stable that BOTH platforms approved on its own commit (beta_verdict green), or ''.
    Why (2 Nov 2026, owner: "we just promote the latest beta"): the by-hand promotion in "Release · Promote to stable" takes this tag, the same proof
    tools/release-stable.sh accepts; a newer build no platform approved is passed over, and the list stops at stable (nothing older is newer than it)."""
    if gh is None:
        def gh(*args):
            done = gh_retry.run(list(args))
            if done.returncode:
                raise subprocess.CalledProcessError(done.returncode, ['gh', *args], done.stdout, done.stderr)
            return done.stdout
    releases = json.loads(gh('release', 'list', '-R', repo, '-L', '30', '--json', 'tagName,isPrerelease,isDraft') or '[]')
    for release in releases:
        if release.get('isDraft'):
            continue
        if not release.get('isPrerelease'):
            return ''
        tag = release['tagName']
        notes = gh('release', 'view', tag, '-R', repo, '--json', 'body', '-q', '.body')
        if beta_verdict(notes, gh('api', f'repos/{repo}/commits/{tag}', '-q', '.sha').strip()) == 'green':
            return tag
    return ''


if __name__ == '__main__':
    if sys.argv[1] == 'latest-beta':   # python3 tools/e2e_gate.py latest-beta <repo>: the newest beta both platforms approved, or nothing
        print(latest_beta(sys.argv[2]))
    elif sys.argv[1] == 'beta':   # gh release view <tag> --json body -q .body | python3 tools/e2e_gate.py beta <commit-sha>
        print(beta_verdict(sys.stdin.read(), sys.argv[2] if len(sys.argv) > 2 else ''))
    elif sys.argv[1] == 'ci':   # gh run list --workflow build.yml --commit <sha> --status completed --json conclusion,databaseId | python3 tools/e2e_gate.py ci [<repo>]
        print(ci_verdict(json.load(sys.stdin), sys.argv[2] if len(sys.argv) > 2 else None))
    elif sys.argv[1] == 'run-verdict':   # python3 tools/e2e_gate.py run-verdict <repo> <run id>...: pending, or green/red/superseded/none
        print(run_verdict(sys.argv[2], sys.argv[3:]))
    elif sys.argv[1] == 'newer-green':   # python3 tools/e2e_gate.py newer-green <repo> <sha>: prints a newer green commit of main, or nothing
        print(newer_green(sys.argv[2], sys.argv[3]))
    elif sys.argv[1] == 'newer-running':   # prints the newest pending build commit ahead of the beta on main, or nothing
        print(newer_running(sys.argv[2], sys.argv[3]))
    else:
        print(verdict(json.load(sys.stdin), sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else 'commit'))
