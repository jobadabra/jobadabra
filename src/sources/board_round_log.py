"""One log line per round of a job board's read (one search word in one place: found_boards._read): what it asked and what it found.
Why (rs, 13 Nov 2026, sa's go): two benchmark runs on the same code read the same board with very different results (alo.bg 25 jobs vs 0 for
Sofia's truck driver, pracuj.pl 1 vs 28 for Krakow's cook) and the log could not say why: it printed only the board's end. Log only: no
behaviour, no AI call; the board's name, its search words and its place words are already in the log.
Each line also says where the round's seconds went (sa, 13 Nov 2026): the benchmark's logs showed a board's first page costing 18 to 93 s and
could not say whether the page, its job pages or an AI question took them. A part is timed in the thread that reads the board (part()), from
begin() to said(); a pool's fan-out counts as the wall time its caller waited.
Tests: tests/unit/sources/test_board_round_log.py."""
import contextlib
import threading
import time

_ROUND = threading.local()   # this thread's round: {part: seconds}; a board is read by one thread, its pools are waited for there


def begin():
    """Start a round's parts in this thread: what an earlier read left here (an employer site's page read) is not this round's."""
    _ROUND.parts = {}


@contextlib.contextmanager
def part(name):
    """Time one part of the round under `name` ('page', 'job links', 'job pages', 'postings', 'AI reader'); the same name adds up."""
    started = time.monotonic()
    try:
        yield
    finally:
        parts = getattr(_ROUND, 'parts', None)
        if parts is not None:
            parts[name] = parts.get(name, 0.0) + time.monotonic() - started


def _parts():
    """' (page 2 s · job pages 31 s)' for the parts of 1 s and more, in the order they ran; '' with none. Ends the round's parts."""
    parts, _ROUND.parts = getattr(_ROUND, 'parts', None) or {}, None
    long = [f'{name} {seconds:.0f} s' for name, seconds in parts.items() if seconds >= 1]
    return f" ({' · '.join(long)})" if long else ''


def said(board, term, place, started, jobs_before, found=None, how='', error=None, on_page=None):
    """Print one round of `board`'s read: its words and place, the first page's jobs (`on_page`; the full read also reads the next pages, counted
    apart), how many of all are new to this read, how the page was read, and its seconds since `started` (time.monotonic(), the next pages
    included) with the parts that took them; `error` (an HTTP code or a short reason) when the page was not read."""
    asked = f"'{term}'" + (f" in {place}" if place else '')
    took = f'{time.monotonic() - started:.0f} s' + _parts()
    if error is not None:
        print(f"Job boards: {board.get('name') or board.get('host')} round {asked}: page not read ({error}), {took}", flush=True)
        return
    seen = {job.get('url') for job in jobs_before}
    new = sum(1 for job in found or [] if job.get('url') not in seen)
    first = len(found or []) if on_page is None else on_page
    pages = f" ({len(found or [])} with its next pages)" if len(found or []) > first else ''
    print(f"Job boards: {board.get('name') or board.get('host')} round {asked}: {first} job(s) on the page{pages}, {new} new"
          f"{', ' + how if how else ''}, {took}", flush=True)
