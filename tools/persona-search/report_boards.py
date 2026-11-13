"""Tells the site which job boards a CI search read, as names only, so the Central Scout can count them (a board no install reported reaches the Scout this way).
Why (13 Nov 2026, owner via sa, asked via AskUserQuestion: "Any install + our CI searches (Recommended)": "board names only (no person, no job); one report is enough to queue a board for the Scout;
the Trello people's CI searches report too, marked as ours; only the Scout's own result is served to apps"; "Let's fix it"): Jobeka and Trabajo.org gave a Madrid electrician 19 and 16 right
jobs in CI searches and no source told the Scout. Site half: jobadabra-web #643 (`ci-search-<run>` install id -> table `ci_boards`, never `sitefacts`, so no install count and no served number counts CI).
Invariants: (1) names only: a board's host and the fixed country id of the profile's country; no person, job, title, template, run id (the install id `ci-search-<run>` is the mark and the site stores
not even that); (2) only the fictional people of search-profiles.json (the night's 18 locked people are not in it: skipped, never touched), never a fixture or a test (only on GitHub Actions, or `--dry-run`);
(3) the board must have GIVEN jobs (the press record's source of kind "job board" with local jobs >= 1, the host the press wrote), never a guess from a display name; (4) a failed or refused
post is a warning, never a red run (the feed is a favour, not part of the measure); (5) one fixed address, honest user agent, no override.
  python3 tools/persona-search/report_boards.py <folder> [--person <id>] [--run <id>] [--dry-run]
<folder> is one run's folder (`out/` of search-profiles.yml, `out/<id>--<side>-<k>` of search-pair.yml) or a folder of such folders (a saved artifact).
Tests: tests/tooling/ci/test_report_boards.py."""
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


def person_of(folder):
    """The profile id a run folder belongs to (`search-profile-c04`, `c04--main-1`, `c04`), or None when its name says no person."""
    found = FOLDER.match(Path(folder).name)
    return found.group(1) if found else None


def boards_read(folder):
    """The hosts of the boards this run's first press read that gave at least one local job: {host, ...} from `draw/presses.jsonl` sources of kind 'job board' (the press wrote the real host)."""
    path = Path(folder) / 'draw' / 'presses.jsonl'
    if not path.exists():
        return set()
    hosts = set()
    for line in path.read_text(encoding='utf-8', errors='replace').splitlines():
        try:
            record = json.loads(line)
        except ValueError:
            continue
        for source in record.get('sources') or []:
            host = str(source.get('source') or '').strip().lower()
            if source.get('kind') == 'job board' and HOST.fullmatch(host) and (source.get('local') or 0) >= 1:
                hosts.add(host)
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
    """{(host, country)} for a run folder or a folder of run folders; a folder with no known person or no readable country adds nothing."""
    path = Path(path)
    folders = [path] if (path / 'draw').is_dir() else sorted(draw.parent for draw in path.rglob('draw') if draw.is_dir())
    found = set()
    for folder in folders:
        who = person or person_of(folder)
        country = country_of(who) if who else None
        if country:
            found |= {(host, country) for host in boards_read(folder)}
    return found


def body(found, run):
    """The share the site's CI door takes: {v, install: 'ci-search-<run>', ci_boards: [{host, countries}]}; at most MAX_BOARDS hosts, the most countries first."""
    by_host = {}
    for host, country in sorted(found):
        by_host.setdefault(host, []).append(country)
    boards = [{'host': host, 'countries': countries} for host, countries in sorted(by_host.items())][:MAX_BOARDS]
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
    print(f"CI boards: {len(payload['ci_boards'])} board(s) to tell the Scout: " + (', '.join(f"{b['host']} ({'/'.join(b['countries'])})" for b in payload['ci_boards']) or 'none'))
    if dry or not payload['ci_boards']:
        return 0
    if os.environ.get('GITHUB_ACTIONS') != 'true' or os.environ.get('JOBADABRA_FIXTURE_DIR'):
        print('CI boards: not sent (not a GitHub Actions run)')   # invariant 2: never from a Mac, a test or a fixture
        return 0
    send(payload, post)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
