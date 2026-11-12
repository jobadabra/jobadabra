"""Whether press-tapes-auto.yml records now: the one decision its `decide` job takes from main's offline gap check (mode=gaps), before any Codex-plan call is spent.

Env: PERSONAS = the gap check's JSON list of people to re-record; MIN_GAPS = the line (a whole number >= 1; empty = 1, the day's catch-all that records any gap).
Writes `record` (true when at least MIN_GAPS of the 18 people are listed) and `daily` (true when MIN_GAPS is 1: the 10:30 run or one started by hand, whose table of main's replay runs even
when nobody is recorded) to $GITHUB_OUTPUT, and one line to $GITHUB_STEP_SUMMARY saying what it decided. An unreadable MIN_GAPS exits 1: a wrong line must never read as "record".
Why (13 Nov 2026, owner, asked via AskUserQuestion by mac-9a: "When the replay finds many empty": "The daily replay re-records by itself when it sees several people with 0 jobs, then re-runs.
It only spends a run when the recordings are stale."): the cheap offline check runs hourly (app-core/src/scheduler.js TAPES_CHECK); below the line it ends here with no recording and no AI call."""
import json
import os
import sys

PEOPLE = 18


def decide(personas, min_gaps):
    """(record, daily, summary line) for these people to re-record and this line."""
    gaps = len(personas)
    daily = min_gaps == 1
    record = gaps >= min_gaps
    if record:
        line = f'{gaps} of {PEOPLE} people have a recording gap' + ('' if daily else f' (the line is {min_gaps}): re-recording them, then the table replays main again')
    else:
        line = f'{gaps} of {PEOPLE} people have a recording gap, below the line of {min_gaps}: nothing is recorded now and no AI call is spent; it waits for more merges or the 10:30 UTC daily run, which records any gap'
    return record, daily, line


def main():
    raw = (os.environ.get('MIN_GAPS') or '1').strip()
    if not raw.isdigit() or int(raw) < 1:
        print(f'::error::MIN_GAPS must be a whole number of 1 or more, got "{raw}"')
        return 1
    record, daily, line = decide(json.loads(os.environ.get('PERSONAS') or '[]'), int(raw))
    with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as out:
        out.write(f'record={str(record).lower()}\ndaily={str(daily).lower()}\n')
    with open(os.environ['GITHUB_STEP_SUMMARY'], 'a', encoding='utf-8') as summary:
        summary.write(f'### Re-record decision\n- {line}\n')
    print(line)
    return 0


if __name__ == '__main__':
    sys.exit(main())
