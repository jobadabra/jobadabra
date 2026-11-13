"""The boards installs reported, as candidates for board discovery's pass: boards the AI never names (a cell's measure starts from the AI's ideas plus these).
Why (13 Nov 2026, owner, asked via AskUserQuestion by sa: "Any reported board (Recommended)": "The Scout, our own server job, counts a board even when only 1 install reported it.
Only the Scout's own count is served to apps, never which install reported it."; plan docs/superpowers/plans/2026-11-13-proven-boards.md PR 5/5, site half jobadabra-web #642): Spain's
pass proposed InfoJobs, Colejobs and two others; Jobeka and Trabajo.org, the boards that give Madrid electricians their right jobs, reach the Scout through no source.
Design: a board's state for one (country, family) has one owner, the Scout: reported (this list: a candidate only) -> counted (read with the family's own word, `right` + `day`) -> proven
(`right` >= 3). Verdicts: reported->counted = one Scout read; a board measured within REFRESH_DAYS is not a candidate again. Reports only ORDER and widen the candidates, they prove nothing.
Invariants: (1) the list comes from the Scout's own key and route only (GET <scout-memory>?boards=1, INDEX_PUBLISH_KEY); never an install id (the site sends none, `fetch` keeps only host,
countries, installs); (2) a reported search template is a HINT, never read: a reported template can be a job-alert subscribe form (rabota.md: `?subscribePosition={role}&subscribeName={place}`),
so a candidate is the board's HOME page marked 'home' and the pass finds its own search form (src/scout_board_homes.py), counting only through what it measured itself: no typing, no submit,
no reported link opened. Limit (13 Nov 2026): the form finder (src/sources/board_forms.py) never makes a search link of a form with an e-mail, phone or file box, but a subscribe form whose e-mail box is typed
text (rabota.md's) looks like a search form to structure alone and telling it apart needs a word list or the AI; its link is then a plain GET page load on the board's own host, kept only when it brings right jobs. (3) at most RESERVE candidates a pass, so the AI's ideas keep their slots. Tests: tests/unit/sources/test_scout_board_candidates.py."""
import json
import os
import re
import urllib.request
from datetime import date, timedelta

from . import pool_tags, scout_board_cells, scout_cells
from .sources import ats

URL = 'https://www.jobadabra.top/api/scout-memory'
RESERVE = 4                 # reported boards a pass reads beside the AI's ideas and the re-reads (Why (13 Nov 2026, bp): the pass reads ~5 boards in its 240 s; the ideas keep the rest)
TRIED = 'board_candidates'  # scout_meta: {"<host>|<country>": "YYYY-MM-DD"} a candidate the pass read (kept or not): not a candidate again for REFRESH_DAYS
MAX_BOARDS = 1500           # the site's cap (jobadabra-web api/scout-memory.js MAX_REPORTED)
HOST = re.compile(r'[a-z0-9-]+(\.[a-z0-9-]+)+')


def valid(item):
    """The report in the shape the pass uses, or None: {host, countries: [codes of the fixed list], installs (0 for a board only our CI searches read)}. The reported template and everything else is dropped on purpose (invariant 2)."""
    if not isinstance(item, dict) or not isinstance(item.get('host'), str) or not HOST.fullmatch(item['host']) or len(item['host']) > 100:
        return None
    countries = sorted({code for code in item.get('countries') or [] if isinstance(code, str) and code in pool_tags.COUNTRIES})
    installs = item.get('installs')
    floor = 0 if item.get('ci') is True else 1   # Why (13 Nov 2026, bp, jobadabra-web #643): a board only our own CI searches read comes with installs 0 and ci true; it is a candidate too, last in the order
    if not countries or not isinstance(installs, int) or isinstance(installs, bool) or installs < floor:
        return None
    return {'host': item['host'], 'countries': countries, 'installs': installs}


def _said(error):
    """The site's own error word from a refused answer ({"ok": false, "error": "..."}), at most 60 characters, '' when it has none. Never the key: the answer holds none."""
    try:
        return str(json.loads(error.read(2000)).get('error') or '')[:60]
    except Exception:  # noqa: BLE001 -- no readable answer: the status alone says it
        return ''


def fetch(out=print, urlopen=urllib.request.urlopen):
    """The valid reports from the site ([] without INDEX_PUBLISH_KEY, or when the site does not answer: the pass goes on with the AI's ideas). The key is never printed."""
    key = os.environ.get('INDEX_PUBLISH_KEY')
    if not key:
        out('Board pass: reported boards: not read (no INDEX_PUBLISH_KEY)')
        return []
    try:
        request = urllib.request.Request(f'{URL}?boards=1', headers={'User-Agent': ats.USER_AGENT, 'Authorization': f'Bearer {key}'})   # the one fixed address: the Scout's key goes nowhere else (Gitar on #4042); the agent is the Scout's own: Cloudflare refuses urllib's default with 403 1010 before the Worker (run 43516854672)
        with urlopen(request, timeout=30) as answer:
            boards = json.loads(answer.read(8 * 1024 * 1024)).get('boards') or []
    except Exception as error:  # noqa: BLE001 -- a site that does not answer must not stop the pass (the same boards come next run)
        code, said = getattr(error, 'code', None), _said(error)   # Why (13 Nov 2026, bp): the pass printed only 'HTTPError' for a 404 or a 503, so run 43516854672's cause was unreadable
        out(f"Board pass: reported boards: not read ({type(error).__name__}{f' HTTP {code}' if code else ''}{f': {said}' if said else ''})")
        return []
    reports = [report for report in map(valid, boards[:MAX_BOARDS]) if report]
    out(f'Board pass: reported boards: {len(reports)} of {len(boards)} read')
    return reports


def for_country(reports, country, measured=(), today=None, refresh_days=20):
    """The boards of `reports` serving `country` that are not measured already: [{name, host, search_url (the home page), home: True, countries, kinds, source_kind}], most installs
    first, at most RESERVE. `measured`: [(host, country, read_at)] of the Scout's facts; one read within `refresh_days` is not read again."""
    today = today or date.today()
    recent = {(host, code) for host, code, read_at in measured if str(read_at) >= (today - timedelta(days=refresh_days)).isoformat()}
    wanted = sorted((report for report in reports if country in report['countries'] and (report['host'], country) not in recent), key=lambda report: (-report['installs'], report['host']))
    return [{'name': report['host'], 'host': report['host'], 'search_url': f"https://{report['host']}/", 'home': True, 'countries': [pool_tags.COUNTRIES.get(country, country)],
             'kinds': ['any'], 'source_kind': 'sector'} for report in wanted[:RESERVE]]


def tried(db):
    """[(host, country, day)] of the candidates a pass read lately, kept or not: a board that never reaches MIN_LOCAL local jobs must not take the slots every pass."""
    memory = scout_cells._meta(db, TRIED, {})
    return [(*key.split('|', 1), day) for key, day in (memory.items() if isinstance(memory, dict) else []) if '|' in key]


def stamp(db, country, hosts, today=None, refresh_days=20):
    """Remember the candidate hosts this pass read (older stamps than refresh_days are dropped: the memory stays small)."""
    today = today or date.today()
    old = (today - timedelta(days=refresh_days)).isoformat()
    memory = scout_cells._meta(db, TRIED, {})
    kept = {key: day for key, day in (memory.items() if isinstance(memory, dict) else []) if str(day) >= old}
    scout_cells._set(db, TRIED, {**kept, **{f'{host}|{country}': today.isoformat() for host in hosts}})


def choose(db, reported, country):
    """The candidates of this pass: `reported` (fetch's answer) for `country`, not measured lately by the Scout's facts and not tried lately (for_country)."""
    measured = [(host, code, read_at) for host, code, _, _, read_at, _ in scout_board_cells._facts(db)] + tried(db)
    # Why (13 Nov 2026, sa, with bp's all-boards report): our CI searches now report every board they read, refused ones too; a host the Scout's browser was stopped at (scout_browser_final:
    # a 401/403, a bot check, a sign-in page) is final, so the memory wins over the report and the host is not asked again, by this pass or any later one. One owner of the question
    # (scout_board_cells.stopped_hosts, Gitar on #4075) and `www.` is ignored on both sides: a press may write www.jooble.org for a stop stored as jooble.org.
    stopped = scout_board_cells.stopped_hosts(db)
    return for_country([report for report in reported if report['host'].removeprefix('www.') not in stopped], country, measured) if reported else []


def stamp_read(db, country, picked, counts):
    """Remember the candidates whose line is in the pass's `counts` (the boards it read)."""
    stamp(db, country, [item['host'] for item in picked if any(line.startswith(item['host'] + ' ') for line in counts)])
