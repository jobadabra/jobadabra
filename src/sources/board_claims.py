"""One early read per job board per Find jobs press: the board a first read took is not read early again by another lane.
Why (14 Nov 2026, sa, #4139): a first search read alo.bg twice, once from the first-jobs slice ("alo.bg", 14 s to 79 s) and once from the web search's
group ("ALO.bg", 57 s to 85 s); the two names have one host, and nothing recorded a read still running: found_boards._early only holds FINISHED reads.
Design: a board is one host (found_boards keeps every board by it); an early read of it (the slice, the boards lane, the boards named meanwhile) takes
the host when it starts; a later early read of the same host in this press leaves it out and says so; the full read (not early) is never held back,
it takes the early read's pages (found_boards._early) as before. Without a press (JOBADABRA_SEARCH_AT unset: a CLI run, a unit test) nothing is held.
Tests: tests/unit/sources/test_board_claims.py."""
import os
import threading

from ..time_budget import SEARCH_AT

_LOCK = threading.Lock()
_CLAIMED = {'press': None, 'hosts': {}}   # {'press': the press's start, 'hosts': {host: the name it was taken under}}


def _hosts():
    """The hosts this press took, or None without a press; a new press (another start time) starts empty."""
    press = os.environ.get(SEARCH_AT) or None
    if press is None:
        return None
    if _CLAIMED['press'] != press:
        _CLAIMED['press'], _CLAIMED['hosts'] = press, {}
    return _CLAIMED['hosts']


def take(board, early=True):
    """True when this read may read `board`: not an early read, no press, or the first early read of its host in this press (which takes it)."""
    with _LOCK:
        taken = _hosts() if early else None
        if taken is None:
            return True
        if board['host'] in taken:
            print(f"Job boards: {board['name']} is already being read in this search (as {taken[board['host']]}); not read twice", flush=True)
            return False
        taken[board['host']] = board['name']
        return True


def first(boards, early=True):
    """`boards` that this early read takes, in order (a host repeated in the list is read once)."""
    return [board for board in boards if take(board, early)]


def free(boards, early=True):
    """`boards` not taken yet, taking none: the spares, which are taken only when one is read in place of a refusing board (take)."""
    with _LOCK:
        taken = _hosts() if early else None
        return list(boards) if taken is None else [board for board in boards if board['host'] not in taken]
