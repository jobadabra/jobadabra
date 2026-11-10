"""The reference of the nightly Search check, the market count (owner, 6 Nov 2026: "how to know if it's a good or bad result?"; 10 Nov 2026: "summing all the jobs I found (that's what a
normal person would do without Jobadabra)… should be the number what Jobadabra finds"): for each of the 18 fictional candidates, the right-role, right-place jobs each source of the plan's
fixed list shows when a person searches it by hand, read OUTSIDE the app, judged by the nightly check's blind judge (gate_judge.py) in one pass, so a night and the market are judged by the same eyes.
Sources counted so far: EURES's public API (the city's NUTS-2 region, the role in the place's own language) and the country's national job board (market_boards.py, one data row per country:
sa's design, 10 Nov 2026), a web search (market_web.py: the AI's web search tool asked for postings of the role in the city, one call per person) and the employer
career sites of the central index whose places name the region (market_employers.py: each employer's own public feed, no AI; a floor, with its shortfall as numbers). Free job APIs are "none (no query)" (none takes a role and a place; Adzuna and Jooble stay parked until the owner adds them); LinkedIn is "by hand" (never read here).
Why no Google (owner, 6 Nov 2026: "I'd rather keep it for central scout. To gain more value out of it"): the SerpApi quota is the central scout's alone.
  node tools/persona-search/codex.mjs -- python3 tools/persona-search/reference.py run <out.json>   read every source, judge blind behind the Codex relay, write the counts
  python3 tools/persona-search/reference.py send <out.json>                                         PUT the counts to Admin (only a CI run on main; GITHUB_RUN_ID, REPLAYS_PUBLISH_KEY)
Beside <out.json>, `reference-jobs.json` keeps each right job (title, employer, link, the sources that showed it), each source's status per person and the date of the count, for the run's
artifact only: it is never sent (send reads the counts file).
Why (10 Nov 2026, sa's finish-line plan WP3, owner: "our search results should always be what EURES gives + some additional sources"): a night's loss is counted per job and
per stage, which needs the reference's jobs, not only their count.
Record ([mc] 5/5, the shape agreed with oe for Admin's "Market coverage", 10 Nov 2026): {"personas": {"<n>": {total, reachable, eures, market, counted_on,
sources: {<eures|public_board|web_search|employer_sites|free_job_apis|linkedin>: {status, read, right, only}}}}}; total = reachable = the EURES count (Admin labels it
"EURES reference"); market = distinct right jobs (title + employer) of every counted source; a source's status is "counted", "partial: …" (counted, its shortfall said),
"not counted: <why>", "none (…)" or "by hand", and its numbers are null unless it was counted, never 0.
A persona whose EURES was not read, or whose judge failed, is left out of the record (Admin then says "no reference"); its board count and jobs still go to reference-jobs.json. Admin: jobadabra-web admin/search-reference.js. Tests: tests/tooling/ci/test_search_reference.py."""
import concurrent.futures
import datetime
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(HERE))
from gate import PERSONAS  # noqa: E402
import gate_judge  # noqa: E402
import market_boards  # noqa: E402
import market_employers  # noqa: E402
import market_web  # noqa: E402

SITE = 'https://www.jobadabra.top/search-check/reference'
USER_AGENT = 'jobadabra-reference'   # Why (6 Nov 2026, run 42299710525): the site's edge answers 403 to urllib's default `Python-urllib/3.x`, so every call here names itself
EURES_PAGES = 2   # per role word: the best matches first, 100 jobs; a city region rarely has more right ones (measured 6 Nov 2026: 8 jobs for "charpentier" in Brussels)


def eures_post(body):
    """One EURES search page (the public API: no key, no login) -> the parsed JSON; raises on a network or HTTP failure."""
    from src.sources import eures
    request = urllib.request.Request(eures.URL, data=json.dumps(body).encode(), headers={'Content-Type': 'application/json', 'User-Agent': USER_AGENT})
    with urllib.request.urlopen(request, timeout=40) as response:
        return json.load(response)


def eures_rows(persona, post=eures_post):
    """The jobs EURES lists for the persona's role words in the city's NUTS-2 region (the area, its parent and its parts), each as the judge reads it: title, employer, "<area>, <country>".
    Raises when EURES answers without a job list: an error body is not "no jobs" (Why, 6 Nov 2026, review), the caller leaves that persona out."""
    from src.sources import eures, nuts_names
    ref, cc = persona['reference'], persona['reference']['nuts2'][:2]
    codes, rows, seen = eures._codes(ref['nuts2'], nuts_names.names()), [], set()
    for word in ref['words']:
        for page in range(1, EURES_PAGES + 1):
            answer = post(eures._body(word, codes, page))
            listed = answer.get('jvs') if isinstance(answer, dict) else None
            if not isinstance(listed, list):
                raise ValueError('EURES answered without a job list')
            for job in listed:
                if job.get('id') in seen or not job.get('title'):
                    continue
                seen.add(job['id'])
                found = [c.upper() for held in (job.get('locationMap') or {}).values() for c in held or [] if c]
                rows.append({'title': job['title'], 'company': (job.get('employer') or {}).get('name') or '', 'location': eures._where(found, cc),
                             'url': eures.DETAIL + urllib.parse.quote(job['id']) + '?lang=en'})   # the same link the app keeps (src/sources/eures.py); the judge reads only title, employer and place
            if len(listed) < eures.PAGE_SIZE:
                break
    return rows


def same_job(row):
    """One posting: title and employer (the same posting listed twice by the portal counts once; every row is already in the one city)."""
    return (' '.join(row['title'].lower().split()), ' '.join((row.get('company') or '').lower().split()))


SOURCES = ('eures', 'public_board', 'web_search', 'employer_sites')   # the plan's fixed words (sa, 10 Nov 2026); a new word goes to sa first


def is_counted(status):
    """Whether a source's rows enter the count: "counted", or "partial: <what is short>" (read, with its shortfall said beside it: sa, 10 Nov 2026), never a "not counted" or "none"."""
    return status == 'counted' or status.startswith('partial:')


EMPLOYER_NUMBERS = ('feeds_tried', 'feeds_read', 'feeds_refused', 'feeds_failed', 'feeds_late', 'feeds_unplaced', 'rows_in_region', 'rows_outside_by_text')


ADMIN_SOURCES = (*SOURCES, 'free_job_apis', 'linkedin')   # oe's fixed list on the site (jobadabra-web admin/search-reference.js); a key outside it is dropped there
STATUS_SENT = 120  # characters of a status the site keeps (oe, 10 Nov 2026)
LEAN = ('total', 'reachable', 'eures')   # the row the site took before the market count: what a body too big for it still carries


def admin_row(counts, sources, only, counted, today):
    """One person's row for Admin's "Market coverage" (the shape agreed with oe, 10 Nov 2026): total/reachable/eures as before, the market, the date of the count,
    and per source {status, read, right, only}; a source not counted carries its status and null numbers, never 0. Board names, pages and the employer
    feeds_* counters stay in the artifact (not drawn; oe: keep the body small)."""
    def numbers(source):
        if source not in counted:
            return {'read': None, 'right': None, 'only': None}
        return {'read': sources[source].get('read'), 'right': counts[source], 'only': only[source]}
    return {'total': counts['total'], 'reachable': counts['reachable'], 'eures': counts['eures'], 'market': counts['market'], 'counted_on': today,
            'sources': {s: {'status': str(sources[s]['status'])[:STATUS_SENT], **numbers(s)} for s in ADMIN_SOURCES if s in sources}}


def right(row):
    """Whether the blind judge called a row the right role AND in the right place."""
    return row.get('role') == 'yes' and row.get('place') == 'yes'


def tally(rows, counted=('eures',)):
    """-> {total, reachable, eures, public_board, web_search, employer_sites, market} from judged rows (each row's `source`, EURES when unnamed): per source, the distinct right jobs it listed, None when not
    counted (never 0); market = the distinct right jobs of every counted source (one job two sources show counts once). total = reachable = the EURES count, as before.
    Why total stays EURES (review, 10 Nov 2026): Admin prints `total` as "EURES reference: N" (jobadabra-web admin/search-night-page.js) and keeps only total, reachable, eures
    and google; the market reaches Admin with the row shape agreed with oe ([mc] 5/5), never by changing what total means under a label that says EURES."""
    keys = {source: {same_job(r) for r in rows if right(r) and r.get('source', 'eures') == source} for source in SOURCES}
    market = set().union(*(keys[s] for s in SOURCES if s in counted))
    own = {s: len(keys[s]) if s in counted else None for s in SOURCES}
    return {'total': own['eures'], 'reachable': own['eures'], **own, 'market': len(market)}


def right_jobs(rows):
    """-> the distinct right jobs (role AND place yes) as {title, company, url, sources}, in the order they were read: the keys a night's list is matched against;
    `url` is the first source's link, `sources` every source that showed the job."""
    kept = {}
    for row in rows:
        if right(row):
            job = kept.setdefault(same_job(row), {'title': row['title'], 'company': row.get('company') or '', 'url': row.get('url') or '', 'sources': []})
            if row.get('source', 'eures') not in job['sources']:
                job['sources'].append(row.get('source', 'eures'))
    return list(kept.values())


def pool(n, persona, post, boards, ahead):
    """-> (rows, sources): every source's rows for one persona, each tagged with its source, and per source {status, read} (plus the board's name and pages).
    A source that could not be read is "not counted: <why>" and adds no row; it never ends the other source. `ahead` = the reads started at the run's start, collected last."""
    rows, sources = read_here(n, persona, post, boards)
    collect(rows, sources, ahead)
    return rows, sources


def read_here(n, persona, post, boards):
    """EURES and the national board, read in turn in the run's own thread: (rows, sources)."""
    rows, sources = [], {}
    try:
        found = eures_rows(persona, post)
        rows += [{**r, 'source': 'eures'} for r in found]
        sources['eures'] = {'status': 'counted', 'read': len(found)}
    except Exception as error:   # noqa: BLE001 - one unreadable region must not end the board or the other 17
        sources['eures'] = {'status': f'not counted: {type(error).__name__}', 'read': 0}
        print(f'reference: p{n} EURES not read ({type(error).__name__}: {str(error)[:80]})', flush=True)
    try:
        board = boards(n, persona['reference']['words'])
    except Exception as error:   # noqa: BLE001 - Why (review, 10 Nov 2026): a board that raised must not end EURES or the other 17 people
        board = {'board': None, 'status': f'not counted: {type(error).__name__}', 'rows': []}
    rows += [{**r, 'source': 'public_board'} for r in board['rows']]
    sources['public_board'] = {'status': board['status'], 'read': len(board['rows']), 'board': board.get('board'), 'pages': board.get('pages', 0), **({'note': board['note']} if board.get('note') else {})}
    return rows, sources


def collect(rows, sources, ahead):
    """Adds the reads started at the run's start (web search, employer sites), each collected by the deadline, to one persona's rows and sources."""
    for source, get in ahead.items():
        try:
            got = get()
        except concurrent.futures.TimeoutError:
            got = {'status': 'not counted: time', 'rows': []}
        except Exception as error:   # noqa: BLE001 - a read that raised is that source not counted, never the end of the others
            got = {'status': f'not counted: {type(error).__name__}', 'rows': []}
        rows += [{**r, 'source': source} for r in got['rows']]
        sources[source] = {'status': got['status'], 'read': len(got['rows']), **{k: got[k] for k in EMPLOYER_NUMBERS if k in got}}
    sources['free_job_apis'] = {'status': 'none (no query)'}   # Arbeitnow, Himalayas, Jobicy take no role or place (sa, 10 Nov 2026); Adzuna and Jooble stay parked (owner's word adds them)
    sources['linkedin'] = {'status': 'by hand'}   # never read by a tool (CLAUDE.md, login walls); sa's by-hand count fills it
    return rows, sources


WEB_AT_ONCE = 6        # web searches in flight at once (the broker serves the night's six presses at once too)
EMPLOYERS_AT_ONCE = 4  # persons whose employer sites are read at once (a feed two persons share is read once)
BUDGET_S = 600         # every person's web search and employer sites are back within 10 minutes of the run's start (the EURES reads alone take ~6)
GRACE_S = 60           # past the deadline, a read still running gets this long to hand back what it has (employer sites stop at their next feed)
JUDGES_AT_ONCE = 4     # persons judged at once: each person is one or more calls in turn, and 18 in a row with the new sources' rows would pass the job's 20 minutes


def run(post=eures_post, asker=gate_judge.ask, jobs=None, boards=None, details=None, web=None, clock=time.monotonic, employers=None, today=None):
    """The record for every persona with at least one counted source whose judge worked (a persona with none, or whose judge failed, is left out, never 0: the tab then
    says "no reference"). All sources' rows are judged in one blind pass, so every source is read by the same eyes and a job two sources show costs one verdict.
    `jobs`, when given, is filled with {"<n>": right_jobs(...)}; `details` with {"<n>": per-source status, rows read and right jobs}: the artifact's, never part of the record that is sent."""
    boards = boards or market_boards.read
    today = today or datetime.date.today().isoformat()   # one date for the whole run, also the artifact's (main passes it)
    web = web or market_web.read
    record = {}
    # Why (review of [mc] 3/5): 18 searches one after another (up to a minute each) would push the job past its 20 minutes and lose every person's EURES count;
    # they run WEB_AT_ONCE at a time beside the EURES and board reads, and a search not back by the deadline is "not counted: time".
    # Employer sites the same way ([mc] 4/5): a person's feeds not read by the deadline make it "partial: <n> of <m> feeds", never a wait past it.
    deadline = clock() + BUDGET_S
    employers = employers or market_employers.Employers(stop=lambda: clock() >= deadline)
    searches = concurrent.futures.ThreadPoolExecutor(max_workers=WEB_AT_ONCE)
    reads = concurrent.futures.ThreadPoolExecutor(max_workers=EMPLOYERS_AT_ONCE)
    futures = {'web_search': [searches.submit(web, persona) for persona in PERSONAS], 'employer_sites': [reads.submit(employers, persona) for persona in PERSONAS]}
    # Why (review of [mc] 4/5): the run's own reads go first for all 18 (no person waits on another's employer sites), then the started reads are collected,
    # then the judge runs JUDGES_AT_ONCE persons at a time.
    here = [read_here(n, persona, post, boards) for n, persona in enumerate(PERSONAS, 1)]
    for n, (rows, sources) in enumerate(here, 1):
        collect(rows, sources, {source: (lambda future=started[n - 1]: future.result(timeout=max(0.0, deadline - clock()) + GRACE_S)) for source, started in futures.items()})
    judges = concurrent.futures.ThreadPoolExecutor(max_workers=JUDGES_AT_ONCE)
    verdicts = [judges.submit(lambda n=n, rows=rows: rows and gate_judge.judge(n, rows, asker)) for n, (rows, _) in enumerate(here, 1)]
    for n, (rows, sources) in enumerate(here, 1):
        counted = tuple(s for s in SOURCES if is_counted(sources[s]['status']))
        if not counted:
            print(f'reference: p{n} no source counted', flush=True)
            continue
        try:
            verdicts[n - 1].result()
        except Exception as error:   # noqa: BLE001 - one refused or short judge answer leaves that persona out, never the other 17
            print(f'reference: p{n} not judged ({type(error).__name__}: {str(error)[:80]})', flush=True)
            continue
        counts = tally(rows, counted)
        found = right_jobs(rows)
        only = {s: sum([o for o in job['sources'] if o in counted] == [s] for job in found) for s in counted}   # right jobs no other counted source showed (sa's WP6: what a source is worth)
        if 'eures' in counted:   # the record sent to Admin keeps its EURES meaning (see tally); a person whose EURES was not read stays out of it, as before
            record[str(n)] = admin_row(counts, sources, only, counted, today)
        if jobs is not None:
            jobs[str(n)] = found
        if details is not None:   # per source {status, read, right, only} plus each source's own numbers (board pages, employer feeds_*): the artifact's
            details[str(n)] = {'market': counts['market'], **{s: {**v, **({'right': counts[s], 'only': only[s]} if s in counted else {})} for s, v in sources.items()}}
        print(f'reference: p{n} {counts} ' + ' · '.join(f"{s}: {v['status']}" for s, v in sources.items() if s in SOURCES), flush=True)
    judges.shutdown(wait=False)
    for executor in (searches, reads):
        executor.shutdown(wait=False, cancel_futures=True)
    return {'personas': record}


def iso_week(now):
    """The ISO week of a datetime as "YYYY-Www", the label the Admin store (jobadabra-web admin/search-reference.js isoWeek) keys the reference by."""
    year, week, _ = now.isocalendar()
    return f'{year}-W{week:02d}'


def send(path, env=None, now=None, opener=urllib.request.urlopen):
    """PUT the record to Admin; -> one line for the job's log, never raises. Only a CI run on main sends (a hand run on a branch would replace the week); counts only leave."""
    env = os.environ if env is None else env
    now = now or datetime.datetime.now(datetime.timezone.utc)
    run_id = str(env.get('GITHUB_RUN_ID') or '')
    why = ('a local run: nothing leaves the Mac' if not env.get('CI') else f"branch {env.get('GITHUB_REF_NAME') or '(none)'}: only a run on main is a week" if env.get('GITHUB_REF_NAME') != 'main'
           else 'no REPLAYS_PUBLISH_KEY in this run' if not env.get('REPLAYS_PUBLISH_KEY') else '' if re.fullmatch(r'\d{6,15}', run_id) else 'no run id')
    if why:
        return f'search reference: not sent ({why})'
    try:
        record = json.loads(Path(path).read_text(encoding='utf-8'))
        body = json.dumps({'personas': record['personas']}, ensure_ascii=False, separators=(',', ':')).encode()   # compact UTF-8: a '·' is 2 bytes, not 6
    except (OSError, ValueError, KeyError):
        return 'search reference: nothing to send (no record)'
    if not record['personas']:
        return 'search reference: nothing to send (EURES was read for no persona)'
    week = iso_week(now)

    def put(data):
        request = urllib.request.Request(f'{SITE}?week={week}&run={run_id}', data=data, method='PUT',
                                         headers={'Authorization': f"Bearer {env['REPLAYS_PUBLISH_KEY']}", 'Content-Type': 'application/json', 'User-Agent': USER_AGENT, 'X-Caller': 'search-reference'})
        with opener(request, timeout=30) as response:
            return json.load(response)
    lean = ''
    try:
        try:
            told = put(body)
        except urllib.error.HTTPError as error:
            if error.code != 413:
                raise
            # Why (review of [mc] 5/5): until jobadabra-web #528 raises the site's body cap (16 KB -> 32 KB), 18 rows with long statuses can pass it; the week's EURES
            # reference must not be lost with them: the same counts are sent once more without the per-source detail (it stays in the run's artifact).
            told, lean = put(json.dumps({'personas': {n: {k: r[k] for k in LEAN if k in r} for n, r in record['personas'].items()}}, separators=(',', ':')).encode()), ' (without per-source detail: 413)'
    except Exception as error:   # noqa: BLE001 - a failed upload is one line, never a red run
        return f'search reference: not sent ({str(getattr(error, "code", "") or type(error).__name__)[:40]})'
    return f"search reference: week {week} {'stored' if told.get('stored') else 'not stored (' + str(told.get('why', 'unknown'))[:60] + ')'}: {len(record['personas'])} personas{lean}"


def main(argv):
    """`run <out.json>` or `send <out.json>` (see the module docstring); anything else prints it."""
    kind = argv[0] if argv else ''
    if kind == 'run' and len(argv) == 2:
        Path(argv[1]).parent.mkdir(parents=True, exist_ok=True)   # Why (6 Nov 2026, run 42191804037): `out/` did not exist and the 6-minute read ended in FileNotFoundError; make the folder first
        jobs, details, today = {}, {}, datetime.date.today().isoformat()
        record = run(jobs=jobs, details=details, today=today)
        Path(argv[1]).write_text(json.dumps(record, ensure_ascii=False, indent=1), encoding='utf-8')
        Path(argv[1]).with_name('reference-jobs.json').write_text(json.dumps({'personas': jobs, 'sources': details, 'counted_on': today}, ensure_ascii=False, indent=1), encoding='utf-8')
        print(f"reference: {len(record['personas'])} of {len(PERSONAS)} personas")
    elif kind == 'send' and len(argv) == 2:
        print(send(argv[1]))
    else:
        raise SystemExit(__doc__)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
