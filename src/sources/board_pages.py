"""A board's search results read past page 1 (owner, 18 Oct 2026: "up to 5 pages"): StepStone listed 148 truck-driver jobs in Nuremberg on
11 pages and the read took 3 from page 1. The next page is found by structure, never per site: the page's own rel=next link, else its
numbered pages (careers_parse.page_links, the careers-page paging of 6 Oct 2026). Paging goes on only while the last page gave a new
relevant job (a title the search wants in a place it wants: board_yield.is_relevant), at most MAX_PAGES pages in all, only where the
site's robots.txt is not consulted (owner, 6 + 26 Oct 2026), with a pause between pages; a refusal (401/403, a bot check), a site still asking us to slow down (host_pace) or a failed page ends the paging and
keeps what was read. Called by found_boards.read_board for the full read only (the first-jobs slice stays at page 1; inside the boards' lane the
same read goes on to them after its slice: held, once). Tests: tests/unit/sources/test_board_pages.py, tests/unit/sources/test_board_lane_go_on.py."""
import html
import re
import time
import urllib.error
import urllib.parse

from .careers_parse import page_links

MAX_PAGES = 5       # pages of one board search read at most, page 1 included (owner, 18 Oct 2026)
PAUSE_S = 0.5       # between two pages of one site


def next_link(url, markup, numbered):
    """The page after `url`: its rel=next link on the same site, else the first of the numbered pages not read yet; None at the end."""
    host = urllib.parse.urlsplit(url).netloc
    for tag in re.findall(r'<(?:link|a)\b[^>]*\brel=["\']?next\b[^>]*>', markup or '', re.I):
        href = re.search(r'\bhref=["\']([^"\']+)["\']', tag)
        link = _encoded(urllib.parse.urljoin(url, html.unescape(href.group(1)))) if href else ''
        if link and urllib.parse.urlsplit(link).netloc == host:
            return link
    return _encoded(numbered.pop(0)) if numbered else None


def _encoded(link):
    """The address as a request can carry it: a page's link may hold raw spaces ("?q=senior financial analyst&page=2", 18 Oct 2026)."""
    return urllib.parse.quote(link, safe=":/?&=%#+@,;~!$'()*[]")


def more(url, markup, found, fetch, read, relevant, sleep=time.sleep, why=None):
    """The jobs on the pages after `url` (page 1, already read into `found`): [] when page 1 gave no relevant job. why: a list that gets the
    reason when no next page was read, for the round's log line (board_round_log.said).
    Why (ab, 14 Nov 2026, c12 Graz): a board listing 107 jobs read 15 and its line never said its next pages were not asked, nor why."""
    why = [] if why is None else why
    seen = {job['url'] for job in found}
    if not relevant(found):
        why.append('next pages not asked: page 1 gave no job in your roles and places')
        return []
    numbered, read_urls, jobs = page_links(url, markup), {url}, []
    for number in range(2, MAX_PAGES + 1):
        link = next_link(url, markup, numbered)
        while link in read_urls:
            link = _encoded(numbered.pop(0)) if numbered else None
        if not link:
            why.extend([] if number > 2 else ['next pages: none linked on the page'])
            break
        sleep(PAUSE_S)
        try:
            markup = fetch(link)
        except Exception as error:  # noqa: BLE001 — a refusal or a failed page (any error, an odd address too): the paging ends, page 1's jobs stay
            why.extend([] if number > 2 else [f'page 2 not read ({type(error).__name__})'])
            break
        url = link
        read_urls.add(url)
        fresh = [job for job in read(markup, url) if job['url'] not in seen]
        seen |= {job['url'] for job in fresh}
        jobs += fresh
        if not relevant(fresh):
            break
    return jobs


def once(fetch):
    """`fetch` that fetches each address once in one board's read and gives the same page (or error) again from memory: the read that goes on
    after the first-jobs slice (found_boards.read_board) asks the slice's first pages and job pages again. The round listener on `fetch`
    (board_rounds.ended) stays on it."""
    pages = {}

    def again(url, *args, **kwargs):
        if url not in pages:
            try:
                pages[url] = fetch(url, *args, **kwargs)
            except (urllib.error.URLError, OSError, ValueError) as error:   # a page refused, missing or timed out is not asked twice in one read
                pages[url] = error
        if isinstance(pages[url], BaseException):
            raise pages[url]
        return pages[url]
    again.on_round = getattr(fetch, 'on_round', None)
    return again


def held(state, route):
    """Why a board's first-jobs slice does not go on to the full read's other words and next pages (found_boards.read_board), None when it goes
    on: only in the boards' lane (it reads to the run's end, read_budget.lane_end), before that end, after a slice that read jobs off the board's
    own search pages. Why (ab, 14 Nov 2026, c12 Graz): the full read was left to src/sources/boards_ahead.py, which starts outside the lane at
    the employer sites' read cut and read nothing in all three baseline searches; the slice itself is unchanged, so no first job comes later.
    The lane reads it (boards_first.Beside.go_on), after the first-jobs step in a first run."""
    from ..ai import slots
    from . import read_budget
    if read_budget.lane_end() is None or slots.go_on() is None:
        return "the first jobs' read, outside the boards' lane"
    if read_budget.past_cut():
        return 'time is up'
    if route:
        return 'its jobs came as one list'
    if state != 'ok':
        return 'its first pages gave no job'
    return None
