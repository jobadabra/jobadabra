"""The AI command-line engines' slots (Claude Code, Codex: processes at once) served by priority, then by arrival: a first press's local boards
(their reads, titles and proposal) FIRST, the scores of the jobs this run found SCORE, every other call NORMAL, the board web search and the scores of earlier runs' jobs LATER. A thread's level is set with priority(); a pool
thread takes its caller's level only through carry(). Used by src/ai/providers/cli_base.py; set by src/first_jobs.py, src/sources/found_boards.py
and src/sources/board_web.py. Tests: tests/unit/ai/test_ai_slots.py.
Why (#first-press-slots, owner, 27 Oct 2026: "Web search, combined with more AI slots, combined with local boards first"): on rerun 40450152414
the board reads' calls waited 13-24 s each behind the web search's 25 s call, and the read cut (67 s) came first.
Why SCORE (ts, 10 Nov 2026, owner asked via AskUserQuestion: night 9 Nov): a score call took 9-10 s with at most 2 other AI calls in flight and 32 s with 6 or more (31 of
59 started with 6+), all at NORMAL; a job that is already Kept is one call from a score, so its call goes before the calls that only bring more jobs."""
import contextlib
import itertools
import threading
import time

from ..press import rank as order   # this file has its own rank()

FIRST, SCORE, NORMAL, LATER = 0, 1, 2, 3
_local = threading.local()


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
    """`fn` to run in another thread (a pool's) at level `at`, by default the level of the thread that calls carry()."""
    at = level() if at is None else at

    def run(*args, **kwargs):
        with priority(at):
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
        _local.waited = (getattr(_local, 'waited', None) or 0.0) + time.monotonic() - asked
        return self

    def __exit__(self, *exc):
        with self._cond:
            self.free += 1
            self._cond.notify_all()
        return False
