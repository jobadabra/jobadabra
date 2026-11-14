"""One early read per job board per Find jobs press: the board a first read took is not read early again by another lane.
Why (14 Nov 2026, sa, #4139): a first search read alo.bg twice, once from the first-jobs slice ("alo.bg", 14 s to 79 s) and once from the web search's
group ("ALO.bg", 57 s to 85 s); the two names have one host, and nothing recorded a read still running: found_boards._early only held FINISHED reads.
Design: a board is one host (found_boards keeps every board by it). The registry is found_boards._early, the early reads' hand-over, with no second
state beside it (tests/guards/rules/test_run_state_only_shrinks.py): an early read puts its host there when it STARTS (pages None) and fills it when
it ends; a later early read of a host that is there leaves it out and says so; the full read (not early) is never held back, it takes the pages as
before. Without a press (JOBADABRA_SEARCH_AT unset: a CLI run, a unit test) nothing is held. An entry older than `lapse` seconds is a past press's.
Tests: tests/unit/sources/test_board_claims.py."""
import os
import time

from ..time_budget import SEARCH_AT


class Claims:
    """The early reads' registry `held` ({host: (time taken, the pages it fetched, None while it is being read)}) read as claims: no state of its own."""

    def __init__(self, held, lapse):
        self.held, self.lapse = held, lapse

    def _live(self, host):
        entry = self.held.get(host)
        return entry is not None and time.monotonic() - entry[0] < self.lapse

    def take(self, board, early=True):
        """True when this read may read `board`: not an early read, no press, or the first early read of its host (which takes it, as being read)."""
        if not early or not os.environ.get(SEARCH_AT):
            return True
        mine = (time.monotonic(), None)   # None: being read, no pages yet; a finished read's entry holds its pages (found_boards keep)
        if self.held.setdefault(board['host'], mine) is mine:
            return True
        if not self._live(board['host']):   # a past press's entry: this read takes it over
            self.held[board['host']] = mine
            return True
        print(f"Job boards: {board['name']} is already being read in this search; not read twice", flush=True)
        return False

    def first(self, boards, early=True):
        """`boards` that this early read takes, in order (a host repeated in the list is read once)."""
        return [board for board in boards if self.take(board, early)]

    def free(self, boards, early=True):
        """`boards` not taken yet, taking none: the spares and the boards named later, taken only when one is read (take)."""
        if not early or not os.environ.get(SEARCH_AT):
            return list(boards)
        return [board for board in boards if not self._live(board['host'])]
