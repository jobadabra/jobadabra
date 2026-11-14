"""One log line per round of a job board's read (one search word in one place: found_boards._read): what it asked and what it found.
Why (rs, 13 Nov 2026, sa's go): two benchmark runs on the same code read the same board with very different results (alo.bg 25 jobs vs 0 for
Sofia's truck driver, pracuj.pl 1 vs 28 for Krakow's cook) and the log could not say why: it printed only the board's end. Log only: no
behaviour, no AI call; the board's name, its search words and its place words are already in the log.
Each line also says where the round's seconds went (sa, 13 Nov 2026): the benchmark's logs showed a board's first page costing 18 to 93 s and
could not say whether the page, its job pages or an AI question took them. A round makes its Parts and hands part() to the page reader; a pool's
fan-out counts as the wall time its caller waited.
Tests: tests/unit/sources/test_board_round_log.py."""
import contextlib
import time
import urllib.error


class Parts:
    """One round's parts, {name: seconds} in the order they ran: made by the round (found_boards._read) and handed to what it calls, so no
    state lives outside the round."""

    def __init__(self):
        self.seconds = {}

    @contextlib.contextmanager
    def part(self, name):
        """Time one part of the round under `name` ('page', 'job links', 'N job pages', 'postings', 'AI reader'); the same name adds up."""
        started = time.monotonic()
        try:
            yield
        finally:
            self.seconds[name] = self.seconds.get(name, 0.0) + time.monotonic() - started

    def said(self):
        """' (page 2 s · 19 job pages 31 s)' for the parts of 1 s and more; '' with none."""
        long = [f'{name} {seconds:.0f} s' for name, seconds in self.seconds.items() if seconds >= 1]
        return f" ({' · '.join(long)})" if long else ''


class Stalled(TimeoutError, urllib.error.URLError):
    """A page not read because the wait ran out, with the phase that stalled in its word (`why`): 'connecting', 'waiting for the answer' (the site
    took the connection and never answered), 'reading the page' (it answered, then stopped sending), or the search's own read cut (no page asked).
    Both bases, so a caller that catches TimeoutError, URLError or OSError keeps working.
    Why (14 Nov 2026, sa, StepStone read from CI): every one of these printed the bare "TimeoutError", so a site that stalled 20 s could not be told
    from the search's own cut (0 s) nor from the phase that stalled."""

    def __init__(self, phase, seconds=None):   # seconds: the wait as measured from the start of the read, None for the read cut (no page asked)
        urllib.error.URLError.__init__(self, phase)
        self.phase, self.seconds = phase, seconds


def why(error):
    """The short reason a round's page was not read: the phase of a `Stalled` wait, else the error's class name (NameNotResolved and an HTTP code are told by the caller)."""
    if not isinstance(error, Stalled):
        return type(error).__name__
    if error.seconds is None:
        return f'not asked, {error.phase}'
    return f"timed out {error.phase} ({error.seconds:.0f} s)" if error.seconds >= 1 else f"timed out {error.phase} ({error.seconds:.1f} s)"   # the wait as measured, not the socket limit (Gitar, #4177)


UNCOUNTED = object()   # Why (Gitar on #4052): the search form way hands back only a relevant read, so a "0 job(s)" for it would be made up


class Ladder:
    """One board's walk up the read ladder (found_boards._another_way): after each way, one line with the way, the jobs it listed and its seconds,
    so a board that cost 40 s over four ways that gave nothing is told from one that cost 40 s in one.
    Why (13 Nov 2026, sa, fix #1 step 3 "log line first, measure, then move"): the log named only the way that worked, never the ways before it."""

    def __init__(self, board, clock=time.monotonic):
        self.name, self.clock = board.get('name') or board.get('host'), clock
        self.began = self.last = clock()

    def did(self, way, listed=None):
        """Say `way` ended with `listed` (the jobs it read; None: it did not run, nothing is said; UNCOUNTED: it ran and its jobs are not counted)."""
        now = self.clock()
        if way and listed is not None:
            count = 'jobs not counted' if listed is UNCOUNTED else f'{len(listed)} job(s) listed'
            print(f"Job boards found: {self.name} way '{way}': {count}, {now - self.last:.0f} s (ladder {now - self.began:.0f} s)", flush=True)
        self.last = now


@contextlib.contextmanager
def untimed(_name):
    """The part() of a page read outside a board round (an employer site's): nothing is timed."""
    yield


def said(board, term, place, started, jobs_before, found=None, how='', error=None, on_page=None, parts=None, link=None, rest=''):
    """Print one round of `board`'s read: its words and place, the first page's jobs (`on_page`; the full read also reads the next pages, counted
    apart), how many of all are new to this read, how the page was read, and its seconds since `started` (time.monotonic(), the next pages
    included) with the parts that took them; `error` (an HTTP code or a short reason) when the page was not read; `link`: the search link asked.
    Why (13 Nov 2026, sa): a board whose search page was the same whatever the words could not be told from the log, which never printed the link.
    rest: why no next page was read (board_pages.more), '' when they were or none was asked."""
    asked = f"'{term}'" + (f" in {place}" if place else '')
    took = f'{time.monotonic() - started:.0f} s' + (parts.said() if parts else '') + (f' · {link}' if link else '')
    if error is not None:
        print(f"Job boards: {board.get('name') or board.get('host')} round {asked}: page not read ({error}), {took}", flush=True)
        return
    seen = {job.get('url') for job in jobs_before}
    new = sum(1 for job in found or [] if job.get('url') not in seen)
    first = len(found or []) if on_page is None else on_page
    pages = f" ({len(found or [])} with its next pages)" if len(found or []) > first else ''
    print(f"Job boards: {board.get('name') or board.get('host')} round {asked}: {first} job(s) on the page{pages}, {new} new"
          f"{', ' + how if how else ''}{', ' + rest if rest else ''}, {took}", flush=True)


def page_seen(markup, url):
    """'the search page: N links, K the AI called job pages, U not judged' from the page's same-site links and the AI's verdicts already kept
    for them (page_words.kept_link_words: no AI call). Why (13 Nov 2026, sa): three Lisbon boards were read through their feed, and the log could
    not say whether their search page had job links the AI did not call jobs, links it never judged, or none at all."""
    from ..ai import page_words
    from . import careers_parse
    _, _, same = careers_parse.same_site(markup, url)
    verdicts = page_words.kept_link_words((text, parts.path) for _, text, parts in same)
    judged = [words for words in verdicts.values() if words is not None]
    return (f'the search page: {len(verdicts)} links, {sum(1 for words in judged if words.job_path)} the AI called job pages, '
            f'{len(verdicts) - len(judged)} not judged')
