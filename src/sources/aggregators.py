"""Job aggregators with public APIs: more jobs straight away, and every employer they name becomes a scout candidate (via the jobs table).

Free, no key: Arbeitnow (Europe, mostly Germany), Himalayas and Jobicy (remote). Each one's terms are kept: the job's own address and the
source's name go with every job (Jobicy, Arbeitnow ask for that), each is asked at most every SPACING_HOURS for the same search (a changed
search reads at once: 25 Oct 2026, a pilot search 8 minutes after a software one read no board), and only the roles and places of
this user's search are kept. Remotive is not used: its terms forbid passing its jobs to another product. job-room.ch (the Swiss public
employment service) is read as a national service (src/sources/national.py, owner 12 Nov 2026), not here.
"""
import http.client
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

from .. import read_methods, time_budget
from . import ats, board_employers, boards_ahead, eures, feeds, host_pace, owed_reads, posting_text
from ..press import resume, stage

SPACING_HOURS = 6
PAGES = 2
JOBSCH_PAGES = 5   # jobs.ch pages read at most per search and place (20 postings a page)
TIMEOUT = 30
CHEAP_PAST_CUT = ('EURES',)   # readers that run even past the read cut: each bounds its own time (eures.SECONDS)
TABLE = 'CREATE TABLE IF NOT EXISTS aggregator_runs (source TEXT PRIMARY KEY, at TEXT NOT NULL)'
TAKEN = {}   # (search key, reader) -> {'jobs', 'sources'} of what the first-jobs slice took earlier in this press (scan(early=True)): the free-API stage adds it to its report and does not read it again; cleared at the slice's start
SEARCH_TABLE = 'CREATE TABLE IF NOT EXISTS aggregator_searches (source TEXT PRIMARY KEY, search TEXT NOT NULL)'   # which search each last read was for
# The countries the place-country decision and Google Jobs know, code -> the English name places.countries() answers (src/places.py: the AI says which
# country each place word is in, in any language; 8 Oct 2026: a regex of ten countries' city names). Why (11 Nov 2026, owner: Adzuna and Jooble are
# "non-existing in our codebase"; remove them): the table was Adzuna's country list and outlived them, renamed, because _countries, the place-country decision and google_jobs.within_places read it.
COUNTRY_NAMES = {'gb': 'United Kingdom', 'us': 'United States', 'at': 'Austria', 'au': 'Australia', 'be': 'Belgium', 'br': 'Brazil',
                    'ca': 'Canada', 'ch': 'Switzerland', 'de': 'Germany', 'es': 'Spain', 'fr': 'France', 'in': 'India', 'it': 'Italy',
                    'mx': 'Mexico', 'nl': 'Netherlands', 'nz': 'New Zealand', 'pl': 'Poland', 'sg': 'Singapore', 'za': 'South Africa'}


def _get(url, data=None, headers=None, timeout=None):
    request = urllib.request.Request(url, data=data, headers={'User-Agent': ats.USER_AGENT, 'Accept': 'application/json', **(headers or {})})
    with host_pace.open(request, timeout or TIMEOUT) as response:
        return json.loads(response.read())


def _when(value):
    try:
        return datetime.fromtimestamp(int(value), timezone.utc).date().isoformat()
    except (TypeError, ValueError):
        return str(value or '')[:10]


def _job(source, id, title, company, location, url, posted='', description='', remote=False, salary=''):
    return {**ats._job(f'{source}:{id}', title, location, url, posted, ats.plain(description), remote, salary), 'company': posting_text.label(company) or 'Unknown employer'}


def arbeitnow(get=_get):
    jobs = []
    for page in range(1, PAGES + 1):
        for j in get(f'https://www.arbeitnow.com/api/job-board-api?page={page}').get('data', []):
            jobs.append(_job('arbeitnow', j.get('slug'), j.get('title'), j.get('company_name'), j.get('location') or ('Remote' if j.get('remote') else ''),
                             j.get('url'), _when(j.get('created_at')), j.get('description'), bool(j.get('remote'))))
    return jobs


def himalayas(get=_get):
    jobs, cursor = [], ''
    for _ in range(PAGES):
        data = get('https://himalayas.app/jobs/api?limit=100' + (f'&cursor={urllib.parse.quote(cursor)}' if cursor else ''))
        for j in data.get('jobs', []):
            where = ', '.join(j.get('locationRestrictions') or []) or 'Anywhere'
            jobs.append(_job('himalayas', j.get('guid'), j.get('title'), j.get('companyName'), f'Remote ({where})', j.get('applicationLink') or j.get('guid'),
                             _when(j.get('pubDate')), j.get('description') or j.get('excerpt'), True))
        cursor = data.get('nextCursor') or ''
        if not cursor:
            break
    return jobs


def jobicy(get=_get, tags=('devops', 'sre', 'cloud', 'kubernetes', 'platform')):
    jobs = []
    for tag in tags:
        for j in get(f'https://jobicy.com/api/v2/remote-jobs?count=50&tag={urllib.parse.quote(tag)}').get('jobs', []):
            jobs.append(_job('jobicy', j.get('id'), j.get('jobTitle'), j.get('companyName'), f"Remote ({j.get('jobGeo') or 'Anywhere'})", j.get('url'),
                             str(j.get('pubDate') or '')[:10], j.get('jobDescription') or j.get('jobExcerpt'), True))
    return jobs


def _queries(search):
    from ..notion.search_settings import terms
    return (terms(search.get('jobs_board_search_queries')) or terms(search.get('role_keywords')))[:4]


def _countries(search):
    """The countries of the user's places (at most four), by their codes in COUNTRY_NAMES, from what places.countries() knows; [] before it knows any. Google Jobs keeps its places by it (google_jobs.within_places)."""
    from .. import places
    names = places.countries(search, limit=10)
    words = places.place_words(search, tuple(group for group in (search.get('locations') or {}) if group != 'relocation'))   # the one reading of place fragments (#2920); "relocation" is yes/no, not a place
    cache = places.load()
    raw = [str(f) for group, items in (search.get('locations') or {}).items() if group != 'relocation' for f in items or []]   # a pattern with no plain reading ("(zurich|bern)") still names the Swiss market (in_switzerland reads it as text)
    if any(places.in_switzerland(w, cache) for w in [*words, *raw]) and 'Switzerland' not in names:
        names = ['Switzerland', *names]   # the first market from its fixed table, before (or without) the AI's answer
    codes = [code for name in names for code, country in COUNTRY_NAMES.items() if country == name]
    codes += list((place_countries(words) or {}).values())   # the AI's country for each place word (kept per word); its words only without AI
    return list(dict.fromkeys(c for c in codes if c in COUNTRY_NAMES))[:4]


PLACE_COUNTRY_TASK = 'A place name. Answer the code of the country it is in: ' + '; '.join(f'{c} = {n}' for c, n in COUNTRY_NAMES.items())


def place_countries(words):
    """{place word lowercased: country code or 'other'} by the AI (topic place-country, ai_first: a word in the text is not the place,
    "London, Ontario" is not in the UK); the pack's patterns only with no AI at all; a place past the AI's cap is left out (unknown).
    None when nothing is known. Shared with Google Jobs (src/sources/google_jobs.py within_places), so each place is asked once."""
    from ..ai import decide
    items = {str(w).lower(): str(w) for w in words if str(w or '').strip()}
    return decide.decide('place-country', items, (*COUNTRY_NAMES, 'other'), PLACE_COUNTRY_TASK) if items else {}


def jobsch(search, get=None):
    """jobs.ch, Switzerland's biggest job board, for any profession: the search pages' own job listing (schema.org data), for the user's job-board searches. Only for a search
    with Swiss places. Only the search pages are read (the job detail pages are not needed) (the same ones the employer discovery in
    boards.py reads, 0.35 s apart, kept 6 hours); a job's own jobs.ch address goes with it and the user opens it in the browser. The listing carries a short description only."""
    from . import boards
    if not boards.swiss_places(search):
        return []
    fetch = get or (lambda url, client=boards.Client(): client.get(url)['html'])
    jobs, seen = [], set()
    # The same searches as the employer discovery (boards.py, 6 Oct 2026): in the user's Swiss cities (and the whole country when wanted), each
    # board word on its own too, page by page until a short page or one with nothing new. Before: 4 searches, all of Switzerland, 2 pages: a
    # Geneva search got St. Gallen and Wallisellen, and two runs in a row found the same few jobs.
    for query in boards.jobsch_terms(search) or _queries(search):
        for place in boards.jobsch_places(search):
          for page in range(1, JOBSCH_PAGES + 1):
            try:
                markup = fetch('https://www.jobs.ch/en/vacancies/?' + urllib.parse.urlencode({'term': query, **({'location': place} if place else {}), 'page': page}))
            except urllib.error.HTTPError as error:
                if error.code in host_pace.REFUSED:   # a block is taken as it is, what was read is kept (6 Oct 2026)
                    print(f'Warning: jobs.ch refused more searches for now (HTTP {error.code}); {len(jobs)} job(s) read before that are kept')
                    return jobs
                raise
            except host_pace.Busy as error:   # it asked us to slow down for longer than this run waits: the next run goes on
                print(f'Warning: {error}; {len(jobs)} job(s) read before that are kept')
                return jobs
            listed = list(boards.walk(boards.Page(markup).schemas, 'JobPosting'))
            towns = ats.jobsch_towns(markup if isinstance(markup, str) else markup.decode('utf-8', 'replace'))
            fresh = 0
            for j in listed:
                url = j.get('url') or ''
                key = re.search(r'/detail/([0-9a-f-]{36})', url)
                if not (url and j.get('title') and key) or key.group(1) in seen:
                    continue
                seen.add(key.group(1))
                where = ats.posting_places(j, towns.get(key.group(1), ''))
                fresh += 1
                jobs.append(_job('jobsch', key.group(1), j['title'], (j.get('hiringOrganization') or {}).get('name'), ', '.join(where) or (f'{place} area, Switzerland' if place else 'Switzerland'),   # a search in a town: near it
                                 url, str(j.get('datePosted') or '')[:10], j.get('description')))
            if len(listed) < boards.PAGE_SIZE or not fresh:
                break
    return jobs


def technical_search(search):
    from ..coverage import technical_search as technical   # one definition of an IT search (role kinds)
    return technical(search)


def sources(env=None):
    """[(name, reader)] of the aggregators this install may use now (free ones always; keyed ones when their keys are set)."""
    env = os.environ if env is None else env
    from ..features import disabled
    found = [] if disabled('aggregators', env) else [('Arbeitnow', lambda search: arbeitnow()), ('Himalayas', lambda search: himalayas()),
                                                      ('Jobicy', lambda search: jobicy() if technical_search(search) else [])]   # its tags are IT ones
    if not disabled('aggregators', env) and not disabled('jobsch', env):
        found.append(('jobs.ch', jobsch))   # Swiss places only (it returns nothing otherwise)
    # The readers of src/sources/reader_rows.py, each behind its row's one gate (EURES: the installed app only, #3678); start_early and the first-jobs slice read through this list.
    from . import reader_rows
    found.extend((each.name, lambda search, each=each: each.read(None, search)) for each in reader_rows.ROWS if each.on(env))
    if not disabled('aggregators', env) and not disabled('found_boards', env):   # boards found for your countries (src/sources/found_boards.py)
        from . import found_boards
        found.append(('Job boards found', found_boards.read))
    return found


def search_key(search):
    """A short key of what a reader is asked for: the search's roles, board searches and places (other settings do not change a read)."""
    import hashlib
    search = search or {}
    places = search.get('locations') or {}
    parts = [sorted(map(str, search.get('role_keywords') or [])), sorted(map(str, search.get('jobs_board_search_queries') or [])),
             {key: sorted(map(str, places.get(key) or [])) for key in sorted(places)} if isinstance(places, dict) else []]
    return hashlib.sha256(json.dumps(parts, ensure_ascii=False).encode()).hexdigest()[:12]


def read_lately(db, name, now=None, search=None):
    """When reader `name` was last read, if that was within SPACING_HOURS for this search (it is not read again before), else None.
    Without a search, or a last read from before the key was kept, any search counts as the same one."""
    db.execute(TABLE)
    db.execute(SEARCH_TABLE)
    last = db.execute('SELECT at FROM aggregator_runs WHERE source = ?', (name,)).fetchone()
    at = datetime.fromisoformat(last[0]) if last else None
    if not at or at <= (now or time_budget.wall()) - timedelta(hours=SPACING_HOURS):
        return None
    kept_for = db.execute('SELECT search FROM aggregator_searches WHERE source = ?', (name,)).fetchone()
    return None if search is not None and kept_for and kept_for[0] != search_key(search) else at


def mark_read(db, name, now, search=None):
    """Reader `name` was read now (for this search)."""
    db.execute(TABLE)
    db.execute(SEARCH_TABLE)
    with db:
        db.execute('INSERT OR REPLACE INTO aggregator_runs (source, at) VALUES (?, ?)', (name, now.isoformat(timespec='seconds')))
        if search is not None:
            db.execute('INSERT OR REPLACE INTO aggregator_searches (source, search) VALUES (?, ?)', (name, search_key(search)))


def mark_read_unless_waiting(db, name, now, search, owed, cut=False):
    """Mark reader `name` read now unless something of it waits: -> True when it waits (its clock cut it, or `owed`, the jobs still waiting for an answer the AI owes them, is not empty), so the next
    search reads it again; the one place scan and keep_late decide it.
    Why (#3754, wj, WP8 rule 6): resting a source 6 h while its jobs wait for their place or title answer dropped them for 6 h (p10 on main: Arbeitnow 600 read, 9 kept, 495 never asked).
    Each re-read costs three GETs and AI calls only for what has no stored answer yet (feeds.triage and the place call skip the answered), so a search that answers more leaves less owed;
    once nothing is owed the source rests as before. An answer the AI never gives is bounded (owner, 12 Nov 2026: "Add a limit first"): owed_reads.MOST further searches read the source again, then it rests 6 h
    like the others (owed_reads.another_read, the one owner of the count)."""
    if cut or (owed and owed_reads.another_read(db, name, search_key(search) if search is not None else '')):
        return True
    owed_reads.clear(db, name)   # at most owed_reads.MOST re-reads for jobs that keep waiting (owner, 12 Nov 2026), then the source rests as any other
    mark_read(db, name, now, search)
    return False


def _item(db, name, job, now):
    """One matched job in the report's shape, recorded in the seen history (its status is the first one it gets)."""
    return {**{k: job[k] for k in ('company', 'id', 'title', 'url', 'date_posted', 'description')},
            'location': job['location'] or 'Unspecified', 'work_mode': 'Remote (stated)' if job['remote'] else '',
            'salary_text': job['salary'], 'notes': f'Found on {name}', 'source': name, 'source_kind': 'job board',
            'status': feeds.record(db, name.lower(), job, now.isoformat(timespec='seconds'))}


def early_items(db, name, jobs, shown, now=None):
    """The jobs the AI's title sort just said fit (feeds.triage hands them batch by batch, src/ai/title_queue.py) that are in your places, in the report's shape,
    recorded once and kept in `shown` ({url: item}) -> the new ones; `kept` then takes them as they are. Why (#2918, owner 6 Nov 2026: "Score from the nearest
    batches as they land"): the first job no longer waits for a whole sort."""
    now, items = now or time_budget.wall(), []
    with db:
        for job in jobs:
            if job.get('url') and job['url'] not in shown:
                shown[job['url']] = _item(db, name, job, now)
                items.append(shown[job['url']])
    board_employers.fill_missing(items)
    board_employers.note(items, name)
    return items


def kept(db, name, found, now=None, shown=None, owed=None):
    """One reader's jobs in your roles and places, in the report's shape, each recorded in the seen history; their employer named
    (board_employers). Also the first-jobs slice's proven boards (src/first_jobs.py). shown: {url: item} of the jobs handed early (early_items),
    taken as they are, not recorded again. owed: a list that gets each job still waiting for an answer the AI owes it (stage never_asked): their source is not rested (scan)."""
    from collections import Counter
    from . import job_stage
    now, matched, fresh, shown, stages, places = now or time_budget.wall(), [], [], shown if shown is not None else {}, Counter(), {}
    feeds.triage(found)   # their titles judged by the AI first, the role words' hits too (owner, 26 Oct 2026: "The AI decides")
    if name == boards_ahead.NAME:   # a board was searched for your place: what it lists one town over is asked about after the search (src/sources/places_later.py)
        from . import places_later
        places_later.note(found)
    with db:
        for job in found:
            if job.get('url') in shown:
                matched.append(shown[job['url']])
                stage = 'kept'
            elif job.get('url') and feeds.wanted_title(job['title']) and feeds.wanted_location(job):
                matched.append(_item(db, name, job, now))
                fresh.append(matched[-1])
                stage = 'kept'
            else:
                stage = job_stage.of(job, places)   # Why (sa's plan WP3 and #3709's yardstick, 10 Nov 2026): each job read gets a stage, none unseen; one `places` per pass keeps the place words to once per location
            stages[stage] += 1
            if stage == 'never_asked' and owed is not None:
                owed.append(job)
            job_stage.say_one(name, stage, job)
    job_stage.say(name, len(found), stages)
    board_employers.fill_missing(fresh)   # the page's own hiringOrganization, a few per run
    board_employers.note(matched, name)
    return matched


def scan(db, search, now=None, readers=None, on_jobs=None, ahead=None, early=False, shown=None, lane=None):
    """A feeds.scan-style report ({'jobs', 'sources'}) from the aggregators that are due; your roles and places only, source named on each job.
    on_jobs(jobs): each reader's jobs as soon as it is read (owner, 18 Oct 2026: jobs shown as quickly as possible). ahead: the found boards
    already read beside the employer sites (src/sources/boards_ahead.py), taken instead of read again. early: the first-jobs slice takes `readers` now (TAKEN).
    shown: {url: item} of the jobs the slice handed early (kept). lane: the APIs already asked from the press's start (src/sources/api_lane.py),
    taken here, never asked again; one still reading at the read cut waits for the next search. The lane's one said state is report['said']."""
    resume.ran('free job APIs')   # this process ran the step: its end-of-run count may say 0 (src/press/resume.py)
    report = {'jobs': [], 'sources': []}
    # The end-to-end fixture mode reads feeds from files and never reaches a live site (careers.py does the same): real postings from a public API would land in a test's data
    # (3 Oct 2026: jobicy rows in the quality suite). `readers` given = a test of this function itself.
    if readers is None and os.getenv('JOBADABRA_FIXTURE_DIR'):
        return _done(report)
    now = now or time_budget.wall()
    db.execute(TABLE)
    from . import read_budget
    late = []   # due past the search's read cut: not read, not marked read; the next search reads them (tests/unit/sources/test_three_minutes.py)
    key = search_key(search)
    for name, read in (readers if readers is not None else sources()):
        if not early and (key, name) in TAKEN:   # Why (#2918, 6 Nov 2026): the slice took it; a second read in the same press only repeats it
            taken = TAKEN[(key, name)]   # its jobs still belong to the final report (statuses, counts), its source line too
            report['jobs'].extend(taken['jobs'])
            report['sources'].extend(taken['sources'])
            continue
        lately = read_lately(db, name, now, search)
        if lately and name != boards_ahead.NAME:   # the found boards rest one by one (board_yield.not_read_since)
            continue
        # Why (27 Oct 2026, benchmark run 40451692782; lanes 3/5, #3754, 11 Nov 2026): asked after the employers and boards, past the read cut, EURES
        # was queued in every persona (it reads anyway: a few requests on its own clock) and every other free API gave 0 jobs for 14 of 14 people
        # (night 42927975750); so the lane asks them at second 0 (api_lane.py) and its reads are taken past the cut; one still reading waits (_Cut).
        started = lane is not None and name in lane.reads
        if read_budget.past_cut() and name not in CHEAP_PAST_CUT and not started and not (ahead is not None and name == boards_ahead.NAME):   # the boards read beside the employers are only taken
            late.append(name)
            continue
        with stage.guard('free job APIs: read') as caught:   # Why (lanes 3/5, 11 Nov 2026): any error of one reader is that source failing, never the run (a RuntimeError ended it)
            try:
                owed = []   # this reader's jobs still waiting for the AI's answer
                found, matched = _one(db, search, name, read, now, shown, ahead, lane if started else None, lately, owed)
            except _Cut:   # still reading at the read cut: not marked read, the next search takes it
                late.append(name)
                continue
            except (urllib.error.URLError, OSError, http.client.HTTPException, ValueError, KeyError, TypeError, *ai_errors()) as error:
                _source_failed(report, name, error)
                continue
            # EURES stopped by its clock: what it read is kept, the rest waits (gitar-bot, #2251); a job the AI has not answered for yet (stage never_asked) waits too, WP8 rule 6 (#3754)
            cut_now = name == 'EURES' and eures.CUT[0]
            if mark_read_unless_waiting(db, name, now, search, owed, cut=cut_now) and (cut_now or not matched):   # a read whose matched jobs were kept is not "cut" (owner, 12 Nov 2026; Gitar on #3893)
                late.append(name)
            if on_jobs and matched and not (ahead is not None and name == boards_ahead.NAME and ahead.shown):   # shown already
                on_jobs(matched)
            report['jobs'].extend(matched)
            report['sources'].append({'company': name, 'ok': True, 'total': len(found), 'matches': len(matched)})
            if early:   # only a read that worked is taken; a failed one is the free-API stage's to try
                TAKEN[(key, name)] = {'jobs': list(matched), 'sources': list(report['sources'][-1:])}
        if caught:
            _source_failed(report, name, caught.error)
    if late:
        time_budget.later('free job APIs', len(late), 'sources' if len(late) != 1 else 'source')
    if not early:
        report['said'] = _said(report, late)   # the lane's one state, in the run's own report (no module state: test_run_state_only_shrinks)
    return _done(report)


def keep_late(db, search, lane, on_jobs, until, now=None):
    """The jobs of the lane's reads that ended after the scan's read cut (scan left them: _Cut), kept as the scan keeps one and shown through on_jobs; each read once.
    `until`: time.monotonic() to wait for a read still going (a time already past takes only the ended ones). A source whose jobs still wait for an answer is not
    marked read, as in scan.
    Why (#3754, wj, WP8 rule 6; p10's press 2 on main, 12 Nov 2026): a read judges its own titles in its thread, so 600 titles done at 165 s of 180 ended its read after the
    cut; the scan left it and the lane closed, so the read was dropped and asked again next search, the same way each time. Called between the stages after the gather
    and at the run's end (daily_search.keep_late_apis), as the boards' groups are (keep_late_boards)."""
    if lane is None:
        return []
    from ..ai import batch_scope
    now, jobs = now or time_budget.wall(), []
    for name in [name for name in lane.reads if name not in lane.taken]:
        with stage.guard('free job APIs: late read') as caught:
            taken = lane.take(name, until)
            if taken is None:   # still reading: the run ends first, the next search asks again
                continue
            found, views = taken
            owed = []
            with batch_scope.using(views):
                matched = kept(db, name, found, now, None, owed)
            mark_read_unless_waiting(db, name, now, search, owed)
            if matched:
                on_jobs(matched)
            jobs.extend(matched)
        if caught:
            print(f'Warning: free job API {name}: its late read failed: {caught.reason}', flush=True)
    return jobs


class _Cut(Exception):
    """A read started from the press's start is still reading at the read cut."""


def _one(db, search, name, read, now, shown, ahead, lane, lately, owed):
    """(jobs listed, jobs kept) of one reader: the found boards read beside the employers taken, a read the lane started taken (raises _Cut
    while it still reads at the cut), any other read now."""
    from . import read_budget
    if ahead is not None and name == boards_ahead.NAME:
        return ahead.take(db, now)
    if lane is not None:
        taken = lane.take(name, read_budget.cut_at())
        if taken is None:
            raise _Cut
        found, views = taken
        from ..ai import batch_scope
        with batch_scope.using(views):   # the lane's own title answers (api_lane._read): kept() asks nothing it judged
            return found, kept(db, name, found, now, shown, owed)
    elif name == boards_ahead.NAME:   # the found boards count one by one (found_boards.read_board)
        found = read(search, since=now - timedelta(hours=SPACING_HOURS)) if lately else read(search)
    else:
        with read_methods.reading(name, 'feed_api') as counted:   # a free job API is a feed
            found = read(search)
            counted.jobs = read_methods.in_places(found)
    return found, kept(db, name, found, now, shown, owed)


def _said(report, late):
    """The free job APIs' lane's one state: failed when some failed and none read (Why, #3802, 11 Nov 2026: also when others still wait, so a failure
    is never hidden behind a wait), else cut when one of its sources waits for the next search, else done."""
    from . import api_lane
    own = [row for row in report['sources'] if row.get('company') not in (*api_lane.NOT_HERE, boards_ahead.NAME)]
    late = [name for name in late if name not in (*api_lane.NOT_HERE, boards_ahead.NAME)]
    failed = [row for row in own if not row.get('ok')]
    if failed and len(failed) == len(own):
        waiting = f'; {len(late)} wait for the next search' if late else ''
        return stage.Result(stage.FAILED, (failed[0].get('error', '').split(':')[0] or 'failed') + waiting)
    if late:
        return stage.Result(stage.CUT, f'{len(late)} wait for the next search')
    return stage.Result(stage.DONE)


def ai_errors():
    """The errors a model call can end with (the contract's own and the SDK's, after its retries): one source's AI step failing is that source failing."""
    from ..ai import engine
    from ..ai.providers.contract import AiError
    return (AiError, *engine.transient_errors(), *engine.permanent_errors())


def _source_failed(report, name, error):
    """One source could not be read: it is listed as failed and the run goes on with the others. An AI error is also said as a plain warning with its
    technical line (decide.failed), and a spent limit stops the run's further asks.
    Why (se, 4 Nov 2026, Sentry APP-4B/4A): EURES asks the AI which area a place is in; a key the API refused (401) is not a network error, so it left
    this guard and ended the whole Find jobs run in its first minute, with every other source unread. Same boundary, same day: a server that cut a sitemap
    short mid-body raises http.client.IncompleteRead (an HTTPException, not an OSError) and ended a run the same way (APP-2Y/2Z, 20 Oct 2026)."""
    report['sources'].append({'company': name, 'ok': False, 'error': f'{type(error).__name__}: {error}'})
    if isinstance(error, ai_errors()):
        from ..ai import decide
        decide.failed(f'{name} read', error)


def _done(report):
    """The step's end, said once every board and job API is read (the found boards read beside the employer sites and those a web search found
    mid-run included): the Find card's "Job boards" chip shows ✓ only then (desktop/renderer/find-card-model.js stepChips; owner, 26 Oct 2026)."""
    print(f"Job boards: done, {len(report['jobs'])} job(s) for your search", flush=True)
    return report
