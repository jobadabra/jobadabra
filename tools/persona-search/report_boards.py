"""Tells the site which job boards a CI search read, as names only, so the Central Scout can count them (a board no install reported reaches the Scout this way).
Why (13 Nov 2026, owner via sa, asked via AskUserQuestion: "Any install + our CI searches (Recommended)": "board names only (no person, no job); one report is enough to queue a board for the Scout;
the Trello people's CI searches report too, marked as ours; only the Scout's own result is served to apps"; "Let's fix it"): Jobeka and Trabajo.org gave a Madrid electrician 19 and 16 right
jobs in CI searches and no source told the Scout. Site half: jobadabra-web #643 (`ci-search-<run>` install id -> table `ci_boards`, never `sitefacts`, so no install count and no served number counts CI).
Invariants: (1) names, one count and one address template: a board's host, the fixed country id of the profile's country, `local` (how many jobs the search kept from it in the person's place, an integer 0..999) and `url`
(the board's search address as a TEMPLATE with {role} and {place} as blanks, only when scout_board_candidates.address_ok says it is one); no person, job, title, filled search, run id (the install id `ci-search-<run>` is the mark and
the site stores not even that); (2) only the fictional people of search-profiles.json (the night's 18 locked people are not in it: skipped, never touched), never a fixture or a test (only on GitHub Actions, or `--dry-run`);
(3) every board the search READ, listed jobs or not (the press record's sources of kind "job board", the host the press wrote), never a guess from a display name; the Scout measures each one itself
and its own memory of refusals wins over this report (src/scout_board_candidates.py choose); (4) a failed or refused
post is a warning, never a red run (the feed is a favour, not part of the measure); (5) one fixed address, honest user agent, no override.
  python3 tools/persona-search/report_boards.py <folder> [--person <id>] [--run <id>] [--dry-run]
<folder> is one run's folder (`out/` of search-profiles.yml, `out/<id>--<side>-<k>` of search-pair.yml) or a folder of such folders (a saved artifact).
Why `local` (13 Nov 2026, owner via sa: "ties are not equal, the search already knows which boards gave it jobs... send that number with the host (a count, fixed shape, validator both ends, capped), the site keeps
the highest seen, and for_country orders by it first"): discovery run 43520706763 read 4 of 77 reported boards in alphabetical order while Jobeka and Trabajo.org (19 and 16 right jobs for a Madrid electrician) waited. Site half: jobadabra-web #647.
Why `url` (14 Nov 2026, owner via sa, asked via AskUserQuestion: "CI report carries it (Recommended)": "our CI test searches (never a real install) report the search address shape they read, with {role} and {place} as blanks; the site
stores it after a validator ... and hands it to the Scout, which reads the same page the search read"): runs 43524652066 (es) and 43526430106 (md) read Jobeka by its home page (0 rows) where the search read https://es.jobeka.com/empleos-{role}-provincia-de-{place} (20 jobs).
The address comes from the run's `found-boards.json` (a copy of the engine's found_boards.json, as search-personas.yml already makes: `boards[host].search_url`, the template the search itself read from, built from the AI's board answer that saw
countries, places and role words only, never filled), not from run.log (a log line, its place spelled sevilla or seville, never a record) and not from the press row (host and counts). A record only: nothing a search does changes.
Site half: jobadabra-web #648. Tests: tests/tooling/ci/test_report_boards.py."""
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[1]))

URL = 'https://www.jobadabra.top/api/contribute'
USER_AGENT = 'jobadabra-ci-search'
FOLDER = re.compile(r'^(?:search-profile-)?([a-z]\d{2})(?:--.*)?$')   # search-profile-c04, c04--main-1, c04
HOST = re.compile(r'[a-z0-9-]+(\.[a-z0-9-]+)+')
MAX_BOARDS = 150   # the site's cap per share (jobadabra-web api/ci-boards.js MAX_CI_BOARDS)
MAX_LOCAL = 999    # the site's cap on `local` (jobadabra-web api/ci-boards.js MAX_LOCAL); the site turns anything above it into 0, so the cap is applied here too


def person_of(folder):
    """The profile id a run folder belongs to (`search-profile-c04`, `c04--main-1`, `c04`), or None when its name says no person."""
    found = FOLDER.match(Path(folder).name)
    return found.group(1) if found else None


def local_of(source):
    """The jobs a press row kept from a board in the person's place: its `local` as an integer 0..MAX_LOCAL, else 0 (a missing, text, negative, fractional or boolean value is no count)."""
    value = source.get('local')
    return value if isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= MAX_LOCAL else 0


def addresses(folder):
    """{registrable host: address} of the boards a run's search read at a search address: `boards[host].search_url` of the run folder's `found-boards.json`, kept only when scout_board_candidates.address_ok says it is
    a template of that board (https, the board's host or a subdomain, {role}, a fixed character set); {} without the file. A host with several entries takes the one the search read fine ('ok'), then the first by name.
    Why (14 Nov 2026, owner via sa): the file holds the AI's template, never the filled search, so no word of the profile can be in it; address_ok drops anything else."""
    from src import scout_board_candidates
    from src.sources.careers_parse import registrable
    try:
        boards = json.loads((Path(folder) / 'found-boards.json').read_text(encoding='utf-8')).get('boards')
    except (OSError, ValueError, AttributeError):
        return {}
    boards = boards if isinstance(boards, dict) else {}
    found = {}
    for name in sorted(boards, key=lambda key: ((boards[key] or {}).get('state') != 'ok' if isinstance(boards[key], dict) else True, str(key))):
        entry = boards[name]
        host = registrable(str(name).lower())
        address = scout_board_candidates.address_ok(entry.get('search_url'), host) if isinstance(entry, dict) and host else None
        if address and host not in found:
            found[host] = address
    return found


def boards_read(folder):
    """{host: local} of every board this run's first press read, from `draw/presses.jsonl` sources of kind 'job board' (the press wrote the real host); `local` is the most any row of the folder kept from it.
    Why (13 Nov 2026, sa, after bp's count on run 43514251379: 29 boards read, 16 listed jobs, 3 reported): the old filter `local >= 1` counted jobs SAVED in the person's place, so a board whose page listed
    38 jobs and none relevant (Trabajos.com) or 72 with 3 relevant (rabota.md) was never reported. The press row has no 'listed' count and no sign of a refusal (a refused board and a board with 38 listed jobs
    both read all zeros), so there is nothing to filter on; the Scout does its own measuring, one read of each board per 20 days, and a host it knows as refused is not asked."""
    path = Path(folder) / 'draw' / 'presses.jsonl'
    if not path.exists():
        return {}
    hosts = {}
    for line in path.read_text(encoding='utf-8', errors='replace').splitlines():
        try:
            record = json.loads(line)
        except ValueError:
            continue
        for source in record.get('sources') or []:
            host = str(source.get('source') or '').strip().lower()
            if source.get('kind') == 'job board' and HOST.fullmatch(host):
                hosts[host] = max(hosts.get(host, 0), local_of(source))
    return hosts


def country_of(person):
    """The pool id of the profile's country ('Spain' -> 'es'), or None for an id that is not in search-profiles.json or a country the fixed list lacks."""
    import profiles
    from src import scout_boards
    try:
        return scout_boards.named_country(profiles.profile(person)['country'])
    except (ValueError, KeyError):
        return None


def collect(path, person=None):
    """{(host, country): {'local': int, 'url': address or None}} for a run folder or a folder of run folders (the highest `local` over its folders for a host, the first address found); a folder with no known person
    or no readable country adds nothing."""
    path = Path(path)
    folders = [path] if (path / 'draw').is_dir() else sorted(draw.parent for draw in path.rglob('draw') if draw.is_dir())
    found = {}
    for folder in folders:
        who = person or person_of(folder)
        country = country_of(who) if who else None
        if country:
            where = addresses(folder)
            for host, local in boards_read(folder).items():
                known = found.get((host, country)) or {'local': 0, 'url': None}
                found[(host, country)] = {'local': max(known['local'], local), 'url': known['url'] or where.get(host)}
    return found


def body(found, run):
    """The share the site's CI door takes: {v, install: 'ci-search-<run>', ci_boards: [{host, countries, local, url?}]} from collect's {(host, country): {local, url}}; one item per (host, address), at most MAX_BOARDS,
    by host; an item's `local` is the highest over its countries, `url` is left out for a board with no address."""
    items = {}
    for (host, country), value in sorted(found.items()):
        entry = items.setdefault((host, value['url']), {'host': host, 'countries': [], 'local': 0, **({'url': value['url']} if value['url'] else {})})
        entry['countries'].append(country)
        entry['local'] = max(entry['local'], value['local'])
    boards = list(items.values())[:MAX_BOARDS]
    return {'v': 2, 'install': f'ci-search-{re.sub(r"[^A-Za-z0-9-]", "", str(run))[:40] or "run"}', 'ci_boards': boards}


def send(payload, post=None):
    """POST the share; True when the site took it. Never raises: a refused or failed post is a warning (invariant 4)."""
    request = urllib.request.Request(URL, data=json.dumps(payload).encode(), method='POST', headers={'Content-Type': 'application/json', 'User-Agent': USER_AGENT})
    try:
        with (post or urllib.request.urlopen)(request, timeout=20) as answer:
            status = answer.status
    except Exception as error:  # noqa: BLE001
        print(f'Warning: CI boards not sent ({type(error).__name__}: {error})')
        return False
    if status != 200:
        print(f'Warning: CI boards refused ({status})')
    return status == 200


def main(argv, post=None):
    args = list(argv)
    person = run = None
    dry = '--dry-run' in args
    args = [a for a in args if a != '--dry-run']
    for name in ('--person', '--run'):
        if name in args:
            at = args.index(name)
            value = args[at + 1]
            del args[at:at + 2]
            person, run = (value, run) if name == '--person' else (person, value)
    if len(args) != 1:
        print(__doc__.split('\n')[-3], file=sys.stderr)
        return 2
    found = collect(args[0], person)
    payload = body(found, run or os.environ.get('GITHUB_RUN_ID') or 'manual')
    print(f"CI boards: {len(payload['ci_boards'])} board(s) to tell the Scout: " + (', '.join(f"{b['host']} ({'/'.join(b['countries'])}, {b['local']} kept{', at an address' if b.get('url') else ''})" for b in payload['ci_boards']) or 'none'))
    if dry or not payload['ci_boards']:
        return 0
    if os.environ.get('GITHUB_ACTIONS') != 'true' or os.environ.get('JOBADABRA_FIXTURE_DIR'):
        print('CI boards: not sent (not a GitHub Actions run)')   # invariant 2: never from a Mac, a test or a fixture
        return 0
    send(payload, post)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
