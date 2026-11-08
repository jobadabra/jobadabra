"""Where the last Find jobs run stopped: one file of counts, press_left.json (plan E2b; owner, 8 Nov 2026: "When 3 mins stops, the next run nows where to
continue and what are the left things to do and the next goals").
{"<step>": {"left": int, "saved_at": "<iso, UTC, seconds>"}}, one entry per time_budget.STAGES name (STEPS: lower-case, underscores). `left` is what that
step's own "⏱ Time is up" line counted (time_budget.later, left_line); `saved_at` is when the run that wrote it said so.
COUNTS ONLY, never read back by the engine: the items themselves stay in their owners' files (employers_left.json, title_triage.json, late_reads.json,
found_boards.json, the jobs store), so the next run resumes from those and this file can be wrong or missing without losing a job. Its reader is the
planner (`load_left`); nobody else hard-codes the path.
Writes: `note` as each step says it (a run stopped at 175 s still leaves what it said), `save` once at the end of a run that reached its end: every step
that said nothing is 0 left, except one a process of the same run (the job boards' own process on a first run) already wrote. A run that is stopped
leaves the older entries, with their older `saved_at`, for the planner to see as stale. Only a timed run writes (a CLI run, a test without a budget: nothing).
Tests: tests/unit/press/test_resume.py."""
import json
import os
import threading
import time
from datetime import datetime, timezone

from .. import paths

FILE = 'press_left.json'
STEPS = {'web search': 'web_search', 'job boards': 'job_boards', 'employer sites': 'employer_sites', 'free job APIs': 'free_job_apis',
         'Google Jobs': 'google_jobs', 'job-alert emails': 'job_alert_emails', 'descriptions': 'descriptions', 'places': 'places',
         'title sorting': 'title_sorting', 'scoring': 'scoring', 'job facts': 'job_facts', 'kits': 'kits', 'employer names': 'employer_names'}   # = time_budget.STAGES, pinned by the test
LEFT_LINES = {'titles': 'title sorting', 'score': 'scoring', 'enrich': 'job facts'}   # time_budget.left_line's step names -> their stage
_lock = threading.Lock()


def _file():
    return paths.DATA / FILE


def load_left():
    """{step: {'left': int, 'saved_at': iso}} as the last runs saved it; {} when there is no file or it is not that shape."""
    try:
        data = json.loads(_file().read_text())
    except (OSError, ValueError):
        return {}
    if not isinstance(data, dict):
        return {}
    for entry in data.values():
        if not (isinstance(entry, dict) and isinstance(entry.get('left'), int) and not isinstance(entry.get('left'), bool) and isinstance(entry.get('saved_at'), str)):
            return {}
    return data


def _write(data):   # whole or not at all: the run may be stopped while it writes
    _file().parent.mkdir(parents=True, exist_ok=True)
    part = _file().with_suffix('.part')
    part.write_text(json.dumps(data, indent=1) + '\n')
    os.replace(part, _file())


def _timed():
    from .. import time_budget
    return time_budget.DEADLINE is not None


def _run_start():
    """When this run began, as a UTC time: its press (SEARCH_AT) when the app started it, else this process's start."""
    from .. import time_budget
    return datetime.fromtimestamp(time.time() - (time.monotonic() - time_budget.BEGAN), timezone.utc)


def _stamp(at):
    return (at or datetime.now(timezone.utc)).isoformat(timespec='seconds')


def note(stage, left, at=None):
    """A step (a time_budget.STAGES name) says `left` items wait for the next run: saved at once. An unknown stage raises KeyError."""
    key = STEPS[stage]
    if not _timed():
        return
    with _lock:
        data = load_left()
        data[key] = {'left': int(left), 'saved_at': _stamp(at)}
        _write(data)


def save(now=None):
    """The end of a run that reached its end: every step that said nothing in this run has nothing left."""
    if not _timed():
        return
    began = _run_start().replace(microsecond=0)   # saved_at has whole seconds
    with _lock:
        data = load_left()
        for key in STEPS.values():
            wrote = data.get(key)
            if wrote and datetime.fromisoformat(wrote['saved_at']) >= began:   # this run's own say, from this or another of its processes
                continue
            data[key] = {'left': 0, 'saved_at': _stamp(now)}
        _write(data)
