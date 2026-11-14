"""The lanes a search's job boards are read in: a board takes one before it reads and gives it back when it ends; a board that sends nothing for
QUIET_S gives its lane to the next board (issue #4255).
Why (xc, 14 Nov 2026): in 61 CI searches a board read from the first seconds stopped sending requests and held its lane to the search's end (c02
Vienna 5 of 5 searches, c04 Madrid 2 of 3, d03 Chisinau 2 of 3); d03's rabota.md sent its last request at +21.8 s and was cut at 124 s, while the same
board on an identical search read on to +226 s. Its cause is not named yet (two Mac searches did not stall): this is a bound on the lane, not a fix of it.
Design: one Lanes per found_boards.read; its states, owned here only: a board is waiting (for a lane), reading (holds one; each request touches it),
quiet (reading, nothing sent for QUIET_S: its lane is given to the next board, the board is named in `freed`), ended (gave its lane back, once).
A quiet board's thread is not stopped (Python cannot): if it ends before the search's cut its jobs are kept as any board's. No watcher thread and
no timer: a board waiting for a lane looks for quiet ones each time it would wait. At most `n` boards read at once besides the quiet ones.
Tests: tests/unit/sources/test_board_lanes.py, tests/unit/sources/test_board_lane_read.py."""
import collections
import threading
import time

# Why (xc, 14 Nov 2026, #4255): a hang guard, not a judgment of a slow site: rabota.md's requests came 1-15 s apart on a healthy read (its link
# questions took 14 s between two requests), so a board that keeps asking within 20 s keeps its lane (sa: a request every 15 s is not quiet).
QUIET_S = 20
LOOK_S = 1   # how often a board waiting for a lane looks for a quiet one (a wait's slice, never a schedule)


class Lanes:
    """`n` lanes for one read's boards, keyed by board (a host); clock() gives seconds (time.monotonic); say(key, now) logs a freed board."""
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
                self.say and self.say(key, now)
        return quiet


def said(key, now):
    """The log line of a freed board (found_boards.read's say)."""
    print(f"Job boards: {key} sent nothing for {QUIET_S} s; its lane went to the next board (#4255)", flush=True)
