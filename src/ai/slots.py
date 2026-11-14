"""The AI command-line engines' slots (Claude Code, Codex: processes at once) served by priority, then by arrival: the title batches and the place call
that decide which jobs are yours TITLES, a first press's local boards (their reads and proposal) FIRST, the scores of the jobs this run found SCORE, every other call NORMAL, the board web search and the scores of earlier runs' jobs LATER. A thread's level is set with priority(); a pool
thread takes its caller's level only through carry(). Used by src/ai/providers/cli_base.py; set by src/first_jobs.py, src/sources/found_boards.py
and src/sources/board_web.py. Tests: tests/unit/ai/test_ai_slots.py.
Why (#first-press-slots, owner, 27 Oct 2026: "Web search, combined with more AI slots, combined with local boards first"): on rerun 40450152414
the board reads' calls waited 13-24 s each behind the web search's 25 s call, and the read cut (67 s) came first.
Why SCORE (ts, 10 Nov 2026, owner asked via AskUserQuestion: night 9 Nov): a score call took 9-10 s with at most 2 other AI calls in flight and 32 s with 6 or more (31 of
59 started with 6+), all at NORMAL; a job that is already Kept is one call from a score, so its call goes before the calls that only bring more jobs."""
import contextlib
import itertools
import os
import threading
import time

from ..press import rank as order   # this file has its own rank()

TITLES, FIRST, SCORE, NORMAL, LATER = 0, 1, 2, 3, 4
NAMES = ('TITLES', 'FIRST', 'SCORE', 'NORMAL', 'LATER')
# Why TITLES (lanes 4b-1, owner, 11 Nov 2026, via sa: "Start it right away."): a title batch judges ~30 jobs in one 5-13 s call, yet it queued at
# NORMAL with the page- and link-kind calls (13-20 s each, about two thirds of a search's calls): p10 left "81 title(s) wait" at 116 s while
# those ran to 118 s. Every reader's titles share this one level (owner, 5 Nov 2026: "One clear order first").
# Why first of all (sa, 11 Nov 2026, local p10 search): behind the boards' reads (FIRST) and the scores, two title batches asked at 23-26 s waited 42 s for a slot;
# a batch is the cheapest call of a search (3-9 s) and decides ~30 jobs, and every job a score could take comes out of one.
_local = threading.local()
_BORN = time.monotonic()   # the engine process's start, near enough: a Find jobs run is one process


def level():
    """The calling thread's level (NORMAL unless priority() set it)."""
    return getattr(_local, 'level', NORMAL)


@contextlib.contextmanager
def priority(at):
    """Inside the block, this thread's AI calls queue at level `at` (FIRST, SCORE, NORMAL or LATER); the previous level comes back after it, also on
    an exception. Only this thread: a pool thread it starts takes the level through carry()."""
    before = level()
    _local.level = at
    try:
        yield
    finally:
        _local.level = before


def lane():
    """The end of the reading lane the calling thread is in (in_lane), None outside one (src/sources/read_budget.py cut_at reads it)."""
    return getattr(_local, 'lane', None)


def go_on():
    """The wait a board read in the calling thread's lane calls before it goes on past its first jobs (in_lane's `after`), None: at once."""
    return getattr(_local, 'after', None)


@contextlib.contextmanager
def in_lane(end, after=None):
    """Inside the block, this thread's site reads end at `end` (a monotonic time), not at the employer sites' read cut; None: the cut again.
    after(seconds): returns when the lane's boards may go on past their first jobs (src/sources/board_pages.py held), at most `seconds`.
    Only this thread: a pool thread it starts takes the lane through carry(), as it takes the level.
    Why (lanes 4a, 11 Nov 2026): kept beside the level on the thread's one context, not in a container of its own (contract C1,
    tests/guards/rules/test_run_state_only_shrinks.py): both are the calling thread's, and carry() is their one way into a pool."""
    before = lane(), go_on()
    _local.lane, _local.after = end, after
    try:
        yield
    finally:
        _local.lane, _local.after = before


def rank():
    """The calling thread's order inside its level (a tuple; none = first): the title queue sets the nearness of the batch it asks, so a near batch takes a free slot before a far one that was popped earlier."""
    return getattr(_local, 'rank', ())


@contextlib.contextmanager
def ranked(at):
    """Inside the block this thread's slot tickets sort by `at` within their level (#2918)."""
    before = rank()
    _local.rank = at
    try:
        yield
    finally:
        _local.rank = before


def waited(reset=False):
    """The seconds this thread has waited for a slot since the last reset, or None when it entered no slot (an engine that calls the SDK directly has none: its wait is unknown, never 0)
    (src/ai/call_log.py reads it around one call); `reset=True` returns it and starts again."""
    seconds = getattr(_local, 'waited', None)
    if reset:
        _local.waited = None
    return seconds


def carry(fn, at=None):
    """`fn` to run in another thread (a pool's) at level `at`, by default the level of the thread that calls carry(), and in its reading lane
    (in_lane), so a board's pool threads end where the job boards' lane ends."""
    at, end, after = level() if at is None else at, lane(), go_on()   # a lane's reads end at its own end in every thread it starts

    def run(*args, **kwargs):
        with priority(at), in_lane(end, after):
            return fn(*args, **kwargs)
    return run


class Slots:
    """A semaphore of `n` slots handing a free one to the waiting caller with the lowest level, then the earliest. `with slots:` holds one."""

    def __init__(self, n):
        self.n, self.free = n, n
        self._cond = threading.Condition()
        self._queue = []
        self._order = itertools.count()

    def waiting(self):
        with self._cond:
            return len(self._queue)

    def __enter__(self):
        ticket = order.slot_ticket(level(), rank(), next(self._order))
        asked = time.monotonic()
        with self._cond:
            order.push(self._queue, ticket)
            try:
                while not (self.free and self._queue[0] == ticket):
                    self._cond.wait()
            except BaseException:
                self._queue.remove(ticket)
                order.reorder(self._queue)
                self._cond.notify_all()
                raise
            order.pop(self._queue)
            self.free -= 1
            if self.free:   # the next in line may take another free slot
                self._cond.notify_all()
        got = time.monotonic()
        _local.waited = (getattr(_local, 'waited', None) or 0.0) + got - asked
        if os.environ.get('JOBADABRA_SLOT_LOG') == '1':
            try:
                _say(ticket, got - asked, got - _BORN, self.n - self.free, self.n)
            except (OSError, TypeError, ValueError):   # a by-hand measure line never fails the AI call it measures (code review: a closed pipe, an odd rank)
                pass
        return self

    def __exit__(self, *exc):
        with self._cond:
            self.free += 1
            self._cond.notify_all()
        return False


def _say(ticket, waited, at, busy, n):
    """One run-log line for a slot taken: the ticket (level, rank, arrival), its wait and the second it started. Numbers only: a rank part that is not a number prints as '?'.
    Why (sf 2/8, 10 Nov 2026, sa's Mac runs): a title batch waited 33 s for a free slot on p9 and the order of the tickets was not in any log; this is the measure for it,
    off unless JOBADABRA_SLOT_LOG=1 (a by-hand run; never set for a user)."""
    level, rank, arrival = ticket
    parts = ', '.join(f'{part:g}' if isinstance(part, (int, float)) and not isinstance(part, bool) else '?' for part in (rank if isinstance(rank, tuple) else (rank,)))
    name = NAMES[level] if 0 <= level < len(NAMES) else str(level)
    print(f'Slot: {name} rank ({parts}) arrival {arrival} waited {waited:.1f} s started at {at:.1f} s ({busy}/{n} busy)', flush=True)
