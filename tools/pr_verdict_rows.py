"""One check row per by-hand-started run the PR's verdict counts, and the summary table the verdict's own run shows (companion of tools/pr-verdict.py).
Why (14 Nov 2026, owner, on #4177: "when I click on 'All checks passed' ... It doesn't show the e2e running. It shows just green"): a run started with
workflow_dispatch (the PR's e2e, started by pr-e2e-steps.yml) is not listed under the PR's checks, and a green verdict linked only its own page.
Design: states / one owner / verdicts.
- Owner: pr-verdict.py alone writes (it already reads the head's counted runs); rows are a pure function of (counted runs, the verdict's state), so a push gives the new head
  its rows from the runs started on it; nothing is carried by hand between heads.
- States of a row: the run's own (queued, in_progress, completed with its conclusion); a run the verdict reads as grey (red, yet the verdict is success) shows neutral.
- Never required: the one required check stays "All checks passed". A row is written only on the PR's current open head, from the base repository (a fork PR gets nothing).
"""
import re

PREFIX = 'pr-verdict-row:'   # external_id = PREFIX + run id: the row of that run, found again on the next write
QUEUED = {'queued', 'requested', 'waiting', 'pending'}
CONCLUSIONS = {'success': 'success', 'failure': 'failure', 'timed_out': 'failure', 'startup_failure': 'failure', 'cancelled': 'cancelled',
               'action_required': 'action_required', 'skipped': 'skipped', 'neutral': 'neutral', 'stale': 'neutral'}
RED = {'failure', 'timed_out', 'startup_failure', 'action_required', 'stale', 'cancelled'}


def by_hand(live):
    """The counted runs a person or a workflow started (workflow_dispatch): GitHub lists none of them under the PR's checks."""
    return [r for r in live if r.get('event') == 'workflow_dispatch']


def minutes(run, now):
    """Minutes the run has run (or ran), '' when its start is unknown. `now` is a datetime."""
    from datetime import datetime
    try:
        start = datetime.fromisoformat(str(run['createdAt']).replace('Z', '+00:00'))
        end = datetime.fromisoformat(str(run['updatedAt']).replace('Z', '+00:00')) if run.get('status') == 'completed' else now
    except (KeyError, ValueError):
        return ''
    return f'{max(0.0, (end - start).total_seconds()) / 60:.1f} min'


def row_of(run, state, repo, server, now):
    """One run -> the check row that tells it: name = the run's own title, status/conclusion = the run's, details_url = the run.
    state is the verdict's: a red run under a 'success' verdict is one the verdict reads as grey (main's own red, a lane), shown neutral so the list never contradicts it."""
    status = 'completed' if run.get('status') == 'completed' else 'queued' if run.get('status') in QUEUED else 'in_progress'
    ran = run.get('conclusion') or ''
    conclusion = None
    if status == 'completed':
        conclusion = CONCLUSIONS.get(ran, 'neutral')
        if state == 'success' and ran in RED:
            conclusion = 'neutral'
    # Why (Gitar on #4188): a display row never shares a name with a job or workflow check of the head, so its own `check_name` list finds only rows and the PR never shows two checks of one name.
    name = 'run · ' + re.sub(r'\s+', ' ', str(run.get('displayTitle') or run.get('workflowName') or 'run')).strip()[:94]
    took = minutes(run, now)
    words = {'completed': f'ended {ran or "unknown"}' + (', read as grey by the verdict' if conclusion == 'neutral' and ran in RED else ''), 'queued': 'waiting for a runner',
             'in_progress': 'running'}[status]
    url = f"{server}/{repo}/actions/runs/{run['databaseId']}"
    return {'external_id': f"{PREFIX}{run['databaseId']}", 'name': name, 'status': status, 'conclusion': conclusion, 'url': url,
            'title': f'{words} {took}'.strip()[:140], 'summary': f'[{name}]({url}): {words}{", " + took if took else ""}.'}   # the link first: GitHub ignores details_url for a check run of this app (its Details is the row's own page)


def rows(live, state, repo, server, now):
    """-> the rows of the counted by-hand runs, oldest first. Empty for a head with none."""
    return [row_of(r, state, repo, server, now) for r in sorted(by_hand(live), key=lambda r: (r.get('createdAt') or '', r.get('databaseId') or 0))]


def table(live, state, repo, server, now):
    """The verdict run's step summary: every counted run (not only the by-hand ones) with its state, minutes and a link, so the page 'All checks passed' opens lists what it counted."""
    lines = ['| Run | State | Time | Started by |', '|---|---|---|---|']
    for r in sorted(live, key=lambda r: (r.get('createdAt') or '', r.get('databaseId') or 0)):
        url = f"{server}/{repo}/actions/runs/{r['databaseId']}"
        what = r.get('conclusion') if r.get('status') == 'completed' else r.get('status') or 'unknown'
        lines.append(f"| [{str(r.get('displayTitle') or r.get('workflowName') or 'run').replace('|', '/')[:100]}]({url}) | {what} | {minutes(r, now)} | "
                     f"{'by hand or a workflow (not in the PR checks list)' if r.get('event') == 'workflow_dispatch' else 'the pull request'} |")
    return f'### Checks counted for this commit: {state}\n\n' + '\n'.join(lines) + '\n'


def current_open_head(pulls, sha):
    """True only when an open, unmerged PR whose head IS `sha` and whose head lives in this repository (a fork PR: no) exists. Why: the row writer
    holds `checks: write`, so it must never reach a commit that is not a PR's current head (a replaced push, a closed PR, a fork's commit)."""
    return any(p.get('state') == 'open' and not p.get('merged_at') and p.get('head_sha') == sha and not p.get('cross_repo') for p in pulls)


def write(repo, sha, wanted, gh, dry_run=False):
    """Create or update each row on `sha`. One list per row, filtered by its exact name (`check_name`): a head with over 100 check runs must not hide a row (a page of 100
    without the filter would, and every write would then add a copy). A write only for a row that is new or changed (the token's REST calls are shared by every workflow)."""
    import json
    from urllib.parse import quote
    done = []
    for row in wanted:
        listed = json.loads(gh('api', f"repos/{repo}/commits/{sha}/check-runs?per_page=100&check_name={quote(row['name'])}", '--jq',
                               '[.check_runs[] | {id, external_id, status, conclusion, title: .output.title}]') or '[]')
        old = next((c for c in listed if c.get('external_id') == row['external_id']), None)
        if old and (old['status'], old['conclusion'], old['title']) == (row['status'], row['conclusion'], row['title']):
            continue
        args = ['-f', f"name={row['name']}", '-f', f"status={row['status']}", '-f', f"details_url={row['url']}", '-f', f"external_id={row['external_id']}",
                '-f', f"output[title]={row['title']}", '-f', f"output[summary]={row['summary']}"]
        if row['conclusion']:
            args += ['-f', f"conclusion={row['conclusion']}"]
        done.append(row['external_id'])
        if dry_run:
            continue
        if old:
            gh('api', '-X', 'PATCH', f"repos/{repo}/check-runs/{old['id']}", *args)
        else:
            gh('api', f'repos/{repo}/check-runs', '-f', f'head_sha={sha}', *args)
    return done


def publish(repo, sha, pulls, live, state, gh, server, now, dry_run=False, summary_path=''):
    """The verdict's side effects beyond its status, never able to change it: the summary table (any head), then the rows (the PR's current open head only).
    Each has its own try (Gitar on #4188: a full or missing summary path must not hide the rows); a failure is printed and the status written first stands."""
    if summary_path and live:
        try:
            with open(summary_path, 'a', encoding='utf-8') as file:
                file.write(table(live, state, repo, server, now))
        except OSError as error:
            print(f'summary table not written ({type(error).__name__}): {str(error)[:200]}')
    try:
        return write(repo, sha, rows(live, state, repo, server, now), gh, dry_run) if current_open_head(pulls, sha) else []
    except Exception as error:   # a row is display only: the required status above stays
        print(f'check rows not written ({type(error).__name__}): {str(error)[:200]}; the verdict is unchanged')
        return []
