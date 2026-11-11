"""What each Find jobs run of a person adds (owner, 11 Nov 2026, asked via AskUserQuestion in session sa: "2 runs nightly, 5 runs weekly (Recommended)"; the
reason: "each of the runs should provide new jobs"). The night presses Find jobs twice in the same install; the blind judge reads every run's jobs in one pass
(only a later run's new jobs add calls), and this splits its answer by run:
- judged-all.json keeps every judged row with its `run`; judged.json keeps the first run's rows only, and jobs.json (the listed links in = out reads,
  inout.attach) the first run's jobs, the full list kept as jobs-all.json; so every number read from them (right jobs, the per-source count, in = out, the
  floors' `right`) stays the first run's, as before the second run existed (Gitar on #3781: in = out read the links of both runs);
- runs.json: per run {run, new_listed, new_right, seconds}: the distinct jobs (gate_judge.key: title, employer, place) a run listed first, and how many of them
  the judge called right role AND right place.
A job's run: the latest press that started at or before its first_seen_at. src/store.py writes first_seen_at once, at insert (UTC, seconds); a job listed again,
by the same link or as the same job from another reader, keeps it, so a job is never new twice. A judged job belongs to the earliest run any of its rows was
first seen in. Without press start times (a run.mjs before `started`) or with one press, everything is run 1 and judged.json is left as it is.
  python3 tools/persona-search/runs.py split <out>     after the judge, before `gate.py result`"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))


def _presses(out):
    """The press rows of draw/presses.jsonl, [] when there is none."""
    try:
        lines = (Path(out) / 'draw' / 'presses.jsonl').read_text(encoding='utf-8').splitlines()
        return [row for row in (json.loads(line) for line in lines if line.strip()) if isinstance(row, dict)]
    except (OSError, ValueError):
        return []


def _when(text):
    """An ISO time as UTC seconds since the epoch, whole seconds (first_seen_at has no fraction), or None."""
    try:
        moment = datetime.fromisoformat(str(text).replace('Z', '+00:00'))
    except ValueError:
        return None
    return int((moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)).timestamp())


def starts(out):
    """Each press's start (seconds), None unless every press says when it started."""
    found = [_when(row.get('started')) for row in _presses(out)]
    return found if found and None not in found else None


def run_of(first_seen, begun):
    """The run that first listed a job: the latest press started at or before it; 1 when it cannot be said."""
    seen = _when(first_seen) if first_seen else None
    if seen is None or not begun:
        return 1
    return max([i + 1 for i, start in enumerate(begun) if start <= seen] or [1])


def split(out):
    """Mark each judged row with its run; write judged-all.json, runs.json and judged.json (first run only) -> the runs list."""
    from gate_judge import key   # here, not at the top: gate_judge imports gate, which imports this file
    out = Path(out)
    judged = json.loads((out / 'judged.json').read_text(encoding='utf-8'))
    rows, presses, begun = judged['rows'], _presses(out), starts(out)
    first = {}
    for row in rows:
        first[key(row)] = min(first.get(key(row), 10 ** 6), run_of(row.get('first_seen'), begun))
    right = {key(row) for row in rows if row.get('role') == 'yes' and row.get('place') == 'yes'}
    count = len(begun) if begun else 1
    found = [{'run': n, 'new_listed': sum(1 for run in first.values() if run == n), 'new_right': sum(1 for k, run in first.items() if run == n and k in right),
              'seconds': presses[n - 1].get('seconds') if len(presses) >= n else None} for n in range(1, count + 1)]
    (out / 'runs.json').write_text(json.dumps(found), encoding='utf-8')
    if count > 1:
        for row in rows:
            row['run'] = first[key(row)]
        (out / 'judged-all.json').write_text(json.dumps(judged, ensure_ascii=False, indent=1), encoding='utf-8')
        kept = [row for row in rows if row['run'] == 1]
        (out / 'judged.json').write_text(json.dumps({**judged, 'rows': kept, 'judged_jobs': len({key(row) for row in kept})}, ensure_ascii=False, indent=1), encoding='utf-8')
        listed = out / 'jobs.json'
        if listed.exists():
            jobs = json.loads(listed.read_text(encoding='utf-8'))
            (out / 'jobs-all.json').write_text(json.dumps(jobs, ensure_ascii=False, indent=1), encoding='utf-8')
            listed.write_text(json.dumps([job for job in jobs if first.get(key(job), 1) == 1], ensure_ascii=False, indent=1), encoding='utf-8')
    return found


def read(out):
    """runs.json for a person's result row, None when the split did not run."""
    try:
        found = json.loads((Path(out) / 'runs.json').read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None
    return found if isinstance(found, list) else None


def new_right(row, n):
    """The right jobs run n of a person's row added first, None when that run was not measured."""
    runs = row.get('runs') if isinstance(row, dict) else None
    entry = runs[n - 1] if isinstance(runs, list) and len(runs) >= n and isinstance(runs[n - 1], dict) else {}
    return entry.get('new_right') if isinstance(entry.get('new_right'), int) else None


def night(rows):
    """The verdict's runs numbers over the measured persons whose row carries a second run: how many got at least one new right job on run 2, and the right
    jobs after two runs; None when no row carries a second run. A measured 0 is a 0 (sa, 11 Nov 2026: the honest baseline sf's lanes 4/5 must move), never grey."""
    rows = [row for row in rows if isinstance(row, dict) and not row.get('not_run') and not row.get('not_measured') and new_right(row, 2) is not None]
    if not rows:
        return None
    return {'measured': len(rows), 'people_new_on_2': sum(1 for row in rows if new_right(row, 2) >= 1),
            'right_after_2': sum((new_right(row, 1) or 0) + new_right(row, 2) for row in rows)}


def after_repeat(out):
    """The press-2 row's running totals (metrics.py reads the whole jobs.sqlite), None on a one-press run (#3565 review). Moved from gate.py (11 Nov 2026)."""
    presses = _presses(out)
    if len(presses) < 2:
        return None
    return {k: presses[1].get(k) for k in ('seconds', 'code', 'local_jobs', 'in_places', 'scored_in_places', 'fit70_in_places')}


if __name__ == '__main__':
    if len(sys.argv) != 3 or sys.argv[1] != 'split':
        sys.exit(__doc__)
    try:
        print(f'runs: {split(sys.argv[2])}')
    except (OSError, ValueError, KeyError, TypeError) as error:   # Why: no judged.json (the judge failed) leaves the row as `gate.py result` reads it, grey
        print(f'runs: not split ({type(error).__name__})')
