"""Yield per step of a Find jobs run: what each step brought and how long it ran (plan P1, owner, 8 Nov 2026: "based on the fastest pathway to get those 'as many jobs as possible'").
Today only a source has a rate (src/source_yield.py, src/source_rank.py); no step does, so nothing can say which step should run first. This file measures it and changes nothing: a
REPORT, kept per run in the job cache (table step_yield) and said in one line. P2 (src/press/plan.py) reads these rows.
A step is a way a run grows the list (named as time_budget.STAGES, said with spaces): the finders (job_boards, employer_sites, free_job_apis) bring NEW jobs, counted when they land (SoFar.add(..., step=)); the
scoring step (the waiting jobs' pass) brings SCORES for jobs found earlier. Per step: jobs (new, or scored), local (located in your places, never worldwide remote), scored, fit70,
local_fit70 (the right local jobs), seconds. A finder is credited with its jobs' fit even when a later step scored them; the seconds of that scoring are not charged to it.
Seconds are the step's wall time (overlapping spans of one step count once). Steps run beside each other, so rates are per step-minute and never add up to the run.
Counts only, nothing about the person. Not measured here: EURES (inside free APIs), titles and places (they sort, they bring no job), the employer finder.
The yardstick's numbers are unusable until the replay-fidelity card lands: this is a measurement, not a proof of speed.
Tests: tests/unit/press/test_step_yield.py."""
import contextlib
import threading
import time

from ..source_yield import FIT, _fits   # one reader of the scores and one "fit 70+" for both reports (Gitar, #3603)

STEPS = ('scoring', 'job_boards', 'employer_sites', 'free_job_apis')   # time_budget.STAGES' names (e2b's contract, 8 Nov 2026), the engine's order today; P2 owns the order from here on.
# 'scoring' here is the waiting jobs' pass; the boards read first and beside the employer sites are ONE step until E2a-2 splits them
TABLE = '''CREATE TABLE IF NOT EXISTS step_yield (
    run_at TEXT NOT NULL, step TEXT NOT NULL, seconds REAL, jobs INTEGER NOT NULL, local INTEGER NOT NULL,
    scored INTEGER NOT NULL, fit70 INTEGER NOT NULL, local_fit70 INTEGER NOT NULL, PRIMARY KEY (run_at, step))'''
FIELDS = ('step', 'seconds', 'jobs', 'local', 'scored', 'fit70', 'local_fit70')

_lock = threading.Lock()
_spans = {}    # step -> [(start, end)] in time.monotonic() seconds
_landed = {}   # step -> {url: True} of the NEW jobs that landed
_scored = {}   # step -> {job id} of the jobs the step scored


def reset():
    """A run's measure starts empty (the search calls it first, as run_counts.reset)."""
    with _lock:
        _spans.clear(), _landed.clear(), _scored.clear()


@contextlib.contextmanager
def span(step):
    """Time `step` while the block runs (any thread; a block that raises still counts its seconds)."""
    began = time.monotonic()
    try:
        yield
    finally:
        with _lock:
            _spans.setdefault(step, []).append((began, time.monotonic()))


def landed(step, jobs, statuses):
    """Note the jobs a finder just imported: those with status 'new' and a url count for `step` (a job read again, or with no address, is not this step's find)."""
    with _lock:
        found = _landed.setdefault(step, {})
        for job, status in zip(jobs, statuses):
            if status == 'new' and job.get('url'):
                found[job['url']] = True


def scored(step, job_ids):
    """Note the jobs a scoring step took in hand (their ids in the job cache)."""
    with _lock:
        _scored.setdefault(step, set()).update(job_ids)


def _seconds(spans):
    """Wall seconds covered by `spans` (overlaps counted once), None for no span."""
    total, end = 0.0, None
    for start, stop in sorted(spans):   # Why (P1): display order of a union, not a run order
        if end is None or start > end:
            total += stop - start
            end = stop
        elif stop > end:
            total += stop - end
            end = stop
    return round(total, 1) if spans else None


def _facts(db):
    """({url: id}, {id: job as the place check reads it}, {id: fit}) of the cache's jobs and scores. Why (Gitar, #3603): the check of a country-only place looks the
    posting's own read up by its url and a hash of title + location + description, so the job carries all four."""
    ids, jobs = {}, {}
    for job_id, url, title, location, description in db.execute('SELECT id, url, title, location, description FROM jobs'):
        ids[url] = job_id
        jobs[job_id] = {'url': url, 'title': title, 'location': location or '', 'description': description}
    return ids, jobs, _fits(db)


def measure(db, in_my_place=None):
    """[{step, seconds, jobs, local, scored, fit70, local_fit70}] for each step that ran or brought a job, in STEPS order. in_my_place: the place check (default feeds.in_my_place)."""
    if in_my_place is None:
        from ..sources.feeds import in_my_place
    with _lock:
        spans, landed_by, scored_by = {k: list(v) for k, v in _spans.items()}, {k: list(v) for k, v in _landed.items()}, {k: set(v) for k, v in _scored.items()}
    ids, where, fits = _facts(db)
    rows = []
    for step in STEPS:
        taken = {ids[url] for url in landed_by.get(step, ()) if url in ids} | scored_by.get(step, set())
        if not (taken or step in spans or step in landed_by):
            continue
        row = dict.fromkeys(FIELDS, 0) | {'step': step, 'seconds': _seconds(spans.get(step, [])), 'jobs': len(landed_by.get(step, ())) + len(scored_by.get(step, ()))}
        for job_id in taken:
            here = in_my_place(where[job_id])
            row['local'] += here
            if job_id in fits:
                row['scored'] += 1
                row['fit70'] += fits[job_id] >= FIT
                row['local_fit70'] += here and fits[job_id] >= FIT
        rows.append(row)
    return rows


def record(db, run_at, rows):
    """Keep this run's rows (a run measured twice keeps its last count)."""
    db.execute(TABLE)
    with db:
        db.executemany(f"INSERT OR REPLACE INTO step_yield (run_at, {', '.join(FIELDS)}) VALUES (?, {', '.join('?' * len(FIELDS))})",
                       [(run_at, *(row[field] for field in FIELDS)) for row in rows])


def latest(db):
    """The last measured run's rows in STEPS order, or []."""
    db.execute(TABLE)
    names = ('run_at', *FIELDS)
    found = [dict(zip(names, row)) for row in db.execute(f"SELECT {', '.join(names)} FROM step_yield WHERE run_at = (SELECT MAX(run_at) FROM step_yield)")]
    return [row for step in STEPS for row in found if row['step'] == step]


def per_minute(row, field='local'):
    """`field` per minute of the step's wall time (local jobs by default; 'local_fit70' for the right ones); None when the step has no seconds."""
    return round(row[field] * 60 / row['seconds'], 1) if row.get('seconds') else None


def line(rows):
    """'Step yield: employer sites 12 local in 41 s (17.6/min, 3 fit 70+) · job boards 4 local in 9 s (26.7/min)'; the steps that brought nothing are left out."""
    said = []
    for row in rows:
        if not (row['local'] or row['scored']):
            continue
        rate = per_minute(row)
        took = f" in {row['seconds']:g} s" if row['seconds'] else ''
        detail = ([f'{rate:g}/min'] if rate is not None else []) + ([f"{row['local_fit70']} fit {FIT}+"] if row['local_fit70'] else [])
        said.append(f"{row['step'].replace('_', ' ')} {row['local']} local{took}" + (f" ({', '.join(detail)})" if detail else ''))
    return 'Step yield: ' + (' · '.join(said) if said else 'no step brought a job in your places')


def run(db, run_at):
    """Measure, keep and say this run's step yield; returns the rows. Never stops a search (the caller catches)."""
    rows = measure(db)
    record(db, run_at, rows)
    reset()
    print(line(rows), flush=True)
    return rows
