"""Jobs shown as each source is read (owner, 18 Oct 2026: "start displaying jobs to the user as quickly as possible"): a search imports
each source's jobs the moment it has them and says "Jobs so far: N new from …", the line the Jobs list reads itself again on
(desktop/renderer/pages/jobs.js LIST_CHANGED). The search's final import then keeps the early "new" status, so its counts and new-job
lines are the same as when everything was imported at the end. Tests: tests/unit/sources/test_jobs_per_source.py.
The line is said at once for a search's first new jobs, then at most once every EVERY seconds with the sum since the last one (a search
reads ~200 employer sites one by one: one line each flooded the activity log); a timer says what a window held back when it ends, and statuses() says what is left.
Why (13 Nov 2026, c04 pair run 43517140431): the held-back line waited for the next add; the employer stage had ended, so the board jobs imported at 60 s were said at no time
before the run's end at 175 s, and the Jobs list (which reads itself again on this line) showed them up to ~110 s late.
"""
import threading
import time

from . import store
from .press import step_yield

EVERY = 5
# The Find jobs step each label of a landing batch is credited to (src/press/step_yield.py); a caller whose label covers other steps too names its own (free_job_apis).
STEP_OF = {'employer sites': 'employer_sites', 'job boards': 'job_boards'}


def _timer(delay, fn):
    """Calls `fn` after `delay` seconds in a thread of its own; -> the timer (`cancel()`)."""
    timer = threading.Timer(delay, fn)
    timer.daemon = True
    timer.start()
    return timer


def _key(job):
    return job.get('url') or f"{job.get('company')}|{job.get('id')}"


class SoFar:
    def __init__(self, db, say=print, every=EVERY, clock=time.monotonic, later=_timer):
        self.db, self.say, self.first = db, say, {}
        self.every, self.clock, self.said_at, self.pending = every, clock, None, {}
        self.later, self.timer, self.lock = later, None, threading.RLock()   # the timer's flush runs in a thread of its own: pending and said_at change under the lock

    def add(self, jobs, where, step=None):
        """Import these jobs now; the first status each one got is kept for the end. `step`: the Find jobs step that brought them (src/press/step_yield.py)."""
        statuses = store.import_watch_report(self.db, {'jobs': jobs})
        if step or where in STEP_OF:
            step_yield.landed(step or STEP_OF[where], jobs, statuses)
        for job, status in zip(jobs, statuses):
            self.first.setdefault(_key(job), status)
        new = sum(status == 'new' for status in statuses)
        if new:
            with self.lock:
                self.pending[where] = self.pending.get(where, 0) + new
                if self.said_at is None or self.clock() - self.said_at >= self.every:
                    self.flush()
                elif self.timer is None:   # held back: the window's end says it, whether or not another source adds
                    self.timer = self.later(max(self.every - (self.clock() - self.said_at), 0), self.flush)

    def flush(self):
        """Say the new jobs not yet said, one line per source kind, the newest last."""
        with self.lock:
            if self.timer is not None:
                self.timer.cancel()
                self.timer = None
            for where, new in self.pending.items():
                self.say(f'Jobs so far: {new} new from {where}')
            if self.pending:
                self.said_at = self.clock()
            self.pending = {}

    def listener(self, where, step=None):
        """on_jobs for feeds.scan / aggregators.scan; a failure here never stops the search (the final import does it all)."""
        def on_jobs(jobs):
            try:
                self.add(jobs, where, step)
            except Exception as error:  # noqa: BLE001
                self.say(f'Warning: jobs not shown early: {type(error).__name__}: {error}')
        return on_jobs

    def statuses(self, report, imported):
        """The final import's statuses, with each job shown early keeping the status it got then (a second import says "seen")."""
        self.flush()
        return [self.first.get(_key(job), status) for job, status in zip(report.get('jobs') or [], imported)]
