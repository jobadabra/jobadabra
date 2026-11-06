"""The weekly reference of the nightly Search check (owner, 6 Nov 2026: "how to know if it's a good or bad result?", chose "EURES direct + Google Jobs weekly"): for each of the 18 fictional
candidates, how many right-role, right-place jobs exist, read OUTSIDE the app: EURES's public API (the city's NUTS-2 region, the role in the place's own language) and one Google Jobs search
(SerpApi). The blind judge of the nightly check (gate_judge.py) says which are right, so the reference and a night are judged by the same eyes. Only counts leave this tool.
  python3 tools/persona-search/reference.py read <rows.json>                                          phase 1, no AI: EURES + Google Jobs rows (REFERENCE_SERPAPI_KEY optional: without it Google is "no key")
  node tools/persona-search/codex.mjs -- python3 tools/persona-search/reference.py judge <rows.json> <out.json>   phase 2: the blind judge behind the Codex relay (it strips *_KEY variables, so no key here)
  python3 tools/persona-search/reference.py send <out.json>                                           PUT the counts to Admin (only a CI run on main; GITHUB_RUN_ID, REPLAYS_PUBLISH_KEY)
Record: {"personas": {"<n>": {total, reachable, eures, google}}, "google": "read|no key|credits low|failed"}; total = distinct right jobs in both sources, reachable = those a person can open
without signing in, eures / google = each source's own distinct right jobs (google null = not read, never 0). Admin: jobadabra-web admin/search-reference.js. Tests: tests/tooling/ci/test_search_reference.py."""
import datetime
import json
import os
import re
import sys
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(HERE))
from gate import PERSONAS  # noqa: E402
import gate_judge  # noqa: E402

SITE = 'https://www.jobadabra.top/search-check/reference'
EURES_PAGES = 2   # per role word: the best matches first, 100 jobs; a city region rarely has more right ones (measured 6 Nov 2026: 8 jobs for "charpentier" in Brussels)
SCOUT_RESERVE = 20   # config/search.json google_jobs.min_searches_left: the credits the scout keeps for itself (src/sources/google_jobs.py spends only what is above it)
# Why (6 Nov 2026, review): a floor of 20 would let 18 searches dip into the scout's reserve; the week needs its reserve PLUS one credit per persona. The free account check runs first.
MIN_CREDITS_LEFT = SCOUT_RESERVE + len(PERSONAS)
# Why (6 Nov 2026, owner's "reachable without login"): a job whose only door is one of these sites asks for an account before it shows the posting, so no search of ours can read it.
LOGIN_WALL = re.compile(r'(^|\.)(linkedin|xing|glassdoor|facebook|instagram)\.[a-z.]+$', re.I)
HL = {'Bulgarian': 'bg', 'Romanian': 'ro', 'French': 'fr', 'German': 'de', 'Polish': 'pl', 'Croatian': 'hr', 'English': 'en', 'Dutch': 'nl', 'Portuguese': 'pt', 'Italian': 'it',
      'Czech': 'cs', 'Swedish': 'sv', 'Hungarian': 'hu', 'Spanish': 'es', 'Danish': 'da'}   # Google Jobs answers only in the place's own language (src/sources/google_jobs.py)


def _json(request, timeout=40):
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


def eures_post(body):
    """One EURES search page (the public API: no key, no login)."""
    from src.sources import eures
    return _json(urllib.request.Request(eures.URL, data=json.dumps(body).encode(), headers={'Content-Type': 'application/json', 'User-Agent': 'jobadabra-reference'}))


def serp_get(url, params):
    """One SerpApi GET (url + query string from `params`) -> the parsed JSON; raises on a network or HTTP failure (the caller treats that as \"Google not read\")."""
    from urllib.parse import urlencode
    return _json(urllib.request.Request(f'{url}?{urlencode(params)}', headers={'User-Agent': 'jobadabra-reference'}))


def eures_rows(persona, post=eures_post):
    """The jobs EURES lists for the persona's role words in the city's NUTS-2 region (the area, its parent and its parts), each as the judge reads it: title, employer, "<area>, <country>"."""
    from src.sources import eures, nuts_names
    ref, cc = persona['reference'], persona['reference']['nuts2'][:2]
    codes, rows, seen = eures._codes(ref['nuts2'], nuts_names.names()), [], set()
    for word in ref['words']:
        for page in range(1, EURES_PAGES + 1):
            answer = post(eures._body(word, codes, page))
            listed = answer.get('jvs') if isinstance(answer, dict) else None
            if not isinstance(listed, list):   # Why (6 Nov 2026, review): an error body is not "no jobs"; the persona is left out, never a wrong 0
                raise ValueError('EURES answered without a job list')
            for job in listed:
                if job.get('id') in seen or not job.get('title'):
                    continue
                seen.add(job['id'])
                found = [c.upper() for held in (job.get('locationMap') or {}).values() for c in held or [] if c]
                rows.append({'title': job['title'], 'company': (job.get('employer') or {}).get('name') or '', 'location': eures._where(found, cc), 'source': 'eures', 'reachable': True})
            if len(listed) < eures.PAGE_SIZE:
                break
    return rows


def google_rows(persona, key, get=serp_get):
    """The first page of one Google Jobs search (SerpApi, one credit) for the persona's first role word at its canonical location, in the place's language."""
    from src.sources import google_jobs
    ref = persona['reference']
    data = get(google_jobs.SEARCH_URL, {'engine': 'google_jobs', 'q': ref['words'][0], 'location': ref['serp'], 'hl': HL[persona['language']], 'api_key': key})
    rows = []
    for result in data.get('jobs_results') or []:
        job = google_jobs.normalise(result)
        rows.append({'title': job['title'], 'company': job['company'], 'location': job['location'], 'source': 'google', 'reachable': not LOGIN_WALL.search(urlsplit(job['url']).hostname or '')})
    return rows


def same_job(row):
    """One posting across sources: title and employer, since the sources write the place differently (EURES "Brussels-Capital, Belgium", Google "Brussels, Belgium"); every row is already in the one city.
    Why (6 Nov 2026, review): keying on the place too counted a posting found by both sources twice."""
    return (' '.join(row['title'].lower().split()), ' '.join((row.get('company') or '').lower().split()))


def tally(rows, google_read):
    """-> {total, reachable, eures, google} from judged rows: a job found by both sources counts once, and is reachable when either copy is."""
    jobs = {}
    for row in rows:
        if row.get('role') == 'yes' and row.get('place') == 'yes':
            job = jobs.setdefault(same_job(row), {'sources': set(), 'reachable': False})
            job['sources'].add(row['source'])
            job['reachable'] = job['reachable'] or bool(row['reachable'])
    return {'total': len(jobs), 'reachable': sum(j['reachable'] for j in jobs.values()), 'eures': sum('eures' in j['sources'] for j in jobs.values()),
            'google': sum('google' in j['sources'] for j in jobs.values()) if google_read else None}


def google_state(key, opener=urllib.request.urlopen):
    """'read' when a search may be made, else why not: 'no key', 'credits low' or 'failed' (the account check is free)."""
    if not key:
        return 'no key'
    from src.sources import google_jobs
    try:
        left = int(google_jobs.searches_left(key, opener))
        enough = left >= MIN_CREDITS_LEFT
    except Exception as error:   # noqa: BLE001 - a refused or slow account check is "not read", never a failed run
        print(f'reference: the SerpApi account check failed ({type(error).__name__})', flush=True)
        return 'failed'
    return 'read' if enough else 'credits low'


def read(env=None, post=eures_post, get=serp_get, state=None):
    """Phase 1 (no AI, holds the SerpApi key): {"google": state, "rows": {"<n>": [row, ...]}} with every job EURES and Google list, unjudged. A persona whose EURES read failed is left out (never 0).
    Google is searched once per persona, only when the state is 'read'; the first failure ends the searches. Why (6 Nov 2026): codex.mjs strips every *_KEY variable from its child, so the key lives here
    and the judge (phase 2) runs behind the relay without it."""
    env = os.environ if env is None else env
    key = env.get('REFERENCE_SERPAPI_KEY', '')
    state = state or google_state(key)
    out = {'google': state, 'rows': {}}
    for n, persona in enumerate(PERSONAS, 1):
        try:
            rows = eures_rows(persona, post)
        except Exception as error:   # noqa: BLE001 - one unreadable region must not end the other 17
            print(f'reference: p{n} EURES not read ({type(error).__name__})', flush=True)
            continue
        if state == 'read':
            try:
                rows += google_rows(persona, key, get)
            except Exception as error:   # noqa: BLE001
                print(f'reference: p{n} Google Jobs not read ({type(error).__name__}); no more searches this week', flush=True)
                out['google'] = 'partial' if any(item['google_read'] for item in out['rows'].values()) else 'failed'
                state = 'failed'   # Why (6 Nov 2026): a SerpApi outage must not be asked 17 more times
        out['rows'][str(n)] = {'google_read': state == 'read', 'jobs': rows}
    return out


def judge_all(doc, asker=gate_judge.ask):
    """Phase 2 (behind the Codex relay, no key): the blind judge on every persona's rows -> the record {"personas": {"<n>": {total, reachable, eures, google}}, "google": state}."""
    record = {}
    for n, item in doc['rows'].items():
        rows = item['jobs']
        try:
            if rows:
                gate_judge.judge(int(n), rows, asker)
        except Exception as error:   # noqa: BLE001 - one refused or short judge answer leaves that persona out, never the other 17 (Why, 6 Nov 2026, review)
            print(f'reference: p{n} not judged ({type(error).__name__}: {str(error)[:80]})', flush=True)
            continue
        record[n] = tally(rows, item['google_read'])
        print(f'reference: p{n} {record[n]}', flush=True)
    return {'personas': record, 'google': doc['google']}


def run(env=None, post=eures_post, get=serp_get, asker=gate_judge.ask, state=None):
    """Both phases in one process (tests; a run with no key needs no split)."""
    return judge_all(read(env, post, get, state), asker)


def iso_week(now):
    """The ISO week of a datetime as \"YYYY-Www\", the label the Admin store (jobadabra-web admin/search-reference.js isoWeek) keys the reference by."""
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
                                     headers={'Authorization': f"Bearer {env['REPLAYS_PUBLISH_KEY']}", 'Content-Type': 'application/json', 'X-Caller': 'search-reference'})
    try:
        with opener(request, timeout=30) as response:
            told = json.load(response)
    except Exception as error:   # noqa: BLE001 - a failed upload is one line, never a red run
        return f'search reference: not sent ({str(getattr(error, "code", "") or type(error).__name__)[:40]})'
    return f"search reference: week {week} {'stored' if told.get('stored') else 'not stored (' + str(told.get('why', 'unknown'))[:60] + ')'}: {len(record['personas'])} personas, Google Jobs {record.get('google')}"


def main(argv):
    kind = argv[0] if argv else ''
    if kind == 'read' and len(argv) == 2:
        doc = read()
        Path(argv[1]).write_text(json.dumps(doc, ensure_ascii=False), encoding='utf-8')
        print(f"reference: read {len(doc['rows'])} of {len(PERSONAS)} personas, Google Jobs {doc['google']}")
    elif kind == 'judge' and len(argv) == 3:
        record = judge_all(json.loads(Path(argv[1]).read_text(encoding='utf-8')))
        Path(argv[2]).write_text(json.dumps(record, ensure_ascii=False, indent=1), encoding='utf-8')
        print(f"reference: {len(record['personas'])} of {len(PERSONAS)} personas judged, Google Jobs {record['google']}")
    elif kind == 'send' and len(argv) == 2:
        print(send(argv[1]))
    else:
        raise SystemExit(__doc__)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
