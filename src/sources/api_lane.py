"""The free job APIs' lane: every due API is asked at the press's start, each in its own thread, beside the employer sites and the boards
(lanes 3/5, #3754; design: WP8 of docs/superpowers/specs/2026-11-10-find-jobs-finish-line.md, rules 1 and 4). The threads only fetch; the
thread that owns the job cache keeps their jobs (aggregators.scan takes each read, `take`). EURES and the boards the web search found start
at second 0 through their own early reads (eures.start_early, boards_ahead), so they are not started here.
Why (sf, 11 Nov 2026): the APIs were asked one after another once the employer sites had ended, past the read cut, so they read nothing:
0 jobs for 14 of 14 people in the night 42927975750 (EURES off), "Time is up" on 28 of 32 first presses of the yardstick replays.
Each read's locations are placed and its titles judged in its own thread as soon as it is read (lanes 4b-1; places: WP8 4/5, #3754), as the boards' lane does:
the stage keeps them with that thread's answers. Invariants: a read never touches the job cache; `take` waits no later than the read cut; a read that raises is that source failing, never the run.
Tests: tests/unit/press/test_lanes.py, tests/unit/sources/test_api_lane.py."""
import os
from concurrent.futures import ThreadPoolExecutor, wait

from .. import read_methods, time_budget
from ..ai import slots

NOT_HERE = ('EURES',)   # read from second 0 by its own early read (eures.start_early); the found boards: boards_ahead.NAME


class Lane:
    """The started reads: name -> future of the jobs as listed."""

    def __init__(self, reads, pool):
        self.reads, self._pool = reads, pool
        self.taken = set()   # the names whose read was handed over (a result is taken once: the scan, else aggregators.keep_late)

    def take(self, name, until):
        """(the jobs `name` listed, its reader's answers: src/ai/batch_scope.py current()), once its read ended; None while it is still reading at
        `until` (time.monotonic(), the read cut; None: wait for it). Raises the read's own error."""
        future = self.reads[name]
        wait([future], timeout=None if until is None else max(0.0, until - time_budget.now()))
        if not future.done():
            return None
        self.taken.add(name)
        return future.result()

    def close(self):
        """No new read starts; one still reading is not waited for (the process's end bounds it, src/run_exit.py). Results stay takeable after close: every read is submitted at once
        (max_workers = the reads), so none is pending to be cancelled, and aggregators.keep_late takes the late ones after the gather has closed the lane (tests/unit/sources/test_api_lane.py)."""
        self._pool.shutdown(wait=False, cancel_futures=True)


def start(db, search, now=None, readers=None):
    """A Lane reading every due free API now, or None when nothing is due (the fixture mode reads no live site, as aggregators.scan).
    readers: [(name, read)] in the table's order (default: aggregators.sources())."""
    from . import aggregators, boards_ahead
    if readers is None and os.getenv('JOBADABRA_FIXTURE_DIR'):
        return None
    now = now or time_budget.wall()
    db.execute(aggregators.TABLE)
    due = [(name, read) for name, read in (readers if readers is not None else aggregators.sources())
           if name not in NOT_HERE and name != boards_ahead.NAME and not aggregators.read_lately(db, name, now, search)]
    if not due:
        return None
    pool = ThreadPoolExecutor(max_workers=len(due), thread_name_prefix='free-api')
    return Lane({name: pool.submit(slots.carry(_read), name, read, search) for name, read in due}, pool)


def _read(name, read, search):
    """(One API's jobs as listed, counted as a feed read (src/read_methods.py), a copy of its reader's answers once their titles are judged).
    Why (lanes 4b-1, owner, 11 Nov 2026, via sa: "Start it right away."): the stage judged these titles only when it kept them, at 68-108 s, past
    the titles' stop (src/ai/title_triage.py _may_start): 0 of 600-890 jobs judged for 7 of 7 people. Judged here, they are asked from the read's end
    (seconds), in title_queue's one nearest-first order with every other reader's titles."""
    import copy
    from ..ai import batch_scope
    from . import feed_places
    with read_methods.reading(name, 'feed_api') as counted:
        found = read(search)
        counted.jobs = read_methods.in_places(found)
    with batch_scope.reader(f'free job API: {name}'):   # its answers its own until kept, as the boards' lane (boards_first.Beside._read)
        # Why (#3754, wj, WP8 rule 7; owner, 12 Nov 2026, asked via AskUserQuestion: "Places that unlock most first (Recommended)"): titles only, so a job at a location nobody had
        # placed never became known: p10 on main, 695 of 708 waiting API jobs (Jobicy 250 jobs at 38 locations, "Remote (Europe)" among them), press after press. The place call
        # asks the locations that decide the most jobs first (feed_places._place), as every other reader's does.
        feed_places.triage_with_places(found)
        return found, copy.deepcopy(batch_scope.current())
