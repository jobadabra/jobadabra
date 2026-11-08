"""Where the last Find jobs run stopped: one file of counts, press_left.json (plan E2b; owner, 8 Nov 2026: "When 3 mins stops, the next run nows where to
continue and what are the left things to do and the next goals").
{"<step>": {"left": int, "saved_at": "<iso, UTC, seconds>"}}, one entry per time_budget.STAGES name (STEPS: lower-case, underscores). `left` is what that
step's own "⏱ Time is up" line counted (time_budget.later, left_line); `saved_at` is when the process that wrote it said so.
COUNTS ONLY, never read back by the engine: the items themselves stay in their owners' files (employers_left.json, title_triage.json, late_reads.json,
found_boards.json, the jobs store), so the next run resumes from those and this file can be wrong or missing without losing a job. A write that fails
(read-only folder, full disk) is said on stderr and ignored: it never stops a run. Its reader is the planner (`load_left`); nobody else hard-codes the path.
Writes: `note` as each step says it (a run stopped at 175 s still leaves what it said), `save` once at the end of a search process (daily_search.search):
a step this process RAN (`ran`, called where the step starts) and that said no "Time is up" has nothing left: 0 with a new `saved_at`. A step this process never
started (kits off, no alert e-mails, the job boards' discover step inside a search process) keeps its older entry and its older `saved_at`: stale is not empty,
and the planner reads the date. A run that is stopped leaves the older entries the same way. Only a timed run writes (a CLI run, a test without a budget: nothing).
Tests: tests/unit/press/test_resume.py."""
import json
import os
import sys
import threading
from datetime import datetime, timezone

from .. import paths

FILE = 'press_left.json'
STEPS = {'web search': 'web_search', 'job boards': 'job_boards', 'employer sites': 'employer_sites', 'free job APIs': 'free_job_apis',
         'Google Jobs': 'google_jobs', 'job-alert emails': 'job_alert_emails', 'descriptions': 'descriptions', 'places': 'places',
         'title sorting': 'title_sorting', 'scoring': 'scoring', 'job facts': 'job_facts', 'kits': 'kits', 'employer names': 'employer_names'}   # = time_budget.STAGES, pinned by the test
LEFT_LINES = {'titles': 'title sorting', 'score': 'scoring', 'enrich': 'job facts'}   # time_budget.left_line's step names -> their stage
_lock = threading.Lock()
_said = set()   # the steps this process said (note): its save() leaves them
_ran = set()   # the steps this process started (ran): its save() zeroes those that said nothing


def begin():
    """A new search starts in this process (time_budget.start): nothing has run or been said yet."""
    _said.clear()
    _ran.clear()


def _file():
    return paths.DATA / FILE


def _well_formed(entry):
    """{'left': int, 'saved_at': a timezone-aware ISO time}: what every reader of the file may rely on."""
    if not (isinstance(entry, dict) and type(entry.get('left')) is int and isinstance(entry.get('saved_at'), str)):
        return False
    try:
        return datetime.fromisoformat(entry['saved_at']).tzinfo is not None
    except ValueError:
        return False


def load_left():
    """{step: {'left': int, 'saved_at': iso}} as the last runs saved it; {} when there is no file or it is not a dict. An entry of the wrong shape is skipped."""
    try:
        data = json.loads(_file().read_text())
    except (OSError, ValueError):
        return {}
    if not isinstance(data, dict):
        return {}
    return {step: entry for step, entry in data.items() if _well_formed(entry)}


def _write(data):
    """Whole or not at all (a temp file of this process, then a rename): the run may be stopped while it writes, and two processes never share the temp file."""
    _file().parent.mkdir(parents=True, exist_ok=True)
    part = _file().with_suffix(f'.{os.getpid()}.part')
    part.write_text(json.dumps(data, indent=1) + '\n')
    os.replace(part, _file())


def _timed():
    from .. import time_budget
    return time_budget.DEADLINE is not None


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
        print(f'Warning: what is left for the next search could not be saved ({type(error).__name__}); the next search carries on from its own lists', file=sys.stderr, flush=True)


def ran(stage):
    """This process started a step (a time_budget.STAGES name), where its work begins: called once per step entry, it only marks, never writes. KeyError for an unknown stage."""
    _ran.add(STEPS[stage])


def note(stage, left, at=None):
    """A step (a time_budget.STAGES name) says `left` items wait for the next run: saved at once. An unknown stage raises KeyError."""
    key = STEPS[stage]
    if not _timed():
        return
    _said.add(key)
    _keep(lambda data: data.__setitem__(key, {'left': int(left), 'saved_at': _stamp(at)}))


def save(now=None):
    """The end of a search process: every step it ran and that said nothing has 0 left; the other steps keep their entries as they are."""
    if not _timed():
        return

    def fill(data):
        for key in _ran - _said:
            data[key] = {'left': 0, 'saved_at': _stamp(now)}
    _keep(fill)
