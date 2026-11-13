"""One log line per round of a job board's read (one search word in one place: found_boards._read): what it asked and what it found.
Why (rs, 13 Nov 2026, sa's go): two benchmark runs on the same code read the same board with very different results (alo.bg 25 jobs vs 0 for
Sofia's truck driver, pracuj.pl 1 vs 28 for Krakow's cook) and the log could not say why: it printed only the board's end. Log only: no
behaviour, no AI call; the board's name, its search words and its place words are already in the log.
Tests: tests/unit/sources/test_board_round_log.py."""
import time


def said(board, term, place, started, jobs_before, found=None, how='', error=None):
    """Print one round of `board`'s read: its words and place, the page's jobs and how many are new to this read, how the page was read, and
    its seconds since `started` (time.monotonic()); `error` (an HTTP code or a short reason) when the page was not read."""
    asked = f"'{term}'" + (f" in {place}" if place else '')
    took = f'{time.monotonic() - started:.0f} s'
    if error is not None:
        print(f"Job boards: {board.get('name') or board.get('host')} round {asked}: page not read ({error}), {took}", flush=True)
        return
    seen = {job.get('url') for job in jobs_before}
    new = sum(1 for job in found or [] if job.get('url') not in seen)
    print(f"Job boards: {board.get('name') or board.get('host')} round {asked}: {len(found or [])} job(s) on the page, {new} new"
          f"{', ' + how if how else ''}, {took}", flush=True)
