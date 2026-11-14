"""Boards that join a board read while it runs: the ones the AI names beside the measured boards of a first search
(src/sources/found_boards.py read `later`, src/first_jobs.py board_jobs), and the spares read in place of a refusing board, kept at its turn
(kept_spares, hand: moved from found_boards.py as they were, 14 Nov 2026). One read, one board memory, one save: never a second read.
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


def join(named, pick, hosts, free, start, why=lambda board: None, taken=()):
    """The futures of the boards named later that join the read: picked like the first ones, not being read already, as many as places are left.
    Why (14 Nov 2026, sa, c02 Vienna: karriere.at proposed first, never read, no log line): a board named and not started said nothing; the log now says, for each named
    board in the order it came, whether it started or why not (taken: who holds the places)."""
    named = list(named or [])
    chosen = pick(named)
    new = [board for board in chosen if board['host'] not in hosts][:max(0, free)]
    started = {board['host'] for board in new}
    chosen_hosts = {board['host'] for board in chosen}
    print(f"Job boards named later: places left {max(0, free)}, held by {', '.join(taken) or 'none'}", flush=True)
    for place, board in enumerate(named, 1):
        reason = ('started' if board['host'] in started else 'already being read in this search' if board['host'] in hosts else why(board)
                  or ('no place left' if board['host'] in chosen_hosts else 'not picked (enough boards read or untried boards limited)'))
        print(f"Job boards named later: {place}. {board['name']} ({board['host']}): {reason} [rank {board.get('rank')}, counted right {board.get('right_best')}, "
              f"fit 70+ {board.get('rank_fit70')}, browser {bool(board.get('browser'))}]", flush=True)
    if new:
        print(f"Job boards: also reading {', '.join(board['name'] for board in new)}, named for your search meanwhile", flush=True)
    return [start(board) for board in new]


def start(read_item, reads, hosts, order, by_turn, futures, submit):
    """One more board joins a read that is running: its turn comes after the boards already in the list. -> its future."""
    reads.append(read_item)
    hosts.add(read_item[0]['host'])
    order[id(read_item)] = len(by_turn)
    by_turn.append([])
    future = submit(read_item)
    futures[future] = read_item
    return future


def kept_spares(taken, lock, read_items, keep):
    """Keep, right after each of `read_items`, the boards read in its place (taken: {host: [(spare item, result)]}), in the order they were read.
    Why (12 Nov 2026): they were kept after the whole read loop, which waits for the slowest board up to the cut: a replacement read at 19 s
    reached the title judge at 124 s, after its AI time was gone, and its titles went unjudged. Each board's replacements follow it in its turn."""
    for read_item in read_items:
        with lock:
            chain = taken.pop(read_item[0]['host'], [])
        for spare_item, result in chain:
            keep(spare_item, result, read_item)


def hand(turn, found, on_board):
    """One kept board's jobs: kept at its turn in the list (turn), and handed to on_board(jobs) at once when given and not empty."""
    turn.extend(found)
    if on_board is not None and found:
        on_board(found)


def read_on_kept(board, search, more):
    """A lane board's read-on (found_boards.read_board) ended with `more`: judged as found_boards.read's keep judges a board's jobs (places, then
    titles), counted in the run and added to the board's memory beside its slice's, then returned (placed) for the lane.
    Why (Gitar, #4218): kept at its slice, a board whose relevant jobs came from its other words and next pages was remembered as yielding
    none (board_yield.pick may drop it next run), and the run's counts left the read-on's jobs out."""
    from .. import run_counts
    from ..ai import board_ideas
    from . import board_yield
    if not more:
        return more
    relevant = board_yield.is_relevant(more)
    with board_ideas.STORE:   # one load-change-save, as board_ideas.keep_board: the slice's keep and board_web write the file beside it
        data = board_ideas.load()
        entry = data.get('boards', {}).get(board['host'])
        if entry is not None:   # the slice's keep wrote it; a board read by no keep (a test's read_board) has none
            board_yield.record(entry, (entry.get('jobs') or 0) + len(more), (entry.get('relevant') or 0) + len(relevant), 'ok')
            board_yield.paid(entry, len(relevant), search)
            board_ideas.save(data)
    print(f"Job boards found: {board['name']} read on: {len(more)} more job(s), {len(relevant)} relevant", flush=True)
    run_counts.looked(more)
    run_counts.matched(relevant)
    return more
