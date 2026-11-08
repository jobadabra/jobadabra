"""Where the last Find jobs run stopped: one file of counts, press_left.json (plan E2b; owner, 8 Nov 2026: "When 3 mins stops, the next run nows where to
continue and what are the left things to do and the next goals").
{"<step>": {"left": int, "saved_at": "<iso, UTC, seconds>"}}, one entry per time_budget.STAGES name (STEPS: lower-case, underscores). `left` is what that
step's own "⏱ Time is up" line counted (time_budget.later, left_line); `saved_at` is when the process that wrote it said so.
COUNTS ONLY, never read back by the engine: the items themselves stay in their owners' files (employers_left.json, title_triage.json, late_reads.json,
found_boards.json, the jobs store), so the next run resumes from those and this file can be wrong or missing without losing a job. A write that fails
(read-only folder, full disk) is said on stderr and ignored: it never stops a run. Its reader is the planner (`load_left`); nobody else hard-codes the path.
Writes: `note` as each step says it (a run stopped at 175 s still leaves what it said), `save` once at the end of a search process (daily_search.search):
the process's own view wins, so a step it said nothing about is 0 left. One exception: the job boards' discover process (`src discover`, its own process
on a first run, between two search processes) writes JOB_BOARDS_STEPS and never saves, so a search process that said nothing about those keeps what discover
wrote in this run. A run that is stopped leaves the older entries, with their older `saved_at`, for the planner to see as stale. Only a timed run writes
(a CLI run, a test without a budget: nothing). Tests: tests/unit/press/test_resume.py."""
import json
import os
import sys
import threading
import time
from datetime import datetime, timezone

from .. import paths

FILE = 'press_left.json'
STEPS = {'web search': 'web_search', 'job boards': 'job_boards', 'employer sites': 'employer_sites', 'free job APIs': 'free_job_apis',
         'Google Jobs': 'google_jobs', 'job-alert emails': 'job_alert_emails', 'descriptions': 'descriptions', 'places': 'places',
         'title sorting': 'title_sorting', 'scoring': 'scoring', 'job facts': 'job_facts', 'kits': 'kits', 'employer names': 'employer_names'}   # = time_budget.STAGES, pinned by the test
LEFT_LINES = {'titles': 'title sorting', 'score': 'scoring', 'enrich': 'job facts'}   # time_budget.left_line's step names -> their stage
JOB_BOARDS_STEPS = ('job_boards', 'employer_names')   # what `src discover` (src/sources/boards.py, board_employers.py) says in its own process
_lock = threading.Lock()
_said = set()   # the steps this process said (note), so its save() does not zero them


def begin():
    """A new search starts in this process (time_budget.start): nothing is said yet."""
    _said.clear()


def _file():
    return paths.DATA / FILE


def load_left():
    """{step: {'left': int, 'saved_at': iso}} as the last runs saved it; {} when there is no file or it is not a dict. An entry of the wrong shape is skipped."""
    try:
        data = json.loads(_file().read_text())
    except (OSError, ValueError):
        return {}
    if not isinstance(data, dict):
        return {}
    return {step: entry for step, entry in data.items()
            if isinstance(entry, dict) and type(entry.get('left')) is int and isinstance(entry.get('saved_at'), str)}


def _write(data):
    """Whole or not at all (a temp file of this process, then a rename): the run may be stopped while it writes, and two processes never share the temp file."""
    _file().parent.mkdir(parents=True, exist_ok=True)
    part = _file().with_suffix(f'.{os.getpid()}.part')
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


def _keep(change):
    """Read the file, let `change(data)` edit it, write it back; a failure is said on stderr and ignored (the file is a note for the planner, not a part of the run)."""
    try:
        with _lock:
            data = load_left()
            change(data)
            _write(data)
    except OSError as error:
        print(f'Warning: press_left.json not written ({type(error).__name__}); the next run resumes from the queues\' own files', file=sys.stderr, flush=True)


def note(stage, left, at=None):
    """A step (a time_budget.STAGES name) says `left` items wait for the next run: saved at once. An unknown stage raises KeyError."""
    key = STEPS[stage]
    if not _timed():
        return
    _said.add(key)
    _keep(lambda data: data.__setitem__(key, {'left': int(left), 'saved_at': _stamp(at)}))


def save(now=None, began=None):
    """The end of a search process: a step it said nothing about has nothing left, except the job boards' discover steps written since `began` (this
    run's start, a UTC time: the process's own start by default) by the discover process."""
    if not _timed():
        return
    began = (began or _run_start()).replace(microsecond=0)   # saved_at has whole seconds

    def fill(data):
        for key in STEPS.values():
            wrote = data.get(key)
            discovered = key in JOB_BOARDS_STEPS and wrote and datetime.fromisoformat(wrote['saved_at']) >= began
            if key not in _said and not discovered:
                data[key] = {'left': 0, 'saved_at': _stamp(now)}
    _keep(fill)
