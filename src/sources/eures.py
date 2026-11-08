"""EURES, the EU's public job-vacancy portal (national employment services of 31 countries), for the user's own places: the one free source whose
postings carry a regional code, so a job is kept only when its code lies in the user's place (owner, 27 Oct 2026: "right role in the wrong place";
a blind round of 10 personas found 115 local matches here and 13 in ours). Public search API, no key and no login, read like the portal's own page
does; each job's own EURES address goes with it. Read by: src/sources/aggregators.py (sources()). Tests: tests/unit/sources/test_eures.py.

The portal returns each job's NUTS-3 code, so the city's NUTS-2 region is asked once from the AI (a fixed shape the code validates against the map's
country: a bad answer is dropped, the place is then not read) and a job counts when its code starts with it. Its place filter takes one code level per
country (measured 5 Nov 2026: NUTS-1 in DE and BE, 2 in FR, ES, IT, NL, AT, DK, 3 in SE, FI, CZ), ignores a code it does not know and answers any of a list.

One read, owned by eures() (owner, 5 Nov 2026, #2918: "Redesign the read"): the person's regions in their place order, then each country; in each area every
role word's first page before any second page; what was read is kept whatever ends the read.
"""
import http.client
import json
import re
import threading
import time
import urllib.parse

from . import nuts_names
from .. import geo
from ..press import rank
from ..paths import DATA

URL = 'https://europa.eu/eures/api/jv-searchengine/public/jv-search/search'
DETAIL = 'https://europa.eu/eures/portal/jv-se/jv-details/'
COUNTRIES = frozenset('AT BE BG HR CY CZ DK EE FI FR DE HU IS IE IT LV LI LT LU MT NL NO PL PT RO SK SI ES SE CH'.split())   # the portal's member countries
PAGE_SIZE = 50
MAX_PAGES = 6   # per role word and area: the best matches first, the rest waits for another search
KEEP = 100   # per area: enough near home, the next place gets its turn
MOST = 200   # per read: a read returned 173-234 jobs before areas (#2918), so the AI steps after it keep their load
LAST_PAGE = 3   # seconds a page asked just before the stop time still gets
SECONDS = 25   # with no run deadline, a read stops asking for more pages this long after its first page may go


CUT = [False]   # the last read ended on its clock, not on its pages: src/sources/aggregators.py scan queues it instead of marking it read
HELD = [[]]   # the jobs the read under way has so far: read() keeps them when that read runs past its time


def stop_at(began):
    """The monotonic time after which nothing more may be asked: where the AI steps' share starts (titles reserve + tail), so EURES, which runs past the read cut, never extends the press
    (27 Oct 2026, owner's rule: one 180 s deadline for every stage, tests/unit/sources/test_three_minutes.py; 6e's review). `began` counts only with no run deadline.
    Why (5 Nov 2026, #2918): the read started with the search is taken at the ~68 s cut, so a share of its own (18.75 s of a 135 s press, about 5 cold pages) left up to 30 s unused while
    words and places went unasked. The run's end, not a step's share: the AI steps run in their own stage (benchmark 40504636029: a stage end of ~75 s cut every read)."""
    from .. import time_budget
    end = time_budget.DEADLINE
    return began + time_budget.part(SECONDS) if end is None else end - time_budget.part(time_budget.RESERVE['titles'] + time_budget.TAIL)


def out_of_time(began, now=None):
    """True when no more page may be asked (stop_at)."""
    return (time.monotonic() if now is None else now) >= stop_at(began)


STORE = DATA / 'eures_regions.json'
LOCK = threading.Lock()
NUTS2 = re.compile(r'[A-Z]{2}[0-9A-Z]{2}')
SCHEMA = {'type': 'object', 'additionalProperties': False, 'required': ['regions'], 'properties': {'regions': {'type': 'array', 'items': {
    'type': 'object', 'additionalProperties': False, 'required': ['n', 'nuts2'],
    'properties': {'n': {'type': 'integer'}, 'nuts2': {'type': 'string', 'description': 'The code of the listed region it lies in, "" when unsure'}}}}}}
# Why (5 Nov 2026, #2918): `from the regions listed below` — asked from memory, the same Toulouse got FRJ2 in 2 installs and FR61, a code of no NUTS 2021 region, in 2; a job's own code then
# never matched and the region asked gave 0 rows. The AI judges which region; the table says which codes exist (src/sources/nuts_names.py: no AI names a code).
SYSTEM = """You give the EU's NUTS-2 statistical region that each numbered place lies in, for a town, city or area, from the regions listed below (code and name): answer its code exactly as \
listed. The place words come from a job seeker, in any language. When a place is a whole country, a region wider than one listed region or you are unsure, answer "". Never answer a code that \
is not listed."""
NO_LIST = 'No list could be read: answer the NUTS 2021 code only when you are sure of it.'   # the table's fetch failed: "listed below" would point at nothing and every place come back ""


def _read():
    try:
        data = json.loads(STORE.read_text())
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _real(code, country, table):
    """True for a NUTS-2 code of this country that exists; with no table (a failed fetch) its shape is all there is to check: a wrong code then costs a page a word, the country is still asked."""
    return bool(NUTS2.fullmatch(code or '')) and code[:2] == country and (not table or code in table)


def _listed(countries, table):
    """The real NUTS-2 regions of these countries, one "<code> <name>" a line: the AI's fixed choice."""
    return '\n'.join(f'{code} {name}' for code, name in sorted(table.items()) if len(code) == 4 and code[:2] in countries)


def regions(words, client=None):
    """{place word: [NUTS prefix]} for the user's place words in the portal's countries: a country word gives its 2-letter code, a town or area its
    NUTS-2 region from the AI (asked once, kept in data/eures_regions.json; validated against the map's country and Eurostat's table, so a kept code the table lacks is asked again).
    A word the AI is unsure of, or any word when no AI answers, is left out (unknown, not guessed)."""
    words = list(dict.fromkeys(str(w).strip() for w in words if str(w or '').strip()))
    mapped = geo.resolve(words, client)
    table = nuts_names.names() if words else {}
    out, todo, kept = {}, [], _read()
    for word in words:
        entry = mapped.get(geo.norm(word))
        if not entry or entry.get('cc') not in COUNTRIES:
            continue
        if entry['kind'] == 'country':
            out[word] = [entry['cc']]
        elif _real(kept.get(geo.norm(word)), entry['cc'], table):
            out[word] = [kept[geo.norm(word)]]
        else:
            todo.append(word)
    if todo:
        found = _ask(todo, client, _listed({mapped[geo.norm(word)]['cc'] for word in todo}, table))
        for word, code in found.items():
            ok = _real(code, mapped[geo.norm(word)]['cc'], table)
            out[word] = [code] if ok else []
            if ok:
                kept[geo.norm(word)] = code
        with LOCK:
            STORE.parent.mkdir(parents=True, exist_ok=True)
            STORE.write_text(json.dumps({**_read(), **{k: v for k, v in kept.items() if v}}, ensure_ascii=False, sort_keys=True))
    return {word: prefixes for word, prefixes in out.items() if prefixes}


def _ask(words, client=None, choices=''):
    from ..ai import cost, engine
    from ..ai.models import SMALL_MODEL
    if client is None:
        client = engine.client(action='place_triage') if engine.ready() else None
    if client is None:
        return {}
    listed = '\n'.join(f'{n}. {word}' for n, word in enumerate(words, 1))
    response = client.messages.create(model=SMALL_MODEL, max_tokens=1500, system=[{'type': 'text', 'text': f'{SYSTEM}\n\n{choices or NO_LIST}'}],
                                      messages=[{'role': 'user', 'content': f'Places:\n{listed}'}], output_config=engine.structured(SCHEMA, SMALL_MODEL, 'low'))
    cost.side(SMALL_MODEL, response.usage)
    answer = json.loads(next(b.text for b in response.content if b.type == 'text'))
    return {words[item['n'] - 1]: str(item.get('nuts2') or '').strip().upper() for item in answer.get('regions') or []
            if isinstance(item.get('n'), int) and 1 <= item['n'] <= len(words)}


def _body(query, codes, page):
    return {'resultsPerPage': PAGE_SIZE, 'page': page, 'sortSearch': 'BEST_MATCH', 'keywords': [{'keyword': query, 'specificSearchCode': 'EVERYWHERE'}],
            'publicationPeriod': None, 'occupationUris': [], 'skillUris': [], 'requiredExperienceCodes': [], 'positionScheduleCodes': [], 'sectorCodes': [],
            'educationAndQualificationLevelCodes': [], 'positionOfferingCodes': [], 'locationCodes': codes, 'euresFlagCodes': [],
            'otherBenefitsCodes': [], 'requiredLanguages': [], 'minNumberPost': None, 'sessionId': 'jobadabra'}


def _where(codes, country):
    """"<area>, <country>" for where the job IS: the area its own code names in Eurostat's table; the country alone when the table lacks it. Why (27 Oct
    2026, search check 40528942517, persona Sofia): the location was the person's place word ("bulgaria, Bulgaria" on a job ~200 km away), so no place check
    could tell where the job was; the portal gives no city, only this code."""
    table = nuts_names.names()
    area = next((table[c] for c in sorted(codes, key=len, reverse=True) if c in table and c.startswith(country)), '')
    name = geo.country_name(country) or country
    return f'{area}, {name}' if area else name


def _codes(area, table):
    """The portal's codes for one area: the area, then its parent and its parts, as one request's list. Why (5 Nov 2026, #2918, measured on 20 countries): a NUTS-2 code gives 0 rows
    where the filter works one level up (Munich, Brussels) or down (Stockholm, Prague); the filter ignores a code it does not know, so the list costs no page and needs no table of countries."""
    if len(area) == 2:
        return [area.lower()]
    return [code.lower() for code in (area, area[:3], *sorted(c for c in table if len(c) > len(area) and c.startswith(area)))]


def _areas(wanted, places):
    """The areas to ask, nearest first, each as its _codes: the regions in the person's place order (`wanted` puts words it asked the AI after kept ones), then each country,
    always last, so a code the portal does not know loses nothing."""
    table = nuts_names.names() if wanted else {}
    named = [wanted[word][0] for word in (place.strip() for place in places) if word in wanted]
    return [_codes(area, table) for area in rank.areas(named)]


def _words(search):
    """Every role word, the board searches first, each once. Why (5 Nov 2026, #2918, Copenhagen): the first three were compounds with 0 rows in all of Denmark, while "lærer" had 183."""
    from ..notion.search_settings import terms
    words = {}
    for word in terms(search.get('jobs_board_search_queries')) + terms(search.get('role_keywords')):
        words.setdefault(word.casefold(), word)
    return list(words.values())


def _mine(wanted, country, anywhere):
    """{place word: prefixes} that admit a job in this country.
    Why (27 Oct 2026, benchmark 40509412515, persona Krakow): the country word matched every Polish job, shown as "poland, Poland" (1 of 52 local). With a town or area named in this
    country, a country word admits nothing unless the person listed it as "anywhere in the country" (gitar-bot, #2275); EURES has no remote flag to tell the other exceptions."""
    mine = {word: prefixes for word, prefixes in wanted.items() if prefixes[0][:2] == country}
    if any(len(prefixes[0]) > 2 for prefixes in mine.values()):
        return {word: prefixes for word, prefixes in mine.items() if len(prefixes[0]) > 2 or geo.norm(word) in anywhere}
    return mine


def _pages(codes, words, began, get):
    """Each listed page of one area. Why (5 Nov 2026, #2918): a cold share is about 5 pages, so every word's page 1 goes before any word's page 2; a word that ran out of rows leaves
    the list, so a word with no rows costs one page. Ends on the clock with CUT set."""
    left = list(words)
    for page in range(1, MAX_PAGES + 1):
        for word in list(left):
            if out_of_time(began):
                CUT[0] = True
                return
            # a request waits at most until the stop time, so a slow page cannot run into the AI steps' share (gitar-bot, #2251)
            data = get(URL, json.dumps(_body(word, codes, page)).encode(), {'Content-Type': 'application/json'}, timeout=max(LAST_PAGE, min(30, stop_at(began) - time.monotonic())))
            listed = data.get('jvs') or []
            if len(listed) < PAGE_SIZE:
                left.remove(word)
            yield listed


def _timed_out(error):
    """True for a page that took too long, raised bare while reading or wrapped by urllib while connecting."""
    return isinstance(error, TimeoutError) or isinstance(getattr(error, 'reason', None), TimeoutError)


def eures(search, get=None, client=None):
    """EURES vacancies for the user's role words, kept only where a job's region code lies in one of the user's places; each carries "<area its own code names>,
    <country>" as its location (the country alone when unnamed), never the person's place word. [] with no place in the portal's countries. `get(url, data, headers)` returns the parsed JSON.
    Asked nearest area first (_areas, _pages), at most KEEP per area and MOST per read. A page that times out, or fails after jobs were read, ends the read with them and CUT set;
    a failure with nothing read raises, so the source is reported as failed. A refusal (401/403) or a slow-down past host_pace's own wait (Busy) ends the read: it asks nothing again."""
    from . import aggregators
    from ..places import place_words
    get = get or aggregators._get
    began = time.monotonic()
    CUT[0] = False
    jobs = HELD[0] = []
    if out_of_time(began):   # started past its share: nothing is asked, not even the region question (gitar-bot, #2251)
        CUT[0] = True
        return []
    places = place_words(search, per_group=6)   # the one reading of the place fragments (src/places.py): a letter choice (krak[oó]w) is its spellings, not dropped (#2920)
    wanted = regions(places, client)
    areas = _areas(wanted, places)
    # Why (5 Nov 2026, #2918): the clock counts pages, not the AI wait. Two queued AI answers took 36 s of an 18.75 s share (135 s press), so a read asked no page and listed 0 jobs;
    # stop_at still ends it before the AI steps' share, so the press keeps its deadline.
    began = time.monotonic()
    anywhere = {geo.norm(word) for word in place_words(search, ('country_wide',), 6)}
    words = _words(search)
    seen = set()
    try:
        for codes in areas:
            country = codes[0][:2].upper()
            mine, before = _mine(wanted, country, anywhere), len(jobs)
            for listed in _pages(codes, words, began, get):
                for j in listed:
                    found = [c.upper() for held in (j.get('locationMap') or {}).values() for c in held or [] if c]
                    word = next((w for w, prefixes in mine.items() if any(c.startswith(p) for c in found for p in prefixes)), None)
                    if not word or j.get('id') in seen or not j.get('title'):
                        continue
                    seen.add(j['id'])
                    jobs.append(aggregators._job('eures', j['id'], j['title'], (j.get('employer') or {}).get('name'),
                                                 _where(found, country), DETAIL + urllib.parse.quote(j['id']) + '?lang=en',
                                                 aggregators._when((j.get('creationDate') or 0) // 1000), j.get('description')))
                if len(jobs) >= MOST:
                    return jobs[:MOST]
                if len(jobs) - before >= KEEP:
                    break
            if CUT[0]:
                return jobs
    except (OSError, http.client.HTTPException, ValueError) as error:
        if not jobs and not _timed_out(error):
            raise
        CUT[0] = True
        print(f'EURES: a page failed ({type(error).__name__}), keeping the {len(jobs)} read', flush=True)
    return jobs


_early = {}   # the search's key -> the read started with the search (start_early)


def start_early(search):
    """Read EURES in the background from the search's first second, so the free-API stage (which starts at 72-107 s, past the title budget) only takes
    the result. Why (27 Oct 2026, benchmark 40504636029): started inside that stage, EURES was queued by the clock in all 10 personas (0 jobs). Returns the
    future, or None in the end-to-end fixture mode."""
    import os
    from concurrent.futures import ThreadPoolExecutor
    if os.getenv('JOBADABRA_FIXTURE_DIR'):
        return None
    from . import aggregators, feeds
    from ..ai import slots
    # Why (gitar-bot, #2261): an early read must not run when the stage would not take it: its switch is off (not in sources()), or it rests SPACING_HOURS.
    if 'EURES' not in dict(aggregators.sources()):
        return None
    try:
        with feeds.database(DATA / 'jobs.sqlite') as db:
            if aggregators.read_lately(db, 'EURES', search=search):
                return None
    except Exception:  # noqa: BLE001 — no readable history: read, as a first search does
        pass
    pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix='eures')
    # Why (#2235, gitar): a pool thread starts at NORMAL; the region question is one short call at the run's start, so it queues FIRST
    future = pool.submit(slots.carry(eures, slots.FIRST), search)
    pool.shutdown(wait=False)
    _early[aggregators.search_key(search)] = future
    return future


def early(search):
    """The read started with this search (start_early), still to be taken; None without one. The first-jobs slice joins it once it has read (src/first_jobs.py)."""
    from . import aggregators
    return _early.get(aggregators.search_key(search))


def read(search, keep=False):
    """The free-API stage's reader: the read started with the search when there is one (waited for until the run's stop time), else a read now.
    Prints what it found, so a press log shows whether EURES gave jobs. keep: the first-jobs slice's look (src/first_jobs.py): the early read stays for the
    free-API stage when the slice ends before it has read (#2918, Gitar)."""
    from concurrent.futures import TimeoutError as Late
    from . import aggregators
    future = (_early.get if keep else _early.pop)(aggregators.search_key(search), None)
    if future is None:
        jobs = eures(search)
    else:
        try:
            jobs = future.result(timeout=max(0, stop_at(time.monotonic()) - time.monotonic()) + LAST_PAGE + 1)
        except Late:
            # Why (5 Nov 2026, #2918): on Python 3.11+ Late is the builtin TimeoutError, so a timeout inside the task lands here too; only a task still running is late.
            if not future.done():
                jobs = list(HELD[0])
                CUT[0] = True
                print(f'EURES: still reading when its time ended, keeping the {len(jobs)} read so far; the rest waits for the next search', flush=True)
                return jobs
            jobs = future.result()
    print(f'EURES: {len(jobs)} vacanc{"y" if len(jobs) == 1 else "ies"} in your places read', flush=True)
    return jobs
