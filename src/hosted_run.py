"""Hosted Always on, the container's side: `python -m src hosted --site URL --token HR1...` (or `--serve` in the container) pulls the person's state from our Worker, runs one SQLite-store search with AI through our route, and posts the new matches back.
Spec private spec jobadabra-lab:docs/specs/2026-10-16-hosted-always-on.md §1-2. The run token is the only credential: it asks the Worker for the state (GET /api/hosted/state), is the AI key
(x-api-key on /api/ai), and posts the one result (POST /api/hosted/result). No Notion, Gmail, Telegram or user key is ever here. Guard: tests/unit/engine/test_hosted_run.py.
"""
import io
import json
import os
import shutil
import signal
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

from .build_stamp import build_of
from .sources.ats import USER_AGENT

SEARCH_ARGS = ['--mode', 'scheduled', '--enrich-max', '100', '--score-max', '60', '--auto-kit-max', '0', '--budget', '600']
MAX_MATCHES = 200
DEFAULT_CONFIG = Path(__file__).resolve().parents[1] / 'config'


# Why (5 Nov 2026, hr 6/6 try 4 and 6): the instance's image digest was the new one, yet the 500 had the old body. The Worker logs this on every run and, since try 6, compares it with the stamp the deploy built (src/build_stamp.py).
BUILD = build_of(Path(__file__).resolve().parent)   # src/build_stamp.py: the deploy prints the same stamp


def _call(url, token, method='GET', data=None):
    request = urllib.request.Request(url, data=data, method=method, headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json', 'User-Agent': USER_AGENT})   # Why (5 Nov 2026, hr 6/6 try 5): Cloudflare answers urllib's own agent with 403 1010 before our Worker sees the call
    with urllib.request.urlopen(request, timeout=120) as reply:
        return reply.read()


def pull_state(site, token, folder):
    """The person's state (a tar of config/, data/) from the Worker into `folder`; an empty folder when there is none yet. -> True when state arrived."""
    try:
        blob = _call(f'{site}/api/hosted/state', token)
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return False
        raise
    with tarfile.open(fileobj=io.BytesIO(blob), mode='r:gz') as tar:
        tar.extractall(folder, filter='data')   # 'data': no absolute paths, no links out of the folder
    return True


def pull_config(site, token, folder):
    """What the app pushed ({search, profile, cv}) into config/search.json, profile.md, cv.md. -> True when there was a config."""
    try:
        given = json.loads(_call(f'{site}/api/hosted/config', token))
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return False
        raise
    shutil.copytree(DEFAULT_CONFIG, folder / 'config', dirs_exist_ok=True)   # the engine's own files (preferences, schemas) under what the app pushed: a run never starts on a bare folder
    (folder / 'config' / 'search.json').write_text(json.dumps(given.get('search') or {}))
    (folder / 'config' / 'profile.md').write_text(given.get('profile') or '')
    (folder / 'config' / 'cv.md').write_text(given.get('cv') or '')
    return bool(given.get('search'))


def push_state(site, token, folder):
    """Our copy of the state back to the Worker (which encrypts it at rest in R2): data/ (the stores), without the crawl's reports.
    The config is the app's to change (PUT /api/hosted/config), never ours."""
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode='w:gz') as tar:
        if (folder / 'data').exists():
            tar.add(folder / 'data', arcname='data', filter=lambda info: None if '/reports' in info.name else info)
    _call(f'{site}/api/hosted/state', token, 'PUT', buffer.getvalue())


def environment(folder, site, token, base=None, started=None):
    """The engine's environment for a hosted run: the SQLite store in `folder`, AI through the site with the run token, nothing else.
    `started` (epoch seconds, default now): the run's start, the clock every engine step's budget counts from (src/time_budget.py SEARCH_AT)."""
    env = dict(base if base is not None else os.environ)
    for name in [key for key in env if key.startswith(('NOTION_', 'TELEGRAM_', 'ANTHROPIC_', 'OPENAI_', 'JOBADABRA_TRIAL', 'JOBADABRA_AI'))]:
        del env[name]   # a hosted run holds no other credential, whatever the image or the host sets
    env.update({'JOBADABRA_STORE': 'sqlite', 'JOBADABRA_DISABLE': 'notion', 'JOBADABRA_CONFIG_DIR': str(folder / 'config'),
                'JOBADABRA_DATA_DIR': str(folder / 'data'), 'JOBADABRA_PROFILE_FILE': str(folder / 'config' / 'profile.md'),
                'JOBADABRA_AI_BASE_URL': f'{site}/api/ai', 'ANTHROPIC_API_KEY': token, 'JOBADABRA_TRIGGER': 'hosted',
                'JOBADABRA_EURES': '1'})   # Why (ap 4/6, 11 Nov 2026, owner: "We should replicate the entire functionality/settings on the Always on"; 10 Nov: "In the beta/stable releases it should be on"): the cloud run is the product, like the installed app (desktop/lib/eures-on.js); only source and CI stay off
    # Why (5 Nov 2026, the first production test, run_8d5151c3): without the press's time the budget started after 372 s of setup and ended
    # past the 14-minute kill; the app gives every step its press's time the same way (desktop/lib/search-steps.js).
    # Why (owner, 13 Nov 2026, asked via AskUserQuestion: "Both ways", "By hand, right after merge (Recommended)"): the Always on LinkedIn trial; every GET asks the site first
    # (src/sources/linkedin_turn.py), which gives turns to the owner's install only, with its caps, so another account's run reads nothing from LinkedIn.
    env.update({'JOBADABRA_LINKEDIN_GUEST': '1', 'JOBADABRA_LINKEDIN_TURN': site, 'JOBADABRA_RUN_TOKEN': token})
    env['JOBADABRA_SEARCH_AT'] = str(started if started is not None else time.time())
    return env


# Why (owner, 14 Nov 2026, asked via AskUserQuestion: "Yes, both PRs (Recommended)"): a cloud-found job opened on the Mac with "This job has no saved description" and every
# fact "Not stated": only url, title, company, fit and reason travelled. The match's facts (its store columns' own words) and the posting the run read now go with it;
# the site keeps these named fields only, each capped (jobadabra-web shared/hosted.js POSTING_MAX).
FACTS = ('location', 'work_mode', 'posted', 'salary', 'contract', 'seniority', 'languages', 'apply_route')
POSTING = ('description', 'source', 'source_kind')


def new_matches(before, after, postings=None):
    """The matches the run added (by url), best fit first, as the result post carries them, each with its facts and, from `postings` (read_postings), its posting."""
    known = {m.get('url') for m in before}
    fresh = [m for m in after if m.get('url') not in known and m.get('url')]
    fresh.sort(key=lambda m: -(m.get('fit') or 0))
    text = lambda v: ', '.join(map(str, v)) if isinstance(v, list) else str(v or '')   # languages is a list in the store, a string on the wire
    return [{'job': m['url'], 'title': m.get('title') or '', 'company': m.get('company') or '', 'url': m['url'], 'fit': m.get('fit') or 0,
             'line': (m.get('reason') or '')[:300],
             **{k: text(m.get(k)) for k in FACTS if m.get(k)}, **{k: v for k, v in ((postings or {}).get(m['url']) or {}).items() if k in POSTING and v}}
            for m in fresh[:MAX_MATCHES] if m.get('title')]


def postings(urls):
    """{url: {description, source, source_kind}} from this install's jobs file, for the urls it holds (run with the engine's environment)."""
    from . import store
    from .paths import jobs_db
    found = {}
    with store.connect(jobs_db()) as db:
        for url in urls:
            row = db.execute("""SELECT jobs.description, sources.name source, sources.kind source_kind FROM jobs LEFT JOIN sources ON sources.id=jobs.source_id
                                WHERE jobs.canonical_key IN (?, ?) OR jobs.url=?""", store.job_keys(url)).fetchone()
            if row:
                found[url] = {k: row[k] or '' for k in POSTING}
    return found


def read_postings(env, urls):
    """postings(urls) as the engine would read them with `env` (the run's own folder)."""
    code = 'import json, sys; from src import hosted_run; print(json.dumps(hosted_run.postings(json.load(sys.stdin))))'
    out = subprocess.run([sys.executable, '-c', code], env=env, input=json.dumps(list(urls)), capture_output=True, text=True, check=True)
    return json.loads(out.stdout.strip().splitlines()[-1])


def read_matches(env):
    """The store's matches (a list of records) as the engine would read them with `env`."""
    code = 'import json; from src import store_access; s = store_access.open_run(); print(json.dumps(s.matches.list(), default=str))'
    out = subprocess.run([sys.executable, '-c', code], env=env, capture_output=True, text=True, check=True)
    return json.loads(out.stdout.strip().splitlines()[-1])


def postings_or_none(env, urls):
    """read_postings, or {} when it fails: the postings are extras, so a failed read still posts the run's jobs (as before #4248) and says why."""
    try:
        return read_postings(env, urls)
    except (subprocess.SubprocessError, OSError, ValueError) as error:
        print(f'hosted run: postings not read, jobs sent without them: {type(error).__name__}: {error}', file=sys.stderr)
        return {}


def run(site, token, folder, search=None):
    """One hosted run in `folder`. -> the result body that was posted. `search` is the engine process (a test swaps it)."""
    site, started = site.rstrip('/'), time.time()
    pull_state(site, token, folder)   # none yet on the first run: the stores start empty
    configured = pull_config(site, token, folder)
    env = environment(folder, site, token, started=started)
    status, matches = 'failed', []
    if configured:
        try:
            before = read_matches(env)
            done = (search or (lambda e: subprocess.run([sys.executable, '-m', 'src', 'daily', *SEARCH_ARGS], env=e, timeout=14 * 60).returncode))(env)
            if done == 0:
                after = read_matches(env)
                matches = new_matches(before, after, postings_or_none(env, [m.get('url') for m in after if m.get('url') not in {b.get('url') for b in before}]))
                status = 'ok'
                push_state(site, token, folder)
        except (subprocess.SubprocessError, OSError, ValueError) as error:
            print(f'hosted run failed: {type(error).__name__}: {error}', file=sys.stderr)
    body = {'status': status, 'matches': matches}
    _call(f'{site}/api/hosted/result', token, 'POST', json.dumps(body).encode())
    return body


def serve(port=8080):
    """The container's mode (`--serve`): the Worker starts the container and POSTs /run {site, token}; the reply comes when the run is done, so the Worker's
    Queue consumer can wait for it (Cloudflare Containers are driven by requests, as tools/hosted-probe). One run at a time; GET / answers ok plus the build hash and start time for the start check."""
    import http.server
    lock = threading.Lock()
    started = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())   # an instance that survived a deploy shows an old time here

    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def reply(self, code, body):
            data = json.dumps(body).encode()
            self.send_response(code); self.send_header('Content-Type', 'application/json'); self.end_headers(); self.wfile.write(data)

        def do_GET(self):
            self.reply(200, {'ok': True, 'build': BUILD, 'started': started, 'busy': lock.locked()})   # busy: the runner never restarts it mid-run

        def do_POST(self):
            try:
                given = json.loads(self.rfile.read(int(self.headers.get('Content-Length') or 0)) or b'{}')
            except ValueError:
                return self.reply(400, {'ok': False})
            token, site = str(given.get('token', '')), str(given.get('site', ''))
            if self.path != '/run' or not token.startswith('HR1.') or not (site.startswith('https://') or site.startswith('http://127.0.0.1:')):   # loopback http only for the e2e (tools/hosted-e2e)
                return self.reply(400, {'ok': False})
            if not lock.acquire(blocking=False):
                return self.reply(409, {'ok': False, 'error': 'a run is in progress'})
            try:
                with tempfile.TemporaryDirectory(prefix='jp-hosted-') as folder:
                    body = run(site, token, Path(folder))
                self.reply(200, {'ok': True, 'status': body['status'], 'matches': len(body['matches'])})
            except Exception as error:   # the Worker sees a failed run; the run token expires by itself
                reason = f'{type(error).__name__}: {error}'.replace(token, '[run token]')[:300]   # the run token is the only credential: never in an answer
                print(f'hosted run crashed: {reason}', file=sys.stderr)
                self.reply(500, {'ok': False, 'error': reason, 'build': BUILD})   # Why (5 Nov 2026, hr 6/6 try 3 and 4): the Worker saw only "500"; the reason was in a stderr nobody reads. `build` names the code that crashed (try 4: the new image answered with the old body)
            finally:
                lock.release()

    server = http.server.ThreadingHTTPServer(('0.0.0.0', port), Handler)
    # Why (5 Nov 2026, review and Gitar on #3222): a rollout's stop mid-run cut a search whose AI was already paid (a run is at most 14 min), and
    # waiting on the run lock missed a call accepted but still reading its body. Non-daemon handlers: server_close() joins every accepted call.
    server.daemon_threads = False
    # Why (5 Nov 2026, hr 6/6 try 6): as PID 1 in the container a default SIGTERM is never delivered, so Cloudflare's stop (sleepAfter, a new
    # rollout) was ignored ten times and old code kept answering after a deploy. shutdown() from the serving thread would deadlock: a thread does it.
    signal.signal(signal.SIGTERM, lambda *_: threading.Thread(target=server.shutdown, daemon=True).start())
    server.serve_forever()
    server.server_close()   # no new calls; each accepted call (a run included) answers the Worker before the process ends


def facts_of(match):
    """The store columns of an inbox match (FACTS), in the store's own shapes: languages back to a list."""
    found = {k: match[k] for k in FACTS if match.get(k)}
    if 'languages' in found:
        found['languages'] = [part.strip() for part in str(found['languages']).split(',') if part.strip()]
    return found


def keep_posting(url, match):
    """The posting of an inbox match into this Mac's jobs file (the drawer's Description tab and facts read it: src/desktop_jobs.py posting), through the one writer.
    Invariants: a row the Mac already holds for this url keeps what it stored (only its empty description, posted date and route are filled); a job the store
    calls the same as another site's posting is not written onto that posting (store.same_job keeps the first copy)."""
    from . import store
    from .paths import jobs_db
    from .stores.matches_sync import route_key
    route = route_key(match.get('apply_route'))
    with store.connect(jobs_db()) as db:
        row = db.execute('SELECT id FROM jobs WHERE canonical_key IN (?, ?) OR url=?', store.job_keys(url)).fetchone()
        if row:
            for column, value in (('description', match.get('description')), ('posted_at', match.get('posted')), ('apply_route', route)):
                if value:
                    db.execute(f"UPDATE jobs SET {column}=? WHERE id=? AND COALESCE({column}, '') = ''", (value, row['id']))
            return
        item = {'url': url, 'title': match['title'], 'company': match.get('company') or '',
                **{key: match[wire] for key, wire in (('location', 'location'), ('work_mode', 'work_mode'), ('description', 'description'), ('date_posted', 'posted')) if match.get(wire)}}
        job, _ = store.upsert_job(db, item, match.get('source') or 'Always on', '', match.get('source_kind') or 'job board')
        if route and (db.execute('SELECT url FROM jobs WHERE id=?', (job,)).fetchone() or {'url': ''})['url'] == url:
            db.execute('UPDATE jobs SET apply_route=? WHERE id=?', (route, job))


def merge(path):
    """The app's side (`--merge inbox.json`): matches that arrived while the Mac was off go into this Mac's own store as Open rows, unless the search already has the job.
    -> how many were added. The Mac's store stays the primary copy; the hosted copy is a cache (spec §2)."""
    from . import store_access
    stores = store_access.open_run()
    added, lines = 0, []
    for match in json.loads(Path(path).read_text()):
        url = match.get('url') or ''
        if not url or not match.get('title') or stores.matches.get(url):
            continue
        stores.matches.upsert({'url': url, 'title': match['title'], 'company': match.get('company') or '', 'fit': match.get('fit') or 0,
                               'reason': match.get('line') or '', 'status': 'Open', **facts_of(match)})
        # Why (Gitar on #4248): the app moves its inbox position past the whole batch once merge ends well (desktop/lib/hosted-search.js pullInbox), so a
        # job skipped here is lost and a crash blocks every later job: the match is always saved, and a posting that could not be written is said, not fatal.
        try:
            keep_posting(url, match)
        except (sqlite3.Error, OSError) as error:
            print(f'hosted merge: {url}: posting not saved: {type(error).__name__}: {error}', file=sys.stderr)
        added += 1
        clean = lambda text: str(text or '').replace('|', '/').replace('\n', ' ').strip()   # the log line's own separator
        lines.append(f"New job: {clean(match['title'])} | {clean(match.get('company'))} | {url} | {int(match.get('fit') or 0)}")
    if added:
        # The run card in Recent activity (spec §4b): what arrived while this Mac was off, one row of this Mac's own run history. Written directly: the AI ran on our
        # servers, so none of the run log's own words (cost, warnings) apply here.
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc)
        stores.cron_runs.put({'kind': 'scheduled', 'where': 'cloud', 'status': 'OK', 'started_at': now.isoformat(timespec='seconds'), 'finished_at': now.isoformat(timespec='seconds'),
                              'progress': [], 'trigger': 'Always on', 'mode': 'scheduled', 'title': f"{now.astimezone().strftime('%Y-%m-%d %H:%M')} · Always on",
                              'summary': f"{added} new {'job' if added == 1 else 'jobs'} while you were away", 'report': '', 'result': '',
                              'log': '\n'.join(['Ran on our servers: no technical log is kept.', *lines]), 'stats': {'new_jobs': added}})   # the New job lines are the run card's items (renderer/new-jobs-card.js)
    return added


def main():
    args = sys.argv[1:]
    if '--merge' in args:
        print(f"hosted merge: {merge(args[args.index('--merge') + 1])} new matches added")
        return 0
    if '--serve' in args:
        serve()
        return 0
    site = args[args.index('--site') + 1] if '--site' in args else os.environ.get('HOSTED_SITE', 'https://www.jobadabra.top')
    token = args[args.index('--token') + 1] if '--token' in args else os.environ.get('HOSTED_RUN_TOKEN', '')
    if not token.startswith('HR1.'):
        print('hosted: a run token (HR1...) is needed: --token or HOSTED_RUN_TOKEN', file=sys.stderr)
        return 2
    with tempfile.TemporaryDirectory(prefix='jp-hosted-') as folder:
        body = run(site, token, Path(folder))
    print(f"hosted run {body['status']}: {len(body['matches'])} new matches")
    return 0 if body['status'] == 'ok' else 1


if __name__ == '__main__':
    sys.exit(main())
