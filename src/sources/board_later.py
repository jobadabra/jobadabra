"""Boards that join a board read while it runs: the ones the AI names beside the measured boards of a first search
(src/sources/found_boards.py read `later`, src/first_jobs.py board_jobs). One read, one board memory, one save: never a second read.
Tests: tests/unit/sources/test_proven_boards.py (FirstSliceTests)."""
from concurrent.futures import ThreadPoolExecutor

from ..ai import slots


def named(later, join):
    """{the future of the boards named later: join} for read_budget.as_done, {} when none are awaited. later() runs in its own thread, at the
    read's AI level and in its lane, and ends by the search's read cut (its caller's wait does)."""
    if later is None:
        return {}
    waiter = ThreadPoolExecutor(max_workers=1, thread_name_prefix='boards-named-later')
    future = waiter.submit(slots.carry(later))
    waiter.shutdown(wait=False)
    return {future: join}


def join(named, pick, hosts, free, start):
    """The futures of the boards named later that join the read: picked like the first ones, not being read already, as many as places are left."""
    new = [board for board in pick(named or []) if board['host'] not in hosts][:max(0, free)]
    started = [(board, start(board)) for board in new]   # start gives None for a board another read took meanwhile: it is not said, not read
    if any(future is not None for _, future in started):
        print(f"Job boards: also reading {', '.join(board['name'] for board, future in started if future is not None)}, named for your search meanwhile", flush=True)
    return [future for _, future in started if future is not None]


def start(read_item, reads, hosts, order, by_turn, futures, submit):
    """One more board joins a read that is running: its turn comes after the boards already in the list. -> its future."""
    reads.append(read_item)
    hosts.add(read_item[0]['host'])
    order[id(read_item)] = len(by_turn)
    by_turn.append([])
    future = submit(read_item)
    futures[future] = read_item
    return future
