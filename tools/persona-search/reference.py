"""The reference of the nightly Search check, the market count (owner, 6 Nov 2026: "how to know if it's a good or bad result?"; 10 Nov 2026: "summing all the jobs I found (that's what a
normal person would do without Jobadabra)… should be the number what Jobadabra finds"): for each of the 18 fictional candidates, the right-role, right-place jobs each source of the plan's
fixed list shows when a person searches it by hand, read OUTSIDE the app, judged by the nightly check's blind judge (gate_judge.py) in one pass, so a night and the market are judged by the same eyes.
Sources counted so far: EURES's public API (the city's NUTS-2 region, the role in the place's own language) and the country's national job board (market_boards.py, one data row per country:
sa's design, 10 Nov 2026) and a web search (market_web.py: the AI's web search tool asked for postings of the role in the city, one call per person). Free job APIs are "none (no query)" (none takes a role and a place; Adzuna and Jooble stay parked until the owner adds them); LinkedIn is "by hand" (never read here).
Why no Google (owner, 6 Nov 2026: "I'd rather keep it for central scout. To gain more value out of it"): the SerpApi quota is the central scout's alone.
  node tools/persona-search/codex.mjs -- python3 tools/persona-search/reference.py run <out.json>   read every source, judge blind behind the Codex relay, write the counts
  python3 tools/persona-search/reference.py send <out.json>                                         PUT the counts to Admin (only a CI run on main; GITHUB_RUN_ID, REPLAYS_PUBLISH_KEY)
Beside <out.json>, `reference-jobs.json` keeps each right job (title, employer, link, the sources that showed it), each source's status per person and the date of the count, for the run's
artifact only: it is never sent (send reads the counts file).
Why (10 Nov 2026, sa's finish-line plan WP3, owner: "our search results should always be what EURES gives + some additional sources"): a night's loss is counted per job and
per stage, which needs the reference's jobs, not only their count.
Record: {"personas": {"<n>": {total, reachable, eures, public_board, web_search, market}}}; total = reachable = the EURES count (Admin labels it "EURES reference"); public_board = the board's own
count, None when not counted (refused, a page failed, its cards moved, or no board for the country), never 0; web_search likewise (None when the search failed or ran outside the relay); market = distinct right jobs (title + employer) of every counted source.
A persona whose EURES was not read, or whose judge failed, is left out of the record (Admin then says "no reference"); its board count and jobs still go to reference-jobs.json. Admin: jobadabra-web admin/search-reference.js. Tests: tests/tooling/ci/test_search_reference.py."""
import datetime
import json
import os
import re
import sys
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


SOURCES = ('eures', 'public_board', 'web_search')   # the plan's fixed words (sa, 10 Nov 2026); a new word goes to sa first


def right(row):
    """Whether the blind judge called a row the right role AND in the right place."""
    return row.get('role') == 'yes' and row.get('place') == 'yes'


def tally(rows, counted=('eures',)):
    """-> {total, reachable, eures, public_board, web_search, market} from judged rows (each row's `source`, EURES when unnamed): per source, the distinct right jobs it listed, None when not
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


def pool(n, persona, post, boards, web):
    """-> (rows, sources): every source's rows for one persona, each tagged with its source, and per source {status, read} (plus the board's name and pages).
    A source that could not be read is "not counted: <why>" and adds no row; it never ends the other source."""
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
    try:
        searched = web(persona)
    except Exception as error:   # noqa: BLE001 - a search that raised is that source not counted, never the end of the others
        searched = {'status': f'not counted: {type(error).__name__}', 'rows': []}
    rows += [{**r, 'source': 'web_search'} for r in searched['rows']]
    sources['web_search'] = {'status': searched['status'], 'read': len(searched['rows'])}
    sources['free_job_apis'] = {'status': 'none (no query)'}   # Arbeitnow, Himalayas, Jobicy take no role or place (sa, 10 Nov 2026); Adzuna and Jooble stay parked (owner's word adds them)
    sources['linkedin'] = {'status': 'by hand'}   # never read by a tool (CLAUDE.md, login walls); sa's by-hand count fills it
    return rows, sources


def run(post=eures_post, asker=gate_judge.ask, jobs=None, boards=None, details=None, web=None):
    """The record for every persona with at least one counted source whose judge worked (a persona with none, or whose judge failed, is left out, never 0: the tab then
    says "no reference"). All sources' rows are judged in one blind pass, so every source is read by the same eyes and a job two sources show costs one verdict.
    `jobs`, when given, is filled with {"<n>": right_jobs(...)}; `details` with {"<n>": per-source status, rows read and right jobs}: the artifact's, never part of the record that is sent."""
    boards = boards or market_boards.read
    web = web or market_web.read
    record = {}
    for n, persona in enumerate(PERSONAS, 1):
        rows, sources = pool(n, persona, post, boards, web)
        counted = tuple(s for s in SOURCES if sources[s]['status'] == 'counted')
        if not counted:
            print(f'reference: p{n} no source counted', flush=True)
            continue
        try:
            if rows:
                gate_judge.judge(n, rows, asker)
        except Exception as error:   # noqa: BLE001 - one refused or short judge answer leaves that persona out, never the other 17
            print(f'reference: p{n} not judged ({type(error).__name__}: {str(error)[:80]})', flush=True)
            continue
        counts = tally(rows, counted)
        if 'eures' in counted:   # the record sent to Admin keeps its EURES meaning (see tally); a person whose EURES was not read stays out of it, as before
            record[str(n)] = counts
        found = right_jobs(rows)
        if jobs is not None:
            jobs[str(n)] = found
        if details is not None:   # per source {status, read, right, only}: `only` = right jobs no other counted source showed (sa's WP6: what a source is worth)
            only = {s: sum(job['sources'] == [s] for job in found) for s in counted}
            details[str(n)] = {'market': counts['market'], **{s: {**v, **({'right': counts[s], 'only': only[s]} if s in counted else {})} for s, v in sources.items()}}
        print(f'reference: p{n} {counts} ' + ' · '.join(f"{s}: {v['status']}" for s, v in sources.items() if s in SOURCES), flush=True)
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
        body = json.dumps({'personas': record['personas']}).encode()
    except (OSError, ValueError, KeyError):
        return 'search reference: nothing to send (no record)'
    if not record['personas']:
        return 'search reference: nothing to send (EURES was read for no persona)'
    week = iso_week(now)
    request = urllib.request.Request(f'{SITE}?week={week}&run={run_id}', data=body, method='PUT',
                                     headers={'Authorization': f"Bearer {env['REPLAYS_PUBLISH_KEY']}", 'Content-Type': 'application/json', 'User-Agent': USER_AGENT, 'X-Caller': 'search-reference'})
    try:
        with opener(request, timeout=30) as response:
            told = json.load(response)
    except Exception as error:   # noqa: BLE001 - a failed upload is one line, never a red run
        return f'search reference: not sent ({str(getattr(error, "code", "") or type(error).__name__)[:40]})'
    return f"search reference: week {week} {'stored' if told.get('stored') else 'not stored (' + str(told.get('why', 'unknown'))[:60] + ')'}: {len(record['personas'])} personas"


def main(argv):
    """`run <out.json>` or `send <out.json>` (see the module docstring); anything else prints it."""
    kind = argv[0] if argv else ''
    if kind == 'run' and len(argv) == 2:
        Path(argv[1]).parent.mkdir(parents=True, exist_ok=True)   # Why (6 Nov 2026, run 42191804037): `out/` did not exist and the 6-minute read ended in FileNotFoundError; make the folder first
        jobs, details = {}, {}
        record = run(jobs=jobs, details=details)
        Path(argv[1]).write_text(json.dumps(record, ensure_ascii=False, indent=1), encoding='utf-8')
        Path(argv[1]).with_name('reference-jobs.json').write_text(json.dumps({'personas': jobs, 'sources': details, 'counted_on': datetime.date.today().isoformat()}, ensure_ascii=False, indent=1), encoding='utf-8')
        print(f"reference: {len(record['personas'])} of {len(PERSONAS)} personas")
    elif kind == 'send' and len(argv) == 2:
        print(send(argv[1]))
    else:
        raise SystemExit(__doc__)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
