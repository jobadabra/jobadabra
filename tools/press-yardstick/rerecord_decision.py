"""Whether press-tapes-auto.yml records now: the one decision its `decide` job takes from main's offline gap check (mode=gaps), before any Codex-plan call is spent.

Env: PERSONAS = the gap check's JSON list of people to re-record; MIN_GAPS = the line (a whole number >= 1; empty = 1, the daily catch-all that records any gap);
REPO, GH_TOKEN, GITHUB_RUN_ID for the look at the workflow's past runs (LAST_RECORD, an ISO time or empty, replaces that look; NOW, an ISO time, replaces the clock: both for tests).
Writes `record` (true when at least MIN_GAPS of the 18 people are listed and, for an hourly look, the last automatic re-record started MIN_HOURS_BETWEEN or more ago) and `daily`
(true when MIN_GAPS is 1: the 10:30 run or one started by hand, which never waits for that time and whose table of main's replay runs even when nobody is recorded) to $GITHUB_OUTPUT,
and one line to $GITHUB_STEP_SUMMARY saying what it decided. An unreadable MIN_GAPS exits 1: a wrong line must never read as "record".
Why (13 Nov 2026, owner, asked via AskUserQuestion by mac-9a: "When the replay finds many empty": "The daily replay re-records by itself when it sees several people with 0 jobs, then re-runs.
It only spends a run when the recordings are stale."): the cheap offline check runs hourly (app-core/src/scheduler.js TAPES_CHECK); below the line it ends here with no recording and no AI call.
Why (13 Nov 2026, owner, asked via AskUserQuestion by mac-9a: "At most one every 6 h"): a busy day's merges during a recording would put the next hourly look back over the line, so a second re-record
within MIN_HOURS_BETWEEN of the last one's start waits for it. The time is read from this workflow's own past runs (the start of its record job), never a new store. The 10:30 run keeps its rule (any gap
records, no wait) and its recording is a re-record like any other: it starts the 6 h for the hourly looks that follow."""
import json
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone

PEOPLE = 18
MIN_HOURS_BETWEEN = 6
RECORD_JOB = 'Re-record the people with a gap'   # the `record` job's name in press-tapes-auto.yml; its called jobs read "<name> / <job>"
WORKFLOW = 'press-tapes-auto.yml'


def _gh(*args):
    return subprocess.run(['gh', *args], capture_output=True, text=True, check=True, timeout=60).stdout


def _time(text):
    return datetime.fromisoformat(text.replace('Z', '+00:00'))


def last_record_start(repo, run_id, gh=_gh):
    """When the last automatic re-record started (the earliest job of the record job that did not skip), read from this workflow's past runs newest first, never this run; None when none did.
    `gh(*args)` returns the CLI's stdout (a test replaces it). Runs are created in the order they run (concurrency: one at a time), so the first run with a record is the latest one."""
    runs = json.loads(gh('run', 'list', '--repo', repo, '--workflow', WORKFLOW, '--limit', '30', '--json', 'databaseId,createdAt'))
    for run in sorted(runs, key=lambda item: item['createdAt'], reverse=True):
        if str(run['databaseId']) == str(run_id):
            continue
        jobs = [json.loads(line) for line in gh('api', f"repos/{repo}/actions/runs/{run['databaseId']}/jobs", '--paginate', '--jq', '.jobs[] | {name, conclusion, started_at}').splitlines() if line.strip()]   # one object a line: --paginate prints one result per page
        starts = [_time(job['started_at']) for job in jobs if (job['name'] == RECORD_JOB or job['name'].startswith(RECORD_JOB + ' / ')) and job.get('conclusion') != 'skipped' and job.get('started_at')]
        if starts:
            return min(starts)
    return None


def decide(personas, min_gaps, last_start=None, now=None):
    """(record, daily, summary line) for these people to re-record, this line, and when the last automatic re-record started (None = none found)."""
    gaps, daily = len(personas), min_gaps == 1
    count = f'{gaps} of {PEOPLE} people have a recording gap'
    if gaps < min_gaps:
        return False, daily, f'{count}, below the line of {min_gaps}: nothing is recorded now and no AI call is spent; it waits for more merges or the 10:30 UTC daily run, which records any gap'
    if not daily and last_start is not None and now is not None and now < last_start + timedelta(hours=MIN_HOURS_BETWEEN):
        allowed = last_start + timedelta(hours=MIN_HOURS_BETWEEN)
        return False, daily, f'{count} (the line is {min_gaps}), but the last automatic re-record started at {last_start:%H:%M} UTC, less than {MIN_HOURS_BETWEEN} h ago: next allowed at {allowed:%H:%M} UTC, no AI call is spent now'
    return True, daily, f'{count}' + ('' if daily else f' (the line is {min_gaps}): re-recording them, then the table replays main again')


def main():
    raw = (os.environ.get('MIN_GAPS') or '1').strip()
    if not raw.isdigit() or int(raw) < 1:
        print(f'::error::MIN_GAPS must be a whole number of 1 or more, got "{raw}"')
        return 1
    personas, min_gaps = json.loads(os.environ.get('PERSONAS') or '[]'), int(raw)
    now = _time(os.environ['NOW']) if os.environ.get('NOW') else datetime.now(timezone.utc)
    last = None
    if len(personas) >= min_gaps and min_gaps > 1:   # only an hourly look that would record needs the past runs
        if 'LAST_RECORD' in os.environ:
            last = _time(os.environ['LAST_RECORD']) if os.environ['LAST_RECORD'] else None
        else:
            last = last_record_start(os.environ['REPO'], os.environ.get('GITHUB_RUN_ID', ''))
    record, daily, line = decide(personas, min_gaps, last, now)
    with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as out:
        out.write(f'record={str(record).lower()}\ndaily={str(daily).lower()}\n')
    with open(os.environ['GITHUB_STEP_SUMMARY'], 'a', encoding='utf-8') as summary:
        summary.write(f'### Re-record decision\n- {line}\n')
    print(line)
    return 0


if __name__ == '__main__':
    sys.exit(main())
