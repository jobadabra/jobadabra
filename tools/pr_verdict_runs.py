"""Refresh pending verdict evidence by run ID, stopping at the first live run or red result."""
import json


def refresh(repo, sha, runs, jobs, gh, counted, red, e2e_title):
    """Mutate the pending snapshot only as far as needed; match head, run ID and attempt.
    Invariant: one actually live run proves pending; an ended red stops further by-ID calls.
    Completed runs reload deciding jobs, including a successful end's lagging jobs.
    """
    for run in counted(runs):
        if run.get('status') == 'completed':
            continue
        fresh = json.loads(gh('api', f"repos/{repo}/actions/runs/{run['databaseId']}"))
        if fresh.get('head_sha') != sha or fresh.get('id') != run['databaseId'] or fresh.get('run_attempt') != run.get('attempt'):
            break
        run.update(status=fresh['status'], conclusion=fresh['conclusion'], updatedAt=fresh['updated_at'])
        if fresh['status'] != 'completed':
            break
        if fresh['conclusion'] in red or str(run.get('displayTitle', '')).startswith(e2e_title):
            listed = json.loads(gh('api', f"repos/{repo}/actions/runs/{run['databaseId']}/jobs?per_page=100", '--jq', '.jobs'))
            jobs[run['databaseId']] = listed
            if fresh['conclusion'] == 'success':
                for job in listed:
                    job.update(status='completed', conclusion='success', completed_at=job.get('completed_at') or fresh['updated_at'])
        if fresh['conclusion'] in red:
            break


def job_spans(repo, runs, gh, counted, keep_job):
    """[(started_at, completed_at)] of every job of the counted runs (one call per run; only for a CI change, the one kind of PR with a budget).
    A job counts when keep_job(its name) holds. Moved from pr-verdict.py (460-line limit, #3001)."""
    spans = []
    for r in counted(runs):
        for j in json.loads(gh('api', f"repos/{repo}/actions/runs/{r['databaseId']}/jobs?per_page=100", '--jq', '[.jobs[] | {started_at, completed_at, name}]') or '[]'):
            if keep_job(j.get('name', '')):
                spans.append((j.get('started_at'), j.get('completed_at')))
    return spans
