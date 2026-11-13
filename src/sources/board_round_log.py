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


@contextlib.contextmanager
def untimed(_name):
    """The part() of a page read outside a board round (an employer site's): nothing is timed."""
    yield


def said(board, term, place, started, jobs_before, found=None, how='', error=None, on_page=None, parts=None):
    """Print one round of `board`'s read: its words and place, the first page's jobs (`on_page`; the full read also reads the next pages, counted
    apart), how many of all are new to this read, how the page was read, and its seconds since `started` (time.monotonic(), the next pages
    included) with the parts that took them; `error` (an HTTP code or a short reason) when the page was not read."""
    asked = f"'{term}'" + (f" in {place}" if place else '')
    took = f'{time.monotonic() - started:.0f} s' + (parts.said() if parts else '')
    if error is not None:
        print(f"Job boards: {board.get('name') or board.get('host')} round {asked}: page not read ({error}), {took}", flush=True)
        return
    seen = {job.get('url') for job in jobs_before}
    new = sum(1 for job in found or [] if job.get('url') not in seen)
    first = len(found or []) if on_page is None else on_page
    pages = f" ({len(found or [])} with its next pages)" if len(found or []) > first else ''
    print(f"Job boards: {board.get('name') or board.get('host')} round {asked}: {first} job(s) on the page{pages}, {new} new"
          f"{', ' + how if how else ''}, {took}", flush=True)


def page_seen(markup, url):
    """'the search page: N links in W wordings, K the AI called job pages, U not judged' from the page's same-site links and the AI's verdicts
    already kept for them (decide.kept: no AI call). Why (13 Nov 2026, sa): three Lisbon boards were read through their feed, and the log could
    not say whether their search page had job links the AI did not call jobs, links it never judged, or none at all."""
    from ..ai import decide, page_words
    from . import careers_parse
    _, _, same = careers_parse.same_site(markup, url)
    wordings = list(dict.fromkeys(page_words._wording(text, parts.path) for _, text, parts in same))
    kept = decide.kept(page_words.LINK, wordings)
    jobs = sum(1 for wording in wordings if wording in kept and page_words.from_kind(kept[wording]).job_path)
    return f'the search page: {len(same)} links in {len(wordings)} wordings, {jobs} the AI called job pages, {len(wordings) - len(kept)} not judged'
