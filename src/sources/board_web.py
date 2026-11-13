"""Specialist and local job boards found with a web search, as a source of the run from its start (owner, 26 Oct 2026: "It should not read the
web search last. It should probably start with that."; first built 19 Oct 2026, step 3 of the local-sources sketch, after a full board read).
early() starts it with the run, before the first jobs; start() hands it to the full read beside the proposal (or starts it there); finish() hands its new boards to the same read. Its one skip: this search was searched
in the last DAYS while its boards work (WANT sector or regional boards gave relevant jobs for THIS search's field and places), else it searches again on
the very next run, told what it found before, up to TRIES thin searches in a row (owner via the coordinator, 26 Oct 2026), then after a rest that
grows while it stays thin: 1, 2, 4, then RECENT days (owner's yes, 26 Oct 2026: three thin tries ran within 8 minutes, then a flat 7-day rest).
The search runs on the user's own plan (Claude Code, Codex: the engine, or signed in beside Free AI or a key: web_search.plan_client) or an
Anthropic API key (about $0.07 a search: up to 6 planned web searches, owner's yes 26 Oct 2026), or for Free AI alone the site's capped web search lane. Only boards whose address the search showed; each is marked origin 'web'
(its own yield in found_boards.json), joins the cached proposal (found_boards.json 'ideas'), and one that gives nothing is checked like any
(src/sources/board_check.py). Off while the AI page reader is off (tests), in the fixture mode, or with JOBADABRA_DISABLE=web_search.
Tests: tests/unit/sources/test_board_web.py, tests/unit/sources/test_board_web_thin.py, tests/unit/ai/test_web_first.py."""
import json
import os
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

from ..features import disabled
from . import careers, web_answers
from ..press import stage
from ..ai import slots
from ..press import resume

WANT = 2        # working sector or regional boards a search should have
DAYS = 30       # a search whose boards work is searched again this often
RECENT = 7      # the longest rest of a search still thin after TRIES tries in a row: 1, 2, 4, then this many days (_rest)
TRIES = 3       # thin searches in a row, each on the next run, before the weekly rest (owner, 26 Oct 2026: search again while it found too little)
ENGINES = ('cli', 'codex', 'api')   # engines whose AI can search the web (Free AI through the site's lane; OpenAI's API: not here, a signed-in plan beside it can)
LOCAL_KINDS = ('sector', 'regional')
# The instruction, search cap and answer form, shared with the site relay that runs this search for Free AI without a plan (one text, public).
PROMPT = json.loads((Path(__file__).resolve().parents[2] / 'config' / 'board_web_search.json').read_text())
SYSTEM, MAX_USES, MAX_TOKENS, MAX_FOUND = PROMPT['system'], PROMPT['max_uses'], PROMPT['max_tokens'], PROMPT['max_found']   # MAX_FOUND: boards kept from one search


def _searcher():
    """The client that runs this web search: the user's own plan (src/sources/web_search.py plan_client: the engine, or signed in beside
    Free AI or a key), else their own API key; on Free AI alone, the site's web search lane (jobadabra-web shared/free-ai-web.js: the same
    public prompt on the Anthropic API, one shared answer per roles × places for 30 days, $10 a month for everyone; 25 Oct 2026: the owner's
    Free AI install never searched the web, its open model has no web search tool)."""
    from ..ai import engine
    from . import web_search
    if web_search._claude_code():
        return _said('your plan', web_search.plan_client())
    if engine.choice() not in ENGINES or not engine.ready():
        return None
    if web_search.free_ai():   # Free AI without a plan: the site runs this one search on its own capped key (owner, 26 Oct 2026: "Yes, $10/month cap")
        return _said("Free AI's web search on the site", engine.client(action='web_search'))
    return _said('your API key', engine.client(action='scout'))


def _said(lane, client):
    """The client, with one line saying the search starts and through what (the log shows when the web search began)."""
    if client is not None:
        print(f'Job boards: searching the web for trade and local boards ({lane})', flush=True)
    return client


def _unknown_kind(search_config):
    """Whether the role's kind is unknown (src/role_kinds.py UNKNOWN: the AI could not place it, so no bulk employer read carries it)."""
    from .. import role_kinds
    unknown = getattr(role_kinds, 'UNKNOWN', None)
    if unknown is None or not search_config:
        return False
    with stage.guard('job boards: role kind'):
        return unknown in (role_kinds.of_search(search_config) or ())   # a set of kinds; UNKNOWN among them when the AI could not place the role
    return False   # a kind we cannot tell is not a reason to search more


def needed(kept, boards, search_config=None):
    """True when fewer than WANT of these boards are sector or regional ones that gave relevant jobs (read, not refusing), or when the
    search's role kind is unknown: then the web search is its main source (role-kinds session, 26 Oct 2026)."""
    if _unknown_kind(search_config):
        return True
    working = [board for board in boards if (entry := kept.get(board['host']) or {}).get('source_kind', board.get('source_kind')) in LOCAL_KINDS
               and entry.get('state') == 'ok' and int(entry.get('relevant') or 0) > 0]
    return len(working) < WANT


def _working(kept, search_config):
    """The kept sector or regional boards that gave relevant jobs for THIS search's field and places (src/sources/board_yield.py working):
    a board kept for an earlier search (a software board, another country) never counts. [] when the role's kind is unknown."""
    from . import board_yield
    with stage.guard('job boards: working boards'):
        return [board for board in board_yield.working(search_config or {}, kept or {}) if board['source_kind'] in LOCAL_KINDS]
    return []   # boards we cannot judge are not working ones


def _last(data, key):
    try:
        return datetime.fromisoformat((data.get('web') or {})[key])
    except (KeyError, TypeError, ValueError):
        return None


def _next_search(data, key, kept=None, search_config=None):
    """When this search's web search is due next: None when never searched (due now); the last search's own time (the very next run) while it
    left fewer than WANT working boards and fewer than TRIES thin searches ran in a row; else _rest after it; DAYS once its boards work."""
    last = _last(data, key)
    if last is None:
        return None
    if len(_working(kept, search_config)) >= WANT:
        return last + timedelta(days=DAYS)
    tries = int((data.get('web_thin') or {}).get(key) or 0)
    return last if tries < TRIES else last + _rest(tries)


def _rest(tries):
    """The rest after `tries` thin searches in a row (TRIES or more): 1 day, then 2, 4, and at most RECENT days."""
    return timedelta(days=min(RECENT, 2 ** (tries - TRIES)))


def _due(data, key, now, kept=None, search_config=None):
    """Never searched, or its next search time has come (_next_search)."""
    due = _next_search(data, key, kept, search_config)
    return due is None or now >= due


_early = {}   # {search key: (Future, its own copy of found_boards.json)}: started before the first jobs, taken by the full read (start)
_lock = threading.Lock()
_searched = set()   # (run, search key) pairs already searched: once per run (owner's state, 26 Oct 2026: two searches in one run)


def _run(key):
    """This run's mark for a search key: (when the search's clock started, key); None outside a run (no clock started: tests, tools)."""
    from .. import time_budget
    return None if time_budget.BEGAN is None else (time_budget.BEGAN, key)


def _submit(search_config, data, fetch, now):
    from concurrent.futures import ThreadPoolExecutor
    known = [{'name': entry.get('name') or host, 'host': host} for host, entry in (data.get('boards') or {}).items()]
    pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix='board-web')
    # Why (#first-press-slots, owner, 27 Oct 2026): its long call waits behind every other one; its boards are read after the slice's anyway
    future = pool.submit(slots.carry(search, slots.LATER), search_config, known, now=now, fetch=fetch, data=data)
    pool.shutdown(wait=False)
    return future


def early(search_config, fetch=None, now=None):
    """The web search started with the run, before the first jobs (owner, 26 Oct 2026: "It should probably start with that"; 26 Oct, the pilot
    check: started by the full read it began at 265 s, after a first-jobs step of 15 employers and 6 general boards). It runs on its own copy of
    found_boards.json; the full read takes it (start) and keeps what it found (finish). None when this search has nothing to ask."""
    from ..ai import board_ideas
    asked = board_ideas.asked_for(search_config)
    if not asked:
        return None
    copy = board_ideas.load()
    future = _submit(search_config, copy, fetch, now)
    with _lock:
        _early[asked[0]] = (future, copy)
    return future


def found_first(search_config, wait):
    """The boards the web search started with the run found (kept in found_boards.json), waited for up to `wait` seconds and never past the
    search's cut; [] when none was started or it is still searching (the full read then takes it, start)."""
    from concurrent.futures import TimeoutError as Late

    from ..ai import board_ideas
    from . import read_budget
    asked = board_ideas.asked_for(search_config)
    with _lock:
        started = _early.get(asked[0]) if asked else None
    if started is None:
        return []
    left = read_budget.seconds_left(read_budget.cut_at())
    with stage.guard('job boards: early web search'):   # the search failed: the proposal's boards stand
        try:
            started[0].result(timeout=wait if left is None else min(wait, left))
        except Late:
            print('Job boards: the web search is still searching; its boards are read with the others', flush=True)
            return []
    with _lock:
        _early.pop(asked[0], None)
    with board_ideas.STORE:
        data = board_ideas.load()
        found = finish(started, [], data=data)
        board_ideas.save(data)
    return found


def start(search_config, data, fetch=None, now=None):
    """The web search beside the board proposal and the reads: the one started with the run (early) for this search, else one started now,
    in its own thread. A (Future of its boards, the found_boards.json it records into) pair; the read saves its own after finish().
    None past the search's read cut: a new search is asked by the next one (tests/unit/sources/test_three_minutes.py)."""
    resume.ran('web search')   # this process ran the step: its end-of-run count may say 0 (src/press/resume.py)
    from ..ai import board_ideas
    from . import read_budget
    asked = board_ideas.asked_for(search_config)
    with _lock:
        taken = _early.pop(asked[0], None) if asked else None
    if taken:
        return taken
    if read_budget.past_cut():
        from .. import time_budget
        time_budget.later('web search', 1, 'search')
        return None
    return (_submit(search_config, data, fetch, now), data)


def _merge(into, copy):
    """What a search run on its own copy recorded (when it searched, the boards it found), into the read's found_boards.json."""
    into.setdefault('web', {}).update(copy.get('web') or {})
    into.setdefault('web_thin', {}).update(copy.get('web_thin') or {})
    into.setdefault('web_used', {}).update(copy.get('web_used') or {})
    for key, boards in (copy.get('ideas') or {}).items():
        have = into.setdefault('ideas', {}).setdefault(key, [])
        hosts = {board['host'] for board in have}
        have.extend(board for board in boards if board.get('origin') == 'web' and board['host'] not in hosts)


def finish(started, proposed, timeout=None, data=None):
    """The started search's boards that the proposal does not already hold, each marked origin 'web'; [] when none or it failed.
    data: the read's found_boards.json, given what a search started with the run recorded on its own copy."""
    if started is None:
        return []
    from . import read_budget
    future, copy = started if isinstance(started, tuple) else (started, None)
    with stage.guard('job boards: web search result') as caught:   # never past the search's cut (src/sources/read_budget.py cut_at)
        found = future.result(timeout=timeout) if timeout is not None else read_budget.result(future, read_budget.cut_at())
    if caught:   # the proposal's boards stand
        return []
    if found is read_budget.LEFT:   # not killed: when it answers, its boards are kept for the next search, not asked again (_keep_late)
        _leave_open(future, copy, data)
        return []
    found = found or []
    if data is not None and copy is not None and copy is not data:
        _merge(data, copy)
    hosts = {board['host'] for board in proposed}
    return [{**board, 'origin': 'web'} for board in found if board['host'] not in hosts]


def _leave_open(future, copy, data):
    """The one place a search still open at the cut is handed on: its answer, when it comes, is kept for the next search (_keep_late)."""
    if not future.done():
        print("Job boards: the web search did not answer in the search's time; the boards it finds are read by the next search", flush=True)
    future.add_done_callback(lambda done: _keep_late(done, copy, data))


def leave(search_config):
    """The job boards' step is skipped at the search's read cut (found_boards.read): the web search started with the run (early), still open,
    is handed on here so its late answer is kept for the next search, not lost and asked again from second 0 (E2b, 8 Nov 2026: persona 18's
    chain, run 2 waited ~116 s, ~70% of the run, for a search run 1 had paid for). Nothing is read or asked; no-op when none is open."""
    from ..ai import board_ideas
    asked = board_ideas.asked_for(search_config)
    with _lock:
        taken = _early.pop(asked[0], None) if asked else None
    if taken is not None:
        _leave_open(taken[0], taken[1], None)


def _keep_late(done, copy, data):
    """A web search that answered after the read cut: what it recorded on its own copy (when it searched, the boards it found) goes into
    the read's found_boards.json and the saved file, so the next search reads those boards and does not search again (owner, 26 Oct 2026:
    "next one to continue/start properly without redoing the same job"). Tests: tests/unit/ai/test_three_minutes_resume.py."""
    from ..ai import board_ideas
    if done.exception() is not None or copy is None:
        return
    with _lock:
        if data is not None and data is not copy:
            _merge(data, copy)
        with board_ideas.STORE:
            saved = board_ideas.load()
            _merge(saved, copy)
            board_ideas.save(saved)


def _with_search(item, fetch):
    """The answer with a search link: as given when it has {role}, else the one its home page's search form makes (src/sources/board_forms.py;
    19 Oct 2026: 4 of 5 boards a search found for sound technicians in Berlin came as a plain page)."""
    url = str(item.get('search_url') or '').strip() if isinstance(item, dict) else ''
    if not url.startswith('https://') or '{role}' in url:
        return item
    from . import board_forms
    made = board_forms.home_templates({'search_url': url}, fetch)
    return {**item, 'search_url': made[0]} if made else item


def _judged(found, roles, fetch):
    """The boards the AI judged as job boards from the page each was found as (src/sources/board_check.py field_kind), checked at once: a board
    of the field is marked 'sector'; a general one stays only with a keyword search page; one employer's site or anything else is left out,
    said in the log. Unknown (no answer): the board stands as the search gave it."""
    from concurrent.futures import ThreadPoolExecutor

    from . import board_check
    with ThreadPoolExecutor(max_workers=4, thread_name_prefix='board-judge') as pool:
        kinds = list(pool.map(slots.carry(lambda board: board_check.field_kind(board, fetch, roles)), found))
    kept = []
    for board, kind in zip(found, kinds):
        if kind == 'field board':
            kept.append({**board, 'source_kind': 'sector'})
        elif kind == 'job board' and board['source_kind'] == 'sector':
            if '{role}' in board['search_url']:
                kept.append({**board, 'source_kind': 'general'})
            else:
                print(f"Job boards: {board['name']} lists every kind of job, with no search by words: left out", flush=True)
        elif kind in ('one employer', 'other'):
            why = "is one employer's own site" if kind == 'one employer' else 'is not a job board'
            print(f"Job boards: {board['name']} {why}: left out", flush=True)
        else:
            kept.append(board)
    return kept


def _ask(client, question):
    """One web search call: the boards it names, as the AI gave them (not yet validated or judged)."""
    from ..ai import board_ideas, cost, engine
    from ..ai.models import SMALL_MODEL
    response = client.messages.create(
        model=SMALL_MODEL, max_tokens=MAX_TOKENS, system=[{'type': 'text', 'text': SYSTEM}],
        messages=[{'role': 'user', 'content': json.dumps(question, ensure_ascii=False)}],
        tools=[{'type': 'web_search_20250305', 'name': 'web_search', 'max_uses': MAX_USES}],
        output_config=engine.structured(board_ideas.SCHEMA, SMALL_MODEL, 'low'))
    cost.side(SMALL_MODEL, response.usage)
    return json.loads(next(block.text for block in response.content if getattr(block, 'type', '') == 'text')).get('boards') or []


def _named(answer, known, fetch):
    """The valid, new boards of the web search's answer (at most MAX_FOUND), each with its search link, before they are judged."""
    from ..ai import board_ideas
    hosts = {board['host'] for board in known}
    found = []
    for item in answer:
        board = board_ideas.valid(_with_search(item, fetch)) or board_ideas.valid(item)   # its search link first, else a field board's category page
        if board and board['host'] not in hosts and len(found) < MAX_FOUND:
            hosts.add(board['host'])
            found.append(board)
    return found


def _stamped(data, key, when, tries, thin):
    """The search's mark: when it was asked (once per due time, even when it fails) and the thin searches in a row (TRIES, then weekly)."""
    data.setdefault('web', {})[key] = when.isoformat(timespec='seconds')
    data.setdefault('web_thin', {})[key] = tries + 1 if thin else 0


def _told_again(data, key, last, working, tries):
    """Why a thin search asks again, said in the log, and what the last one found, for the question (the AI gets other words); {} when it is the first."""
    if last is None or len(working) >= WANT:
        return {}
    # said, never silent: why it searches again (owner's pilot run, 26 Oct 2026)
    print(f"Job boards: searching the web again: the last search ({last.isoformat(timespec='minutes')}) left {len(working)} of {WANT} "
          f'working boards for this search; try {tries + 1} of {TRIES}, with other words', flush=True)
    return {'searched before': {'times': tries, 'boards found then': [board.get('name') or board['host'] for board in
                                                                      (data.get('ideas') or {}).get(key) or [] if board.get('origin') == 'web']}}


def not_asked(search_config):
    """Why a search has no board proposal (board_ideas.asked_for is None), for its "no web search" line: no role, no place it can read (the fragment named), or
    no country known yet for its places. Why (13 Nov 2026, run 43328194035 p10): "names no places or roles" was said for a Lisbon search whose one place
    was written "lisb(on|oa)", so neither the person nor the run's reader could tell why."""
    from .. import places
    from ..notion.search_settings import terms
    if not terms((search_config or {}).get('role_keywords')):
        return 'this search names no roles'
    words = places.place_words(search_config or {})
    if not words:
        left = places.unread(search_config or {})
        return f"this search names no place it can read ({', '.join(left)})" if left else 'this search names no places'
    return f"the countries of your places are not known yet ({', '.join(words[:3])})"


def search(search_config, known, client=None, now=None, fetch=None, data=None):
    """The specialist and local boards one web search found for this search's proposal (validated, new hosts only), joined to the proposal;
    [] when off, not due, or the search fails. data: the caller's found_boards.json, written by the caller (start); else loaded and saved."""
    if careers.READER is None or disabled('web_search') or os.getenv('JOBADABRA_FIXTURE_DIR'):
        return []
    from ..ai import board_ideas
    now = now or datetime.now(timezone.utc)
    asked = board_ideas.asked_for(search_config)
    own, data = data is None, board_ideas.load() if data is None else data
    if not asked:
        print(f'Job boards: no web search: {not_asked(search_config)}', flush=True)
        return []
    key, countries, roles, kinds, places = asked
    run = _run(key)
    with _lock:
        again = run is not None and run in _searched
    if again:   # the first-jobs search and the full read are one run: its thin tries are one per run (tests/unit/sources/test_board_web_thin.py)
        print('Job boards: no web search: searched in this run', flush=True)
        return []
    kept, last, due = data.get('boards') or {}, _last(data, key), _next_search(data, key, data.get('boards'), search_config)
    raw = web_answers.take(web_answers.name(key, places), now, (data.get('web_used') or {}).get(key))   # an earlier search's answer, saved before it was judged: judged now, not asked again
    if raw is None and due is not None and now < due:   # the dates in this form: the app's web search chip reads them (session 89, 26 Oct 2026)
        print(f"Job boards: no web search: searched {last.isoformat(timespec='minutes')}, next after {due.isoformat(timespec='minutes')}; "
              'its boards are kept', flush=True)
        return []
    # judged only after a search (a first one asks no AI for the role's kind; it counts as thin: nothing it found works yet)
    working, tries = (_working(kept, search_config) if last is not None else []), int((data.get('web_thin') or {}).get(key) or 0)
    before = {} if raw is not None else _told_again(data, key, last, working, tries)
    if client is None and raw is None:
        client = _searcher()
        if client is None:   # said, never silent (owner's pilot run, 26 Oct 2026: no line told why no board was searched for)
            print('Job boards: no web search: no AI here searches the web (a signed-in Claude Code or Codex, an API key, or Free AI)', flush=True)
            return []
    if run is not None:
        with _lock:
            _searched.add(run)
    if raw is None or last is None or last < raw[1]:   # a saved answer whose asking run already stamped and counted it is not counted twice (Gitar, #3642)
        _stamped(data, key, raw[1] if raw is not None else now, tries, len(working) < WANT)
    if own:
        board_ideas.save(data)
    if raw is not None:
        print('Job boards: the web search answered in the last run; judging the boards it named, no new search', flush=True)
    with stage.guard('job boards: web search') as caught:
        question = {'countries': countries, 'places': places, 'roles': roles, 'kinds': kinds, 'known boards': [board['name'] for board in known], **before}
        answer = raw[0] if raw is not None else _ask(client, question)
    if caught:   # the proposal's boards stand
        print(f'Job boards: the web search for trade and local boards did not answer ({caught.reason})', flush=True)
        return []
    answered = raw[1] if raw is not None else web_answers.keep(web_answers.name(key, places), answer, now)
    fetch = fetch or careers.get_text
    found = _judged(_named(answer, known, fetch), roles, fetch)
    data = board_ideas.load() if own else data
    if found:
        ideas = data.setdefault('ideas', {})   # Why (E2b, 8 Nov 2026): data['ideas'] read before setdefault made a store with no ideas yet raise KeyError after the paid call
        ideas[key] = (ideas.get(key) or []) + [{**board, 'origin': 'web'} for board in found]
    data.setdefault('web_used', {})[key] = answered.isoformat(timespec='seconds')   # JUDGED: the saved answer of this time is used (web_answers.take)
    if own:
        board_ideas.save(data)
    print(f"Job boards: a web search found {', '.join(board['name'] for board in found) or 'no trade or local board'}", flush=True)
    return found
