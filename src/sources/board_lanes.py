"""The lanes a search's job boards are read in: a board takes one before it reads and gives it back when it ends; a board that sends nothing for
QUIET_S gives its lane to the next board (issue #4255).
Why (xc, 14 Nov 2026): in 61 CI searches a board read from the first seconds stopped sending requests and held its lane to the search's end (c02
Vienna 5 of 5 searches, c04 Madrid 2 of 3, d03 Chisinau 2 of 3); d03's rabota.md sent its last request at +21.8 s and was cut at 124 s, while the same
board on an identical search read on to +226 s. Its cause is not named yet (two Mac searches did not stall): this is a bound on the lane, not a fix of it.
Design: one Lanes per found_boards.read; its states, owned here only: a board is waiting (for a lane), reading (holds one; each request touches it),
quiet (reading, nothing sent for QUIET_S: its lane is given to the next board, the board is named in `freed`), ended (gave its lane back, once).
A quiet board's thread is not stopped (Python cannot): if it ends before the search's cut its jobs are kept as any board's. No watcher thread and
no timer: a board waiting for a lane looks for quiet ones each time it would wait. At most `n` boards read at once besides the quiet ones.
One host, one read (claim): the search's early reads (the first-jobs slice's boards, the known boards' and the web search's groups) run side
by side, each with its own lanes; a host one of them took is not read again by another in the same search (d03, 14 Nov 2026: delucru.md
from the pack and DeLucru.md from the web search were read as two boards with two different search pages, and the two sides of an identical
search listed different jobs).
Tests: tests/unit/sources/test_board_lanes.py, tests/unit/sources/test_board_lane_read.py."""
import collections
import threading
import time

# Why (xc, 14 Nov 2026, #4255): a hang guard, not a judgment of a slow site: rabota.md's requests came 1-15 s apart on a healthy read (its link
# questions took 14 s between two requests), so a board that keeps asking within 20 s keeps its lane (sa: a request every 15 s is not quiet).
QUIET_S = 20
LOOK_S = 1   # how often a board waiting for a lane looks for a quiet one (a wait's slice, never a schedule)
NO_LANE, TAKEN = ((), 'no lane', None), ((), 'taken', None)   # a board's result when it was not read; () shares nothing between searches (Gitar, #4273)


class Lanes:
    """`n` lanes for one read's boards, keyed by board (a host); clock() gives seconds (time.monotonic); say(key) logs a freed board."""
    def __init__(self, n, quiet_s=None, clock=time.monotonic, say=None):
        self.n, self.quiet_s, self.clock, self.say = max(1, n), QUIET_S if quiet_s is None else quiet_s, clock, say
        self.cond, self.reading, self.freed, self.line = threading.Condition(), {}, [], collections.deque()

    def take(self, key, wait=None):
        """True once `key` holds a lane (its read may start); False when none came within `wait` s (None: as long as it takes). Boards take
        lanes in the order they asked (the list's order: known boards first), never in the order their threads wake."""
        until, me = None if wait is None else self.clock() + wait, object()
        with self.cond:
            self.line.append(me)
            try:
                while self.line[0] is not me or len(self.reading) >= self.n:
                    self._free_quiet()
                    if self.line[0] is me and len(self.reading) < self.n:
                        break
                    left = None if until is None else until - self.clock()
                    if left is not None and left <= 0:
                        return False
                    self.cond.wait(LOOK_S if left is None else min(LOOK_S, left))
                self.reading[key] = self.clock()
                return True
            finally:
                self.line.remove(me)
                self.cond.notify_all()

    def touch(self, key):
        """`key` sent a request (or got its answer): it is not quiet."""
        with self.cond:
            if key in self.reading:
                self.reading[key] = self.clock()

    def give_back(self, key):
        """`key` ended: its lane, unless a quiet board's was given to another already."""
        with self.cond:
            if self.reading.pop(key, None) is not None:
                self.cond.notify_all()

    def free_quiet(self):
        """The boards whose lanes were given now (quiet for quiet_s); the next waiting board takes them."""
        with self.cond:
            return self._free_quiet()

    def _free_quiet(self):
        now, quiet = self.clock(), []
        for key, last in list(self.reading.items()):
            if now - last >= self.quiet_s:
                del self.reading[key]
                quiet.append(key)
        if quiet:
            self.freed.extend(quiet)
            self.cond.notify_all()
            for key in quiet:
                self.say and self.say(key)
        return quiet


def said(key):
    """The log line of a freed board (found_boards.read's say)."""
    print(f"Job boards: {key} sent nothing for {QUIET_S} s; its lane went to the next board (#4255)", flush=True)


def open_search(lane):
    """The boards' lane `lane` of a new search began (boards_first.Beside): no host is taken yet. The claims are the run's, on its one clock
    (time_budget.CLOCK, Run.clock): contract C1, no module state on the search path (tests/guards/rules/test_run_state_only_shrinks.py)."""
    from .. import time_budget
    time_budget.CLOCK.board_hosts = {'lane': lane, 'hosts': {}}


def close_search(lane):
    """`lane` ended: reads after it (the scout's, a test's) claim nothing."""
    from .. import time_budget
    if (time_budget.CLOCK.board_hosts or {}).get('lane') is lane:
        time_budget.CLOCK.board_hosts = None


def claim(host, read):
    """True when `read` (any object naming one found_boards.read call) may read `host`: no other read of the open lane's search took it. No lane
    open (a read outside Find jobs' lane, tests): every read is its own. dict.setdefault is one step under the GIL: two reads asking at once get
    one owner."""
    from .. import time_budget
    open_ = time_budget.CLOCK.board_hosts
    if open_ is None:
        return True
    return open_['hosts'].setdefault(host, read) is read   # hosts come lowercase without www. (board_ideas._host)


def release(host, read):
    """`read` gives `host` back: it got no lane and read nothing, so another read of the search may read it (Gitar, #4268)."""
    from .. import time_budget
    open_ = time_budget.CLOCK.board_hosts
    if open_ is not None and open_['hosts'].get(host) is read:
        del open_['hosts'][host]


def read_in_lane(lanes, host, wait, read):
    """The one way a board of a search is read, first or spare (Design, #4273): claim `host`, take a lane of `lanes` within `wait` s, `read(host)`,
    give the lane back. TAKEN: another read of the search has the host. NO_LANE: no lane came, nothing was asked, so the claim is given back
    (Gitar, #4268: a kept claim left the host read by no one). A host that was asked stays claimed, read or refused: a 403 or a check is never
    asked again in the search (CLAUDE.md)."""
    if not claim(host, lanes):
        return TAKEN
    if not lanes.take(host, wait=wait):
        release(host, lanes)
        return NO_LANE
    try:
        return read(host)
    finally:
        lanes.give_back(host)
