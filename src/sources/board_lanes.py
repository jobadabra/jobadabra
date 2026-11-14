"""The lanes a search's job boards are read in: a board takes one before it reads and gives it back when it ends; a board that sends nothing for
QUIET_S gives its lane to the next board (issue #4255).
Why (xc, 14 Nov 2026): in 61 CI searches a board read from the first seconds stopped sending requests and held its lane to the search's end (c02
Vienna 5 of 5 searches, c04 Madrid 2 of 3, d03 Chisinau 2 of 3); d03's rabota.md sent its last request at +21.8 s and was cut at 124 s, while the same
board on an identical search read on to +226 s. Its cause is not named yet (two Mac searches did not stall): this is a bound on the lane, not a fix of it.
Design: one Lanes per found_boards.read; its states, owned here only: a board is waiting (for a lane), reading (holds one; each request touches it),
quiet (reading, nothing sent for QUIET_S: its lane is given to the next board, the board is named in `freed`), ended (gave its lane back, once).
A quiet board's thread is not stopped (Python cannot): if it ends before the search's cut its jobs are kept as any board's. No watcher thread and
no timer: a board waiting for a lane looks for quiet ones each time it would wait. At most `n` boards read at once besides the quiet ones.
A host that refused (401/403, a bot check, a sign-in page: the read's 'browser' state) is put in the search's refused set (its clock's, Run.clock)
and no read of the same search asks it again, on any of its pages (CLAUDE.md: never retry a 401 or 403). Nothing else is kept between reads: two
pages of one host are both read (d03, 14 Nov 2026: delucru.md's pack page and its web search page gave different jobs), and the full read goes on
from the pages a lane board fetched (found_boards._early).
Tests: tests/unit/sources/test_board_lanes.py, tests/unit/sources/test_board_lane_read.py."""
import bisect
import itertools
import threading
import time

# Why (xc, 14 Nov 2026, #4255): a hang guard, not a judgment of a slow site: rabota.md's requests came 1-15 s apart on a healthy read (its link
# questions took 14 s between two requests), so a board that keeps asking within 20 s keeps its lane (sa: a request every 15 s is not quiet).
QUIET_S = 20
LOOK_S = 1   # how often a board waiting for a lane looks for a quiet one (a wait's slice, never a schedule)
NO_LANE, REFUSED = ((), 'no lane', None), ((), 'refused before', None)   # a board's result when it was not read; () shares nothing between searches (Gitar, #4273)


class Lanes:
    """`n` lanes for one read's boards, keyed by board (a host); clock() gives seconds (time.monotonic); say(key) logs a freed board."""
    def __init__(self, n, quiet_s=None, clock=time.monotonic, say=None):
        self.n, self.quiet_s, self.clock, self.say = max(1, n), QUIET_S if quiet_s is None else quiet_s, clock, say
        self.cond, self.reading, self.freed, self.line, self.seq = threading.Condition(), {}, [], [], itertools.count()

    def take(self, key, wait=None, rank=0):
        """True once `key` holds a lane (its read may start); False when none came within `wait` s (None: as long as it takes). Boards take
        lanes by `rank` (their place in the read's list: known boards first), then in the order they asked; never in the order threads wake.
        Why (Gitar on #4284): a line kept in arrival order let a board whose thread started late wait behind boards listed after it."""
        until, me = None if wait is None else self.clock() + wait, (rank, next(self.seq))
        with self.cond:
            bisect.insort(self.line, me)
            try:
                while self.line[0] != me or len(self.reading) >= self.n:
                    self._free_quiet()
                    if self.line[0] == me and len(self.reading) < self.n:
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


def read_in_lane(lanes, host, wait, read, rank=0):
    """The one way a board of a search is read, first or spare: skip a host that refused earlier in the search (REFUSED), take a lane of
    `lanes` within `wait` s by `rank` (NO_LANE: none came, nothing was asked), `read(host)`, give the lane back; a 'browser' answer (401/403,
    a check, a sign-in page) puts the host in the search's refused set, so no read of the search asks it again (CLAUDE.md)."""
    from .. import time_budget
    refused = time_budget.CLOCK.refused_hosts   # the search's (src/press/clock.py start); None: no search clock, nothing kept
    if refused is not None and host in refused:
        return REFUSED
    if not lanes.take(host, wait=wait, rank=rank):
        return NO_LANE
    try:
        result = read(host)
    finally:
        lanes.give_back(host)
    if refused is not None and result[1] == 'browser':
        refused.add(host)
    return result
