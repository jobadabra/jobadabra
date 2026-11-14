"""What the app's Jobs list shows of a person's jobs once their search has ended: the Search check's "shown" count, beside every open job.
Why (owner, 11 Nov 2026, asked via AskUserQuestion by sa: "Count what the list shows, then 4/5 (Recommended)"; rj's sketch): the check counted the store's
open jobs, while the app's Jobs list (src/desktop_jobs.py jobs) then hid a job not scored yet: on the night of 11 Nov 2026 that was 26 shown of 61 open
jobs, 14 of 40 wrong-role. This file asks the app's own function, so the count follows the app when it changes.
Why-changed (11 Nov 2026, owner, asked via AskUserQuestion by sa: "Follow the app, after #3843 merges (Recommended)"): since #3843 the app lists every found
job before its score (src/desktop.py _jobs, hide_unscored=False), so "shown" counts them too. Numbers before and after that merge (11 Nov 2026 23:17Z) are
not comparable: unscored jobs are not judged by the app yet, so shown and wrong-role shown rise for everyone at once.
  python3 tools/persona-search/shown.py --list   (internal) with the press's JOBADABRA_DATA_DIR / JOBADABRA_CONFIG_DIR: the shown jobs' url keys, one JSON line
"""
import json
import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
# The person this count is for: data on this Mac (what settleStore gives a new install), no Notion, an AI set up, the search ended.
ENV = {'JOBADABRA_STORE': 'sqlite', 'JOBADABRA_NO_DOTENV': '1', 'JOBADABRA_FOLLOW_APP': '0'}


def keys(db_path):
    """{link} (as the store's jobs table holds it) of the jobs the app's Jobs list shows from this press's store once its search has ended; set() for a store the press never made;
    None when the list could not be read (the count is then unknown, never 0). Runs in its own process: the engine reads its folders at import."""
    db_path = Path(db_path)
    if not db_path.exists():
        return set()
    env = {name: value for name, value in os.environ.items() if not name.startswith('NOTION_')}
    env.update(ENV, JOBADABRA_DATA_DIR=str(db_path.parent), JOBADABRA_CONFIG_DIR=str(db_path.parent.parent / 'config'))
    try:
        done = subprocess.run([sys.executable, str(Path(__file__).resolve()), '--list'], cwd=ROOT, env=env, capture_output=True, text=True, timeout=180)
    except (OSError, subprocess.TimeoutExpired) as error:
        print(f'shown: the app\'s list was not read ({type(error).__name__})', file=sys.stderr)
        return None
    if done.returncode:
        print(f'shown: the app\'s list was not read: {done.stderr.strip()[-400:]}', file=sys.stderr)
        return None
    return set(json.loads(done.stdout.strip().splitlines()[-1]))


def field(url, shown):
    """The `shown` field of one extracted row (gate.py extract): {'shown': bool}, or {} when the list could not be read (keys() None: unknown, never "not shown")."""
    return {} if shown is None else {'shown': url in shown}


def host_field(kind, url):
    """{'host': <the job's link host without www.>} for a job board's job, else {}: which board a job came from, even when its page names the employer (tools/persona-search/board_funnel.py).
    Why (14 Nov 2026, Gitar on #4196): the company's `via <board name>` is only there when the page names nobody, and the name is not the host. A host, never the link: the judge reads title, company and location only."""
    host = (urlparse(url or '').hostname or '').removeprefix('www.')
    return {'host': host} if kind == 'job board' and host else {}


def counts(judged):
    """The shown jobs' numbers from the judged rows (each carries `shown` from gate.py extract): shown_found = jobs the list shows,
    shown_local = of them right role AND right place, shown_wrong_role = of them wrong role. None each when the rows do not say."""
    if not judged or any('shown' not in row for row in judged):
        return {'shown_found': None, 'shown_local': None, 'shown_wrong_role': None}
    shown = [row for row in judged if row['shown']]
    return {'shown_found': len(shown), 'shown_local': sum(1 for r in shown if r.get('role') == 'yes' and r.get('place') == 'yes'),
            'shown_wrong_role': sum(1 for r in shown if r.get('role') == 'no')}


def _list():
    """The app's Jobs list as the app reads it on this Mac's store (src/desktop.py _jobs: store_jobs, then jobs, a found job listed before its score since #3843)."""
    sys.path.insert(0, str(ROOT))
    from src import store
    from src.desktop_jobs import jobs
    from src.desktop_store_jobs import store_jobs
    from src.paths import JOBS_DB
    from src.stores import open_stores
    from src.stores.base import url_key
    with store.connect(JOBS_DB) as db:
        listed = jobs(db, limit=1_000_000, notion_jobs=store_jobs(open_stores()), hide_unscored=False)   # as src/desktop.py _jobs calls it
        shown = {url_key(row['url']) for row in listed['jobs'] if row.get('url')}
        links = [url for (url,) in db.execute("SELECT url FROM jobs WHERE state = 'open'")]
    # The list's links may be another form of the same posting (a slash, tracking): matched by the one identity, answered in the jobs table's own form.
    print(json.dumps(sorted(url for url in links if url and url_key(url) in shown)))


if __name__ == '__main__':
    if sys.argv[1:] == ['--list']:
        _list()
    else:
        sys.exit(__doc__)
