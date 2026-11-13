"""Reading the job boards found for the user's countries (src/ai/board_ideas.py; spec docs/superpowers/specs/2026-10-08-job-board-discovery.md).
No code per board: each board's public search page, filled with the user's own board searches and places, is read like a careers page
(schema.org JobPosting first (its hiringOrganization is the job's company, else "via <board>"; also from the job pages a list links to), then the job links and the AI page reader within its caps, then learned recipes: src/sources/careers.py).
A board whose page only scripts fill first tries what it declares itself (feed alternates, robots.txt sitemaps: board_routes.py; the route
that worked is kept per host). A board that refuses (401/403, a bot check; a 429 is host_pace's "slow down") or gives no route is marked 'browser' (the visit list offers
it) and looked at again after 30 days; one that gave no job in the user's places three runs running is dropped (its history is the job
cache's source_yield table: src/sources/board_yield.py dead). The outcome of each read is kept in data/found_boards.json
('boards'), a cache. Wired as one aggregator, "Job boards found" (src/sources/aggregators.py). The boards that gave other installs like
this one their jobs are read first, the top 2 in the first-jobs slice (src/first_jobs.py; their jobs are handed to the full read, not
fetched twice: the full read reuses the slice's pages). Tests: tests/unit/sources/test_found_boards.py, tests/unit/sources/test_proven_boards.py."""
import json
import threading
import time
import urllib.error
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from .. import run_counts, time_budget
from ..ai import slots
from ..progress import Ticker
from . import board_check, board_later, board_layout, board_form_read, board_terms, board_employers, board_paths, board_forms, board_round_log, board_sections, board_web, board_pages, board_routes, board_yield, careers, host_pace, late_reads, read_budget
from .board_rendered import _rendered  # noqa: F401 -- moved out (500-line rule); tests and _another_way use found_boards._rendered
from .board_urls import _bare  # noqa: F401 -- moved out (500-line rule); tests and _another_way use found_boards._bare
from .board_ai_read import _own_country, _read_by_ai, _shaped  # noqa: F401 -- moved out (500-line rule); tests use found_boards._shaped
from .board_history import BROWSER_RETRY_DAYS, _dead, _retry_due, _retry_when_unjudged, read_since  # noqa: F401 -- moved out (500-line rule); tests and callers use found_boards._dead, .read_since
from ..press import resume, stage

MAX_SEARCHES = 2      # the user's board searches per board in the first-jobs slice (fast)
FULL_SEARCHES = 5     # and in the full read: every query the strategy has, up to this many (a board gave 3 jobs from 2 of the driver's 5, 18 Oct 2026)
AI_ASKS = 2           # search words whose page the AI page reader may read per board, until one answer has jobs (an empty first page is no sure "none")
IDLE_STOP = 2         # the full read stops a board after this many queries in a row that add no new job
MAX_PLACES = 2        # and places
LADDER = 2   # the version of the other ways below: a board that went up an older ladder without a relevant job goes up this one once (24 Oct 2026: sections, scripts)
FEW_RELEVANT = 5   # a general board's list giving fewer relevant jobs than this also gets its own section tried, once (24 Oct 2026: a list gave 1-2, its section 5)
BOARD_WORKERS = 4         # boards read at once (each its own site, its own pages one after another): the slice ends with its slowest board, not their sum
EARLY_MINUTES = 60        # a board read in the first-jobs slice hands its jobs to the same search's full read for this long
REPLACED = {'browser': 'refuses automated reading', 'gone': "can't be reached", 'one employer': "is one employer's own site",
            'other': 'is not a job board'}   # a read that gives a board's place to the next spare one, and what it says
_early = {}               # {host: (monotonic time, {url: page})}: the pages this search's first-jobs slice fetched


def _terms(search, limit=MAX_SEARCHES, early=False):
    return board_terms.terms(search, limit, early)   # own words and the AI's local-language ones (src/sources/board_terms.py)


def _places(search):
    from .. import places
    return places.words_of(search)[:MAX_PLACES] or ['']


def read_board(board, search, fetch=careers.get_text, route=None, early=False, show=None):
    """(jobs, state, route) for one board: jobs in the aggregators' shape, each once; state 'ok', 'empty' or 'browser'; route = the declared feed or
    sitemap that gave the jobs (kept, tried first next time), None when the search page itself did. A page no free step reads tries its
    declared routes (src/sources/board_routes.py); a script-only one with none is read by the headless browser (show: careers.renderer(),
    owner 19 Oct 2026), else 'browser' (a visit); a readable one goes to the AI page reader once per board per run, within its caps, and the
    recipe it leaves replays with no model next time."""
    from .. import read_methods
    with read_methods.reading(board.get('host') or board.get('search_url'), 'ai_board') as read:
        jobs, state, route = _read(board, search, fetch, route, early, show)
        read.jobs = read_methods.in_places(jobs)
    return list({job['url']: job for job in jobs}.values()), state, route   # every way out: a board refusing mid-read kept its repeats (18 Oct 2026)


def _read(board, search, fetch, route, early, show=None):
    jobs, state, asked_routes, asks, asked_term = [], 'empty', False, 0, None
    listing = show if board.get('rendered') and show is not None else None   # the list pages after their scripts ran; job pages are fetched as usual
    layout = board_layout.Layout(board)   # Why (13 Nov 2026, owner): a measured board's served layout names its job cards; no AI question per link
    try:
        if route:
            jobs = board_routes.follow(route, fetch, board, _terms(search))
            if jobs:
                return jobs, 'ok', route
    except board_routes.Stop as stop:
        return [], board_yield.refused(stop.__cause__), None
    seen, idle = set(), 0
    terms = _terms(search, MAX_SEARCHES if early else FULL_SEARCHES, early)
    for number, term in enumerate(terms if '{role}' in board['search_url'] else terms[:1]):   # a category page is the same page for every word
        if not early and number >= MAX_SEARCHES and idle >= IDLE_STOP:   # a board that stopped giving new jobs is not asked again
            break
        for place in (_places(search) if '{place}' in board['search_url'] else ['']):
            links, started, how = board_paths.forms(board['search_url'], term, place), time.monotonic(), ''
            url = links[0]
            parts = board_round_log.Parts()
            try:
                with parts.part('page'):
                    url, page = board_paths.get(listing or fetch, links)   # Why (#3886): a path-style board answers the plus form 404 and was skipped; its slug link has the jobs
            except urllib.error.HTTPError as error:
                careers.note_refusal(url, error)
                if error.code in host_pace.REFUSED:
                    return jobs, board_yield.refused(error), None
                board_round_log.said(board, term, place, started, jobs, error=f'HTTP {error.code}', parts=parts)
                continue
            except (urllib.error.URLError, OSError, ValueError) as error:
                if type(error).__name__ == 'Refused':
                    return jobs, board_yield.refused(error), None
                board_round_log.said(board, term, place, started, jobs, error=type(error).__name__, parts=parts)
                continue
            found = layout.read(page, url, fetch, parts.part)
            if not found and not asked_routes:   # nothing readable on the page (scripts fill the cards, or it is only a frame): what the board declares itself
                asked_routes = True
                try:
                    declared, found_route = board_routes.discover(page, url, fetch, board, _terms(search))
                except board_routes.Stop as stop:
                    return jobs, board_yield.refused(stop.__cause__), None
                if declared and (careers.READER is None or found_route['kind'] not in ('feed', 'json') or board_yield.is_relevant(declared)):   # a feed of news, not of jobs (26 Oct 2026: a pilot
                    return declared, 'ok', found_route   # board's RSS gave 10 articles and became its route): none the search wants, the page reader reads the page
                if careers._shell(page):   # a page built by scripts, with no route: the headless browser reads it, else a visit does
                    if show is None:
                        return jobs, board_yield.scripted(), None
                    try:
                        page = show(url)
                    except Exception as error:  # noqa: BLE001 — refused (401/403, a bot check), not allowed or no browser: a visit
                        careers.note_refusal(url, error)
                        return jobs, board_yield.refused(error), None
                    fetch, how = show, 'read after its scripts ran'   # this board's other searches and next pages are built by scripts too
                    found = layout.read(page, url, fetch, parts.part)
            if not found and asks < AI_ASKS and term != asked_term:   # an open, readable page no free step reads: the AI reads it (its caps), and the
                asks, asked_term = asks + 1, term                      # recipe it leaves reads it free from then on (owner, 18 Oct 2026; page_recipes.py).
                with parts.part('AI reader'):
                    found, how = careers._asked(url, page, [], fetch), 'the AI read the page'   # An empty answer (no jobs for these words) asks again on the next words' page
                asks = AI_ASKS if found else asks                      # (19 Oct 2026: Arbeitsagentur, 0 for "audio producer", 5 for "sound engineer")
            on_page = len(found or [])   # the round line counts the first page apart from its next pages (Gitar, #3952)
            if found and not early:   # the next pages of these results, while they still give relevant jobs (board_pages.py)
                found = found + board_pages.more(url, page, found, fetch, lambda markup, link: layout.read(markup, link, fetch),
                                                 lambda some: board_yield.is_relevant(some))
            shaped = _shaped(board, found)
            board_round_log.said(board, term, place, started, jobs, shaped, how, on_page=on_page, parts=parts)
            jobs.extend(shaped)
            state = 'ok' if jobs else state
        new = {job['url'] for job in jobs} - seen
        seen |= new
        idle = 0 if new else idle + 1
    return jobs, state, None


def _section(board, page, search, fetch, judge, show=None):
    """(jobs, address) from the section of the board's home page the AI picks for the search's role; ([], None, False) with the page reader off (tests); the third is True when the section's page was read after its scripts ran."""
    terms = _terms(search, 1)
    if careers.READER is None or not page[1] or not terms:
        return [], None, False
    from ..ai import decide
    with stage.guard('found boards: sections'):
        rendered = []
        found, section = board_sections.read(page[1], page[0], terms[0], fetch, decide.decide, judge, lambda found: _shaped(board, found), show, rendered)
        return found, section, bool(rendered)
    return [], None, False   # a fallback never breaks the read


def _went_up(entry, proposed):
    """The board went up this version of the ladder for this proposed link (and gave no relevant job)."""
    return entry.get('form_for') == proposed and entry.get('ladder') == LADDER


def _fuller_section(board, entry, proposed, search, fetch, judge, before, show=None):
    """(jobs, state, relevant): the board's own section for the user's kind of work when it gives more relevant jobs than the list that gave few
    (`before`), else `before`; asked once per proposed link and version of the ladder. No page is fetched past the read cut, as in _another_way
    (26 Oct 2026, a proof run: a board with 3 relevant jobs read its section from 99 s to 190 s)."""
    entry['few_for'] = f'{proposed}|{LADDER}'
    fetch, show = _until_cut(fetch), show and _until_cut(show)
    page = board_forms.home(board, fetch)
    made = board_form_read.through_forms(board, entry, search, fetch, judge, show, read_board, board_forms.home_templates(board, fetch, page), len(before[2]), [], read_budget.past_cut)
    if made is board_form_read.CUT:   # the read cut came before its form was tried: no further page, and the next search tries again (Gitar, #3917)
        entry.pop('few_for', None)
        return before
    if made:   # its own search form gives more relevant jobs than the list that gave few
        return made
    listed, section, scripted = _section(board, page, search, fetch, judge, show)
    more = judge(listed) if listed else []
    if len(more) <= len(before[2]):
        return before
    entry['search_url'] = section
    entry['rendered'] = scripted or entry.get('rendered', False)
    print(f"Job boards found: {board['name']} read from its own section ({len(more)} relevant against {len(before[2])})", flush=True)
    return listed, 'ok', more


def _until_cut(fetch):
    """The page reader of a board's follow-up ways (_another_way, _fuller_section): past the search's read cut it reads no page (the way's own error handling ends it at once)."""
    def until(url, *args, **kwargs):
        if read_budget.past_cut():
            raise TimeoutError('past the search\'s read cut')
        return fetch(url, *args, **kwargs)
    return until


def _another_way(board, entry, proposed, search, fetch, judge, before, show=None):
    """(jobs, state, relevant) for a board whose proposed link gave no relevant job: when its rules read something (a menu, a news search),
    the AI page reader reads its search page (_read_by_ai); else through the search form on its home page
    (src/sources/board_forms.py), kept as the board's link (the pool share sends it, src/contribute.py); else the job list it declares
    itself (a feed, its home page's own data or the sitemap in robots.txt: board_routes, job pages naming the search words first), kept
    as its route (owner, 18 Oct 2026: Randstad listed warehouse jobs for "financial analyst" and has a job sitemap). Else `before`; the
    board is not looked at again while the proposed link stays the same. The search's read cut stops it between two ways (cut), and inside one:
    no page is fetched past it (_until_cut); the board goes up the ladder again next time (26 Oct 2026, proof runs: a ladder started at 77 s
    ran to 133 s, past the 90 s cut; then one way alone, started before the cut, fetched pages to 138 s)."""
    entry['form_for'], entry['ladder'] = proposed, LADDER
    refused, fetch, show = [], _until_cut(fetch), show and _until_cut(show)

    def cut():   # past the search's read cut: no next way; not marked as gone up, so the next search tries it
        if read_budget.past_cut():
            entry.pop('form_for', None)
            entry.pop('ladder', None)
            return True
        return False   # a step whose page refused us or only scripts fill: the board ends as a visit, not as "0 jobs" (24 Oct 2026: a bot check behind the search form)

    def stands(answer):
        return (answer[0], 'browser', answer[2]) if refused and answer[1] != 'ok' else answer
    bare = _bare(proposed)
    if bare:   # an extra filter in the link (a sector, a radius): the same search with only the words and the place
        again, state = [], 'empty'   # a failure: the other ways stand
        with stage.guard('found boards: bare link'):
            again, state, _ = read_board({**board, 'search_url': bare}, search, fetch, None, show=show)
        relevant = judge(again) if again else []
        if state == 'browser':
            refused.append(bare)
        if relevant:
            entry['search_url'] = bare
            print(f"Job boards found: {board['name']} read without the link's extra filters", flush=True)
            return again, state, relevant
    if cut():
        return stands(before)
    if before[0]:   # the rules read something that was no relevant job (a menu, a news search): the AI reads the page itself
        read = _read_by_ai(board, search, fetch)
        relevant = judge(read) if read else []
        if relevant:
            print(f"Job boards found: {board['name']} read by the AI page reader", flush=True)
            return read, 'ok', relevant
    if cut():
        return stands(before)
    page = board_forms.home(board, fetch)
    if show and page[1] and careers._shell(page[1]):   # a home page built by scripts: its search form exists only in the headless browser
        try:
            page = (page[0], show(page[0]))
        except Exception:  # noqa: BLE001 — refused or no browser: the plain home page stands
            pass
    made = board_form_read.through_forms(board, entry, search, fetch, judge, show, read_board, board_forms.home_templates(board, fetch, page), 0, refused, cut)
    if made is board_form_read.CUT:
        return stands(before)
    if made:
        return made
    if cut():
        return stands(before)
    listed, section, scripted = _section(board, page, search, fetch, judge, show)   # the board's own section for this kind of work (board_sections.py)
    if listed:
        entry['search_url'] = section
        entry['rendered'] = scripted or entry.get('rendered', False)
        print(f"Job boards found: {board['name']} read from its own section", flush=True)
        return listed, 'ok', judge(listed)
    if cut():
        return stands(before)
    try:
        listed, route = board_routes.discover(page[1], page[0], fetch, board, _terms(search, FULL_SEARCHES))
    except board_routes.Stop:   # its own list refused us: the search page's answer stands, the board is not marked for a visit
        return stands(before)
    except Exception:  # noqa: BLE001 — a fallback never breaks the read: the search page's answer stands
        return stands(before)
    relevant = judge(listed) if listed else []
    if relevant:
        entry['route'], entry['route_kind'] = route, route['kind']   # read_board follows it first from then on
        print(f"Job boards found: {board['name']} read from its own job list ({route['kind']})", flush=True)
        return listed, 'ok', relevant
    if cut():
        return stands(before)
    return _rendered(board, entry, proposed, page, search, fetch, show, judge) or stands(before)


def _kept_spares(taken, lock, read_items, keep):
    """Keep, right after each of `read_items`, the boards read in its place (taken: {host: [(spare item, result)]}), in the order they were read.
    Why (12 Nov 2026): they were kept after the whole read loop, which waits for the slowest board up to the cut: a replacement read at 19 s
    reached the title judge at 124 s, after its AI time was gone, and its titles went unjudged. Each board's replacements follow it in its turn."""
    for read_item in read_items:
        with lock:
            chain = taken.pop(read_item[0]['host'], [])
        for spare_item, result in chain:
            keep(spare_item, result, read_item)


def _hand(turn, found, on_board):
    """One kept board's jobs: kept at its turn in the list (turn), and handed to on_board(jobs) at once when given and not empty."""
    turn.extend(found)
    if on_board is not None and found:
        on_board(found)


def read(search, boards=None, fetch=None, now=None, is_relevant=None, dead=None, early=False, workers=BOARD_WORKERS, spare=(), web=True, since=None, on_board=None, later=None):  # noqa: C901 (Why (12 Nov 2026, bj): 35 before this change and 35 after; on_board only passes through to _hand, no new branch; splitting read is its own change)
    """Every job of the found boards for this search; each board's yield kept (jobs listed, relevant ones), boards marked browser or dropped
    by their history skipped, untried boards limited (board_yield.pick). early: the first-jobs slice; its jobs are kept for this search's
    full read, which asks the board in full and serves the pages the slice fetched from them instead of fetching them again. workers: boards
    read at once. spare: boards read, in their order, each in place of one that refuses automated reading, as soon as it refuses (owner,
    19 Oct 2026: a second wave after the first made Finance's first-jobs step wait 35 s; 4 of music's first 6 boards refused). web: a full
    read with no trade or local board that gave a job asks one web search for them and reads what it finds (src/sources/board_web.py).
    since: the boards read since then are skipped (the same search within the scan's spacing, board_yield.not_read_since).
    Each board is kept (and its titles and places judged) as soon as its own read ends; on_board(jobs) then gets its jobs, once per board kept.
    later(): more boards, named while these are read (the AI's proposal beside the measured boards, first_jobs.board_jobs); the ones not
    being read join this same read in the places left, as soon as they are named: one read, one board memory, one save.
    The jobs returned are in the list's order, whatever the threads' timing. Past the search's read cut nothing is read, asked or tried another way: it waits for the next search (tests/unit/sources/test_three_minutes.py)."""
    resume.ran('job boards')   # this process ran the step: its end-of-run count may say 0 (src/press/resume.py)
    if read_budget.past_cut():
        time_budget.later('job boards', len(boards) if boards is not None else 1, 'boards' if boards is not None and len(boards) != 1 else 'board read')
        return []
    from ..ai import board_ideas
    # the headless browser, for the real web only: never a test's pages, and off with the page reader (tests turn it off: test_found_boards_ai.py)
    show = careers.renderer() if fetch in (None, careers.get_text) and careers.READER is not None else None
    fetch = fetch or careers.get_text   # looked up when called: a test's or a run's own fetcher applies
    from . import board_yield
    data = board_ideas.load()
    base = json.loads(json.dumps(data))   # what this read loaded: its save writes only what it changed since (board_ideas.save_read)
    kept = data.setdefault('boards', {})
    stamp = (now or datetime.now(timezone.utc)).isoformat(timespec='seconds')
    by_turn = []   # each board's jobs at its turn in the list (its replacements after it): the list's order at the end, whichever board ended first
    retry, dropped = (lambda entry: _retry_due(entry, now)), (dead if dead is not None else _dead())
    searching = board_web.start(search, data, fetch=fetch, now=now) if web and not early else None   # at second 0, beside the rest (owner, 26 Oct 2026)
    proposed = boards if boards is not None else board_ideas.ideas(search)
    todo = board_yield.not_read_since(board_yield.pick(proposed, kept, retry, dropped, remember=web, enough=board_yield.ENOUGH if web else float('inf')),
                                      kept, since, handed=set(_early))   # web=False: these only; a board read early in this run reads on
    ticker = Ticker('Reading job boards', len(todo), every=0)   # the driver persona's board read was silent for 7 minutes (18 Oct 2026)

    def item(board):
        entry = kept.setdefault(board['host'], {'name': board['name'], 'search_url': board['search_url']})
        proposed = board['search_url']
        if entry.get('form_url') and entry.get('form_for') == proposed:   # the board's own search form gave relevant jobs for this link
            board = {**board, 'search_url': entry['form_url']}
        if entry.get('rendered'):   # its lists are built by scripts: read in the headless browser from now on (_rendered)
            board = {**board, 'rendered': True}
        handed = _early.pop(board['host'], None)
        return (board, entry, handed[1] if handed and time.monotonic() - handed[0] < EARLY_MINUTES * 60 and not early else {}, {}, proposed)
    reads = [item(board) for board in todo]
    late_pages = {} if early else {board['host']: page for board in todo if (page := late_reads.take('board', board['host'])) is not None}
    if late_pages:
        print(f"Job boards: {len(late_pages)} read after the last search's time taken from it, not read again", flush=True)
    hosts = {board['host'] for board in todo}
    spares = list(enumerate(item(board) for board in (board_yield.pick(spare, kept, retry, dropped, remember=False) if spare else [])
                            if board['host'] not in hosts))
    taken, lock = {}, threading.Lock()   # taken: {a board's host: [(spare item, result)]} the boards read in place of it while it refused
    waiting = []   # boards whose read or other ways wait for the next search: the run's time is up (read_budget.past_cut)

    def one(read_item):   # one board's pages; what is kept of it is decided below, in the list's order, in this thread
        board, entry, pages, fetched, _ = read_item

        def through(url):   # a page this search's first-jobs slice fetched is served from it, not asked again
            if url in pages:
                return pages[url]
            page = fetch(url)
            if early:
                fetched[url] = page
            return page
        if board['host'] in late_pages:   # read after the last search's cut, or its ladder was cut: that page, not a second read
            return tuple(late_pages.pop(board['host']))
        result = read_board(board, search, through, entry.get('route'), early=early, show=show)
        if not result[0] and result[1] != 'browser' and entry.get('site_kind') in (None, 'gone'):   # nothing read: a board at all? (board_check)
            site, page = board_check.kind(board, fetch)
            if site:
                entry['site_kind'], entry['site_page'] = site, board_check.name_of(page, board['host']) if site == 'one employer' else ''
                day = (now or datetime.now(timezone.utc)).date().isoformat()   # gone on two days: a Mac offline for one search keeps its boards
                entry['gone_days'] = sorted({*entry.get('gone_days', []), day})[-2:] if site == 'gone' else []
            if site in board_check.NOT_A_BOARD:
                return [], site, None
        return result

    def one_or_spare(read_item):   # the board's own result; while what was read refuses, the next spare board is read in its place
        first = result = one(read_item)
        name = read_item[0]['name']
        while result[1] in REPLACED:
            with lock:
                if not spares:
                    break
                _, spare_item = spares.pop(0)
            print(f"Job boards: {name} {REPLACED[result[1]]}; reading {spare_item[0]['name']} in its place", flush=True)
            result = one(spare_item)
            with lock:
                taken.setdefault(read_item[0]['host'], []).append((spare_item, result))
            name = spare_item[0]['name']
        return first

    def keep(read_item, result, after=None):   # after: the board this one was read in place of
        board, entry, _, fetched, proposed = read_item
        turn = by_turn[order.get(id(after or read_item), -1)]
        found, state, route = result
        if early:   # the full read asks every query and the next pages, reusing these
            _early[board['host']] = (time.monotonic(), fetched)
        entry.pop('route', None)
        entry.pop('route_kind', None)
        if route:
            entry['route'] = route
            entry['route_kind'] = route['kind']   # sitemap, feed, json or state: the source queue ranks by it
        judge = is_relevant or board_yield.is_relevant
        relevant = judge(found) if found else []
        if state in board_check.NOT_A_BOARD:   # not read as a board; one employer's site goes to the scout with its address
            if state == 'one employer':
                board_employers.note_site(entry.get('site_page') or board['name'], board_check.home(board), 'Job boards found')
            print(f"Job boards found: {board['name']} {REPLACED[state]}{': added to your employers' if state == 'one employer' else ''}", flush=True)
            entry['last_read'] = stamp
            entry.pop('owed', None)
            board_yield.record(entry, 0, 0, 'empty')
            board_ideas.keep_board(board['host'], entry)
            return
        def wait(answer):   # not stamped read: the next search goes up its ladder from this page, not a second read
            waiting.append(board['name'])
            late_reads.keep('board', board['host'], [answer[0], answer[1], route])
            print(f"Job boards found: {board['name']} {len(answer[0])} job(s), 0 relevant; its other ways wait for the next search", flush=True)
            run_counts.looked(answer[0])
            _hand(turn, answer[0], on_board)
        late = read_budget.past_cut()   # its other ways are tried next time: _went_up is not marked
        if late and not early and not relevant and not route and state != 'browser' and not _went_up(entry, proposed):
            return wait((found, state))
        elif not (early or relevant or route) and state != 'browser' and not _went_up(entry, proposed):   # once per proposed link and version of the ladder
            from ..ai import decide
            failed = decide.FAILED[0]
            before = (found, state)
            found, state, relevant = _another_way(board, entry, proposed, search, fetch, judge, (found, state, relevant), show=show)
            _retry_when_unjudged(entry, relevant, decide.FAILED[0] > failed)
            if not early and not relevant and state != 'browser' and read_budget.past_cut():   # the cut came mid-ladder: the rest waits too
                entry.pop('form_for', None)
                entry.pop('ladder', None)
                return wait(before)
        elif (0 < len(relevant) < FEW_RELEVANT and not (early or route) and state != 'browser' and (board.get('source_kind') or 'general') == 'general'
              and entry.get('few_for') != f'{proposed}|{LADDER}' and not entry.get('form_url') and entry.get('search_url', proposed) == proposed
              and not late):   # a list with few relevant jobs, on the proposed link (not one it learned): its own section may hold more
            found, state, relevant = _fuller_section(board, entry, proposed, search, fetch, judge, (found, state, relevant), show=show)
        entry.update({'last_read': stamp, 'countries': board.get('countries') or [], 'kinds': board.get('kinds') or [],
                      'source_kind': board.get('source_kind') or 'general', **({'origin': board['origin']} if board.get('origin') else {})})
        entry.pop('owed', None)   # a mark of the removed re-read (owed_reads): the jobs the AI had no answer for wait in src/sources/waiting_jobs.py instead
        board_yield.record(entry, len(found), len(relevant), state)
        board_yield.paid(entry, len(relevant), search)   # read first by the next search in this field (boards_first)
        board_ideas.keep_board(board['host'], entry)   # on disk at once: a refusal reaches Jobadabra's browser queue (refused_reads) in this press
        print(f"Job boards found: {board['name']} {len(found)} job(s), {len(relevant)} relevant{'' if state != 'browser' else f' (refuses automated reading, {board_yield.refused_why(entry)}: offered as a visit)'}", flush=True)
        run_counts.looked(found)
        run_counts.matched(relevant)
        _hand(turn, found, on_board)
    pool, cut, left = ThreadPoolExecutor(max_workers=max(1, workers)), read_budget.cut_at(), []   # 18 Oct 2026: Chisinau's 2 slice boards gave nothing, its 4th and 8th 14 jobs
    order = {id(read_item): n for n, read_item in enumerate(reads)}   # by item, not host: two items of one host keep their own turns (Gitar, #3892)
    by_turn.extend([] for _ in range(len(reads) + 1))   # the last: a board not in the list (none expected)
    # Why (#2235, owner, 27 Oct 2026: "local boards first"): a pool thread starts NORMAL; carry() keeps the slice's FIRST level for the AI calls of
    # each board, whose future maps to its item so it is kept as it ends (#3892)
    futures = {pool.submit(slots.carry(one_or_spare), read_item): read_item for read_item in reads}
    start = lambda board: board_later.start(item(board), reads, hosts, order, by_turn, futures, lambda read_item: pool.submit(slots.carry(one_or_spare), read_item))
    feeders = board_later.named(later, lambda named: board_later.join(named, lambda these: board_yield.pick(these, kept, retry, dropped, remember=False), hosts, workers - len(reads), start))
    # Why (#3892, 12 Nov 2026): boards are kept as they end (in the list's order a slow first board held the others' titles and places
    # past the AI's time); the boards named meanwhile (feeders) join this same loop as they start, never a second read
    for done, (future, result) in enumerate(read_budget.as_done(list(futures), cut, feeders), 1):   # a board still open at the search's cut is not waited for (read_budget.cut_at)
        read_item = futures[future]
        if result is read_budget.LEFT:
            left.append(read_item[0]['name'])
            if not early:   # not killed: its page result, when it ends, is the next search's (late_reads)
                late_reads.when_done(future, 'board', read_item[0]['host'], lambda got: list(got) if got and got[1] not in REPLACED else None)
            continue
        keep(read_item, result)
        _kept_spares(taken, lock, [read_item], keep)
        ticker.tick(done, f" · {read_item[0]['name']}")
    pool.shutdown(wait=not left, cancel_futures=True)
    if left:
        print(f"Job boards: {', '.join(left)} still being read at the search's time; read next time", flush=True)
        waiting += left
    for read_item in reads:   # a board still open at the cut: its replacements read before it
        _kept_spares(taken, lock, [read_item], keep)
    more = board_web.finish(searching, proposed, data=data)   # its web search, started with the run or the read: its boards are read now, in this run
    board_ideas.save_read(data, base)
    jobs = [job for turn in by_turn for job in turn]
    board_employers.note(jobs, 'Job boards found')
    if more and read_budget.past_cut():   # found too late for this search: kept with the web search's boards, read by the next one
        waiting += [board['name'] for board in more]
        more = []
    if waiting:
        time_budget.later('job boards', len(waiting), 'boards' if len(waiting) != 1 else 'board')
    if more:
        jobs.extend(read(search, more, fetch, now, is_relevant, dead, workers=workers, web=False, on_board=on_board))
    return jobs
