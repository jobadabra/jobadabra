"""Job boards as one reader: the boards' jobs as read (Listed), group by group in today's board order, never kept, sorted, scored or judged here
(contract C3 of docs/superpowers/specs/2026-11-10-find-jobs-code-shape.md, cr 3/5).
Why (sa, 10 Nov 2026, option B): the boards' first read also decided what is kept (src/sources/boards_first.py called aggregators.kept and
feeds.triage), so a change in how a board is read moved what the run kept. What is kept, and when each phase runs (a first press after its
slice, a repeat press beside the employer sites, ahead of aggregators.scan, the rest) is the run core's: until session sf's cutover moves those
calls into src/daily_search.py, boards_first keeps them around this reader. Moved here from boards_first._groups and _fetch, a pure move.
Invariants: groups come in today's order (the boards that gave this field jobs before, at once; then what the web search found that is not
among them); the "Job boards first: reading ..." lines are the ones the Find jobs card reads (desktop/renderer/find-card-model.js).
Tests: tests/unit/sources/test_board_reader.py."""
from ..press import budget

WEB_WAIT = budget.value('boards_first.WEB_WAIT')   # seconds the boards' first read waits for the run's web search (the same budget row as boards_first's)


def read(run, search, early=False, since=None, wait=WEB_WAIT, where='before', on_board=None):
    """(said, Listed jobs) groups of the found boards for `search`. early: each kind of board's first pages, one group per kind (see the
    header), waiting up to `wait` s for the web search between them; `where` ('before' / 'beside') names the employer read it runs against in
    the log. Else the full read, one group (since: the boards read since then are skipped, board_yield.not_read_since). on_board(jobs): each early
    board round's jobs as soon as that round is read (found_boards.read); its group still comes whole when it ends, in the list's order.
    run: the Run of src/press/run.py; nothing is read from it yet.
    TODO(AI): board_web's early read and searched set move onto run.reads['job boards'] once the Run is on main (#3679)."""
    if not early:
        from . import found_boards
        yield 'the found boards', found_boards.read(search, since=since)
        return
    for said, boards in _groups(search, wait):
        yield said, _fetch(search, boards, said, where, on_board)


def _groups(search, wait):
    """(said, boards) in read order: the boards that gave jobs in this field before, at once; then, once the web search answers (up to `wait` s), what
    it found that is not among them."""
    from ..ai import board_ideas
    from . import board_web, board_yield
    known = board_yield.working(search, board_ideas.load().get('boards') or {})
    if known:
        yield f'the {len(known)} that gave you jobs in this field before', known
    hosts = {board['host'] for board in known}
    found = [board for board in board_web.found_first(search, wait) if board['host'] not in hosts]   # the web search ran meanwhile
    if found:
        yield f'the {len(found)} the web search found', found


def _fetch(search, boards, said, where, on_board=None):
    """These boards' first pages read (found_boards early), said in the log the Find jobs card reads (desktop/renderer/find-card-model.js)."""
    from . import found_boards
    print(f"Job boards first: reading {said}, {where} the employer sites: {', '.join(board['name'] for board in boards)}", flush=True)
    return found_boards.read(search, boards, web=False, early=True, on_board=on_board)
