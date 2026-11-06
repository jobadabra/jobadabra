"""The weekly reference of the nightly Search check (owner, 6 Nov 2026: "how to know if it's a good or bad result?", chose EURES as the baseline): for each of the 18 fictional candidates, how many right-role,
right-place jobs EURES lists, read OUTSIDE the app: EURES's public API (the city's NUTS-2 region, the role in the place's own language). The blind judge of the nightly check (gate_judge.py) says which are right,
so the reference and a night are judged by the same eyes. Only counts leave this tool.
Why EURES only (owner, 6 Nov 2026: "I'd rather keep it for central scout. To gain more value out of it"): the SerpApi quota is the central scout's alone, so no Google Jobs here and no Google figure on the tab.
  node tools/persona-search/codex.mjs -- python3 tools/persona-search/reference.py run <out.json>   read EURES, judge blind behind the Codex relay, write the counts
  python3 tools/persona-search/reference.py send <out.json>                                         PUT the counts to Admin (only a CI run on main; GITHUB_RUN_ID, REPLAYS_PUBLISH_KEY)
Record: {"personas": {"<n>": {total, reachable, eures}}}; total = distinct right jobs EURES lists, eures = the same count (the source), reachable = total: every EURES posting opens on the public EURES portal
without signing in (its apply step may go elsewhere; the list gives no link, so no per-job check is made). Admin: jobadabra-web admin/search-reference.js. Tests: tests/tooling/ci/test_search_reference.py."""
import datetime
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(HERE))
from gate import PERSONAS  # noqa: E402
import gate_judge  # noqa: E402

SITE = 'https://www.jobadabra.top/search-check/reference'
EURES_PAGES = 2   # per role word: the best matches first, 100 jobs; a city region rarely has more right ones (measured 6 Nov 2026: 8 jobs for "charpentier" in Brussels)


def eures_post(body):
    """One EURES search page (the public API: no key, no login) -> the parsed JSON; raises on a network or HTTP failure."""
    from src.sources import eures
    request = urllib.request.Request(eures.URL, data=json.dumps(body).encode(), headers={'Content-Type': 'application/json', 'User-Agent': 'jobadabra-reference'})
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
                rows.append({'title': job['title'], 'company': (job.get('employer') or {}).get('name') or '', 'location': eures._where(found, cc)})
            if len(listed) < eures.PAGE_SIZE:
                break
    return rows


def same_job(row):
    """One posting: title and employer (the same posting listed twice by the portal counts once; every row is already in the one city)."""
    return (' '.join(row['title'].lower().split()), ' '.join((row.get('company') or '').lower().split()))


def tally(rows):
    """-> {total, reachable, eures} from judged rows: the distinct jobs the judge called right role AND right place; reachable = total (see the module docstring)."""
    right = {same_job(row) for row in rows if row.get('role') == 'yes' and row.get('place') == 'yes'}
    return {'total': len(right), 'reachable': len(right), 'eures': len(right)}


def run(post=eures_post, asker=gate_judge.ask):
    """The record for every persona whose EURES read and judge worked (one that failed is left out, never 0: the tab then says "no reference")."""
    record = {}
    for n, persona in enumerate(PERSONAS, 1):
        try:
            rows = eures_rows(persona, post)
        except Exception as error:   # noqa: BLE001 - one unreadable region must not end the other 17
            print(f'reference: p{n} EURES not read ({type(error).__name__}: {str(error)[:80]})', flush=True)
            continue
        try:
            if rows:
                gate_judge.judge(n, rows, asker)
        except Exception as error:   # noqa: BLE001 - one refused or short judge answer leaves that persona out, never the other 17
            print(f'reference: p{n} not judged ({type(error).__name__}: {str(error)[:80]})', flush=True)
            continue
        record[str(n)] = tally(rows)
        print(f'reference: p{n} {record[str(n)]}', flush=True)
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
                                     headers={'Authorization': f"Bearer {env['REPLAYS_PUBLISH_KEY']}", 'Content-Type': 'application/json', 'X-Caller': 'search-reference'})
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
        record = run()
        Path(argv[1]).write_text(json.dumps(record, ensure_ascii=False, indent=1), encoding='utf-8')
        print(f"reference: {len(record['personas'])} of {len(PERSONAS)} personas")
    elif kind == 'send' and len(argv) == 2:
        print(send(argv[1]))
    else:
        raise SystemExit(__doc__)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
