"""The boards installs reported, as candidates for board discovery's pass: boards the AI never names (a cell's measure starts from the AI's ideas plus these).
Why (13 Nov 2026, owner, asked via AskUserQuestion by sa: "Any reported board (Recommended)": "The Scout, our own server job, counts a board even when only 1 install reported it.
Only the Scout's own count is served to apps, never which install reported it."; plan docs/superpowers/plans/2026-11-13-proven-boards.md PR 5/5, site half jobadabra-web #642): Spain's
pass proposed InfoJobs, Colejobs and two others; Jobeka and Trabajo.org, the boards that give Madrid electricians their right jobs, reach the Scout through no source.
Design: a board's state for one (country, family) has one owner, the Scout: reported (this list: a candidate only) -> counted (read with the family's own word, `right` + `day`) -> proven
(`right` >= 3). Verdicts: reported->counted = one Scout read; a board measured within REFRESH_DAYS is not a candidate again. Reports only ORDER and widen the candidates, they prove nothing.
Order (13 Nov 2026, owner via sa: "ties are not equal, the search already knows which boards gave it jobs"; site jobadabra-web #647): `local` (jobs our CI searches kept from the board) first, then installs, then host; run 43520706763
(es:electrical_mechanical) read 4 of 77 reported boards alphabetically while Jobeka and Trabajo.org (19 and 16 right jobs for a Madrid electrician) waited.
Address (14 Nov 2026, owner via sa, asked via AskUserQuestion: "CI report carries it (Recommended)": "our CI test searches (never a real install) report the search address shape they read, with {role} and {place} as blanks;
the site stores it after a validator (https, same board, blanks only, no personal words) and hands it to the Scout, which reads the same page the search read"; site jobadabra-web #648): discovery runs 43524652066 (es) and 43526430106 (md) read
Jobeka by its home page (https://jobeka.com/, 0 rows) where the CI search read https://es.jobeka.com/empleos-{role}-provincia-de-{place} (20 jobs). A board's `ci_urls[country]` is that address, kept after address_ok (the site checks the same
shape): a candidate with one is read THERE, like an AI-named template board; one without keeps the home read. This is the only reported address the Scout ever reads: the install-reported `url` stays dropped (invariant 2).
Design (a 3rd fix in 7 days on this file, so the state is written down): a candidate's read state is per (host, country, target), the one owner being this file's stamp (`board_candidates` in scout_meta): target = the address, or '' for the home page.
Verdicts: reported -> read at its target (stamp host|country[|address], any outcome) -> not a candidate AGAIN for REFRESH_DAYS at that target. A candidate WITH an address is due until that exact address was read (a home read, kept or empty, says
nothing about it); a candidate WITHOUT one is blocked by any read of the host in the country, as before. The 20-day rule itself is unchanged.
Invariants: (1) the list comes from the Scout's own key and route only (GET <scout-memory>?boards=1, INDEX_PUBLISH_KEY); never an install id (the site sends none, `fetch` keeps only host,
countries, installs, local); (2) a reported search template is a HINT, never read: a reported template can be a job-alert subscribe form (rabota.md: `?subscribePosition={role}&subscribeName={place}`),
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
from .sources.careers_explore import company_domain

URL = 'https://www.jobadabra.top/api/scout-memory'
RESERVE = 4                 # reported boards a pass reads beside the AI's ideas and the re-reads (Why (13 Nov 2026, bp): the pass reads ~5 boards in its 240 s; the ideas keep the rest)
MAX_RESERVE = 24            # the most candidates one by-hand pass may ask for (Why (13 Nov 2026, bp): owner's range 1..24; the pass reads at most scout_boards.MAX_BOARDS (12) boards in all, so more is cut there)
TRIED = 'board_candidates'  # scout_meta: {"<host>|<country>": "YYYY-MM-DD"} a candidate the pass read (kept or not): not a candidate again for REFRESH_DAYS
MAX_LOCAL = 999             # the site's cap on `local` (jobadabra-web api/ci-boards.js MAX_LOCAL)
MAX_ADDRESS = 200           # the site's cap on a CI address (jobadabra-web api/ci-boards.js MAX_ADDRESS)
MAX_BOARDS = 1500           # the site's cap (jobadabra-web api/scout-memory.js MAX_REPORTED)
HOST = re.compile(r'[a-z0-9-]+(\.[a-z0-9-]+)+')
ADDRESS = re.compile(r'https://([a-z0-9.-]+)([/?][^#]*)')   # the shape of a search address; what may stand after the host is FIXED
FIXED = re.compile(r'[A-Za-z0-9._~\-/=&?:,]*')


def address_ok(url, host):
    """`url` when it is a valid search template of the board `host` (registrable), else None: https, the host or a subdomain of it, no userinfo, port or fragment, at most MAX_ADDRESS characters, `{role}` once or more,
    `{place}` optional, nothing else outside letters, digits and . _ ~ - / = & ? : , (no %, spaces or accents: an encoded word is a person's word). The same shape as the site's searchAddress (jobadabra-web api/ci-boards.js):
    checked there on the way in and here on the way in and out of the report."""
    if not isinstance(url, str) or not isinstance(host, str) or not HOST.fullmatch(host) or len(url) > MAX_ADDRESS or company_domain(host) != host:
        return None   # `host` must itself be a company's domain (careers_explore.company_domain, the engine's one public-suffix rule): 'co.uk' or 'com.br' alone would pass every *.co.uk address as "the same board" (Gitar on #4127)
    found = ADDRESS.fullmatch(url)
    if not found or not (found[1] == host or found[1].endswith('.' + host)) or '{role}' not in url:
        return None
    return url if FIXED.fullmatch(found[2].replace('{role}', 'x').replace('{place}', 'x')) else None


def reserve():
    """How many reported boards this pass reads: env SCOUT_BOARD_RESERVE (lab board-discovery.yml's `reserve` input, by hand) as a whole number clamped to 1..MAX_RESERVE; anything else
    (unset, empty, text, a fraction) is the default RESERVE, so the schedule is unchanged. Never trusted: an input is a request, the limits are ours."""
    try:
        return min(max(int(os.environ.get('SCOUT_BOARD_RESERVE', '').strip()), 1), MAX_RESERVE)
    except ValueError:
        return RESERVE


def valid(item):
    """The report in the shape the pass uses, or None: {host, countries: [codes of the fixed list], installs (0 for a board only our CI searches read), local (jobs a CI search kept from it, int 0..MAX_LOCAL, else 0),
    ci_urls {country: address_ok address} only when a CI search read the board at one}.
    The reported template and everything else is dropped on purpose (invariant 2)."""
    if not isinstance(item, dict) or not isinstance(item.get('host'), str) or not HOST.fullmatch(item['host']) or len(item['host']) > 100:
        return None
    countries = sorted({code for code in item.get('countries') or [] if isinstance(code, str) and code in pool_tags.COUNTRIES})
    installs = item.get('installs')
    floor = 0 if item.get('ci') is True else 1   # Why (13 Nov 2026, bp, jobadabra-web #643): a board only our own CI searches read comes with installs 0 and ci true; it is a candidate too, last in the order
    if not countries or not isinstance(installs, int) or isinstance(installs, bool) or installs < floor:
        return None
    local, given = item.get('local'), item.get('ci_urls')
    addresses = {code: address for code, url in (given.items() if isinstance(given, dict) else []) if code in countries and (address := address_ok(url, item['host']))}
    return {'host': item['host'], 'countries': countries, 'installs': installs,
            'local': local if isinstance(local, int) and not isinstance(local, bool) and 0 <= local <= MAX_LOCAL else 0, **({'ci_urls': addresses} if addresses else {})}


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
    """The boards of `reports` serving `country` that are not read already: [{name, host, search_url, countries, kinds, source_kind} + home: True for the home page], the boards that gave jobs first, then most
    installs, then by host; at most reserve(). A board a CI search read at an address in this country (`ci_urls`) is read THERE (search_url = the address, no `home`); any other by its home page.
    `measured`: [(host, country, read_at[, target])] of the Scout's facts and stamps, target = the address that read had (home reads: '' or the form link found); a read within `refresh_days` is not repeated:
    a candidate with an address is due until THAT address was read (a home read says nothing about it), one without is blocked by any read of the host in the country (Design: top of the file)."""
    today = today or date.today()
    since = (today - timedelta(days=refresh_days)).isoformat()
    read = [(host, code, target[0] if target else '') for host, code, read_at, *target in measured if str(read_at) >= since]

    def address(report):
        return (report.get('ci_urls') or {}).get(country)

    def due(report):
        return not any(host == report['host'] and code == country and (not address(report) or target == address(report)) for host, code, target in read)
    wanted = sorted((report for report in reports if country in report['countries'] and due(report)), key=lambda report: (-report.get('local', 0), -report['installs'], report['host']))
    return [{'name': report['host'], 'host': report['host'], 'search_url': address(report) or f"https://{report['host']}/", **({} if address(report) else {'home': True}),
             'countries': [pool_tags.COUNTRIES.get(country, country)], 'kinds': ['any'], 'source_kind': 'sector'} for report in wanted[:reserve()]]


def tried(db):
    """[(host, country, day, target)] of the candidates a pass read lately, kept or not: a board that never reaches MIN_LOCAL local jobs must not take the slots every pass. target: the address read, '' for a home read."""
    memory = scout_cells._meta(db, TRIED, {})
    return [(host, country, day, rest[0] if rest else '') for key, day in (memory.items() if isinstance(memory, dict) else []) if key.count('|') >= 1 for host, country, *rest in [key.split('|', 2)]]


def stamp(db, country, reads, today=None, refresh_days=20):
    """Remember the candidates this pass read: `reads` [(host, target)], target the address read or '' for the home page (older stamps than refresh_days are dropped: the memory stays small)."""
    today = today or date.today()
    old = (today - timedelta(days=refresh_days)).isoformat()
    memory = scout_cells._meta(db, TRIED, {})
    kept = {key: day for key, day in (memory.items() if isinstance(memory, dict) else []) if str(day) >= old}
    scout_cells._set(db, TRIED, {**kept, **{'|'.join(filter(None, (host, country, target))): today.isoformat() for host, target in reads}})


def choose(db, reported, country):
    """The candidates of this pass: `reported` (fetch's answer) for `country`, not measured lately by the Scout's facts and not tried lately (for_country)."""
    measured = [(host, code, read_at, url) for host, code, url, _, read_at, _ in scout_board_cells._facts(db)] + [(host, code, day, target) for host, code, day, target in tried(db)]
    # Why (13 Nov 2026, sa, with bp's all-boards report; Gitar on #4075): our CI searches report every board they read, refused ones too; a host the Scout's browser was stopped at (scout_browser_final:
    # a 401/403, a bot check, a sign-in page) is final, so the memory wins over the report and the host is not asked again, by this pass or any later one. One owner of the question
    # (scout_board_cells.stopped_hosts, Gitar on #4075) and `www.` is ignored on both sides: a press may write www.jooble.org for a stop stored as jooble.org.
    stopped = scout_board_cells.stopped_hosts(db)
    return for_country([report for report in reported if report['host'].removeprefix('www.') not in stopped], country, measured) if reported else []


def stamp_read(db, country, picked, counts):
    """Remember the candidates whose line is in the pass's `counts` (the boards it read)."""
    stamp(db, country, [(item['host'], '' if item.get('home') else item.get('search_url') or '') for item in picked if any(line.startswith(item['host'] + ' ') for line in counts)])
