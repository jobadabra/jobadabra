"""Hosted Always on, the engine's side (src/hosted_run.py): state round-trips through the Worker, the environment holds only the run token, only new matches are posted."""
import http.server
import io
import json
import tarfile
import urllib.error
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

from src import hosted_run


class FakeWorker(http.server.BaseHTTPRequestHandler):
    state = None
    posted = []
    seen_auth = []

    def log_message(self, *args):
        pass

    config = {'search': {'role_keywords': ['sre']}, 'profile': 'P', 'cv': 'C'}

    def do_GET(self):
        FakeWorker.seen_auth.append(self.headers['Authorization'])
        if self.path.endswith('/config'):
            if FakeWorker.config is None:
                self.send_response(404); self.end_headers(); return
            self.send_response(200); self.end_headers(); self.wfile.write(json.dumps(FakeWorker.config).encode()); return
        if FakeWorker.state is None:
            self.send_response(404); self.end_headers(); return
        self.send_response(200); self.end_headers(); self.wfile.write(FakeWorker.state)

    def do_PUT(self):
        FakeWorker.state = self.rfile.read(int(self.headers['Content-Length']))
        self.send_response(200); self.end_headers()

    def do_POST(self):
        FakeWorker.posted.append(json.loads(self.rfile.read(int(self.headers['Content-Length']))))
        self.send_response(200); self.end_headers(); self.wfile.write(b'{"ok": true}')


def tar_of(files):
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode='w:gz') as tar:
        for name, text in files.items():
            data = text.encode(); info = tarfile.TarInfo(name); info.size = len(data); tar.addfile(info, io.BytesIO(data))
    return buffer.getvalue()


class HostedRun(unittest.TestCase):
    def setUp(self):
        import signal
        self.addCleanup(signal.signal, signal.SIGTERM, signal.getsignal(signal.SIGTERM))   # serve() installs a real handler (review of #hr-12)
        FakeWorker.state, FakeWorker.posted, FakeWorker.seen_auth = None, [], []
        FakeWorker.config = {'search': {'role_keywords': ['sre']}, 'profile': 'P', 'cv': 'C'}
        self.server = http.server.HTTPServer(('127.0.0.1', 0), FakeWorker)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.site = f'http://127.0.0.1:{self.server.server_port}'
        self.folder = Path(tempfile.mkdtemp())

    def tearDown(self):
        self.server.shutdown()

    def test_environment_holds_the_run_token_and_no_other_credential(self):
        base = {'NOTION_TOKEN': 'n', 'TELEGRAM_BOT_TOKEN': 't', 'ANTHROPIC_API_KEY': 'sk-mine', 'OPENAI_API_KEY': 'o', 'JOBADABRA_TRIAL_KEY': 'JPF1.x.y', 'PATH': '/bin'}
        env = hosted_run.environment(self.folder, self.site, 'HR1.run.tok', base)
        self.assertEqual(env['ANTHROPIC_API_KEY'], 'HR1.run.tok')
        self.assertEqual(env['JOBADABRA_AI_BASE_URL'], f'{self.site}/api/ai')
        self.assertEqual(env['JOBADABRA_STORE'], 'sqlite')
        self.assertEqual(env['JOBADABRA_EURES'], '1')   # ap 4/6: the cloud reads EURES as the installed app does
        for name in ('NOTION_TOKEN', 'TELEGRAM_BOT_TOKEN', 'OPENAI_API_KEY', 'JOBADABRA_TRIAL_KEY'):
            self.assertNotIn(name, env)

    def test_the_search_budget_counts_from_the_run_start_not_from_after_the_setup(self):
        # Why (5 Nov 2026, the first production test, run_8d5151c3): the setup before daily's budget (__main__: roles, places) took 372 s with no
        # clock, the budget's 600 s then ended at 972 s, past the 14-minute kill at 840 s, so a finished search was killed and its state never saved.
        import os
        from src import time_budget
        seen = {}
        hosted_run.run(self.site, 'HR1.r.t', self.folder, search=lambda env: seen.update(env) or 1)
        at = float(seen['JOBADABRA_SEARCH_AT'])
        self.assertLess(abs(time.time() - at), 5)   # the run's own start
        self.addCleanup(time_budget.start, 0)
        with mock.patch.dict(os.environ, {'JOBADABRA_SEARCH_AT': seen['JOBADABRA_SEARCH_AT']}), mock.patch('time.time', return_value=at + 372):
            time_budget.start(600)
            left = time_budget.end() - time.monotonic()
        self.assertLess(left, 600 - 372 + 2)
        self.assertLess(372 + left, 14 * 60)   # the run ends inside the container's limit

    def test_new_matches_are_only_the_ones_the_run_added_best_first(self):
        before = [{'url': 'https://a/1', 'title': 'Old', 'fit': 9}]
        after = before + [{'url': 'https://a/2', 'title': 'Two', 'company': 'C', 'fit': 5, 'reason': 'ok'}, {'url': 'https://a/3', 'title': 'Three', 'fit': 8}]
        self.assertEqual([m['title'] for m in hosted_run.new_matches(before, after)], ['Three', 'Two'])

    def test_the_pushed_config_sits_on_the_engines_own_config_files(self):
        # 17 Oct 2026 (hosted e2e): the folder held only search/profile/cv, and `daily` died on a missing config/preferences.json
        self.assertTrue(hosted_run.pull_config(self.site, 'HR1.r.t', self.folder))
        for name in ('preferences.json', 'meanings_schema.json'):
            self.assertTrue((self.folder / 'config' / name).exists(), name)
        self.assertEqual(json.loads((self.folder / 'config' / 'search.json').read_text()), {'role_keywords': ['sre']})

    def test_state_round_trips_and_the_token_is_the_only_credential(self):
        FakeWorker.state = tar_of({'data/jobs.sqlite': 'x'})
        self.assertTrue(hosted_run.pull_state(self.site, 'HR1.r.t', self.folder))
        self.assertTrue(hosted_run.pull_config(self.site, 'HR1.r.t', self.folder))
        self.assertEqual(json.loads((self.folder / 'config' / 'search.json').read_text()), {'role_keywords': ['sre']})
        self.assertEqual((self.folder / 'config' / 'profile.md').read_text(), 'P')
        (self.folder / 'data').mkdir(exist_ok=True)
        (self.folder / 'data' / 'new.txt').write_text('later')
        hosted_run.push_state(self.site, 'HR1.r.t', self.folder)
        names = tarfile.open(fileobj=io.BytesIO(FakeWorker.state), mode='r:gz').getnames()
        self.assertIn('data/new.txt', names)
        self.assertEqual(set(FakeWorker.seen_auth), {'Bearer HR1.r.t'})

    def test_a_good_run_posts_its_new_matches_and_pushes_state(self):
        FakeWorker.state = tar_of({'data/x': '1'})
        lists = [[{'url': 'https://a/1', 'title': 'Old', 'fit': 1}], [{'url': 'https://a/1', 'title': 'Old', 'fit': 1}, {'url': 'https://a/2', 'title': 'New', 'fit': 7}]]
        with mock.patch.object(hosted_run, 'read_matches', side_effect=lists), mock.patch.object(hosted_run, 'read_postings', return_value={'https://a/2': {'description': 'Text'}}) as read:
            body = hosted_run.run(self.site, 'HR1.r.t', self.folder, search=lambda env: 0)
        self.assertEqual(read.call_args.args[1], ['https://a/2'])   # only the new jobs' postings are read
        self.assertEqual(body['matches'][0]['description'], 'Text')
        self.assertEqual(body['status'], 'ok')
        self.assertEqual(FakeWorker.posted, [body])
        self.assertEqual([m['title'] for m in body['matches']], ['New'])

    def test_a_failed_search_or_missing_state_posts_failed_and_keeps_old_state(self):
        old = FakeWorker.state = tar_of({'data/x': '1'})
        with mock.patch.object(hosted_run, 'read_matches', return_value=[]):
            body = hosted_run.run(self.site, 'HR1.r.t', self.folder, search=lambda env: 3)
        self.assertEqual((body['status'], FakeWorker.state), ('failed', old))
        FakeWorker.config = None   # no config pushed yet: nothing to search for
        body = hosted_run.run(self.site, 'HR1.r.t', Path(tempfile.mkdtemp()), search=lambda env: 0)
        self.assertEqual(body['status'], 'failed')

    def test_the_sqlite_store_is_read_back_in_a_fresh_process(self):
        env = hosted_run.environment(self.folder, self.site, 'HR1.r.t')
        (self.folder / 'config').mkdir(); (self.folder / 'data').mkdir()
        code = ('from src import store_access; s = store_access.open_run(); '
                's.matches.upsert({"url": "https://a/9", "title": "Nine", "company": "Co", "fit": 6, "status": "Open"})')
        import subprocess, sys
        subprocess.run([sys.executable, '-c', code], env=env, check=True, capture_output=True)
        self.assertEqual([m['title'] for m in hosted_run.read_matches(env)], ['Nine'])

    def test_merge_adds_new_matches_to_the_local_store_once(self):
        import os, shutil, subprocess, sys
        shutil.copytree(hosted_run.DEFAULT_CONFIG, self.folder / 'config'); (self.folder / 'data').mkdir()   # an install's config: merge writes its jobs file too
        inbox = self.folder / 'inbox.json'
        inbox.write_text(json.dumps([{'url': 'https://a/1', 'title': 'One', 'company': 'Co', 'fit': 7, 'line': 'good'}, {'url': '', 'title': 'no url'}]))
        env = {**os.environ, 'JOBADABRA_STORE': 'sqlite', 'JOBADABRA_DISABLE': 'notion', 'JOBADABRA_CONFIG_DIR': str(self.folder / 'config'), 'JOBADABRA_DATA_DIR': str(self.folder / 'data')}
        run = lambda: subprocess.run([sys.executable, '-m', 'src', 'hosted', '--merge', str(inbox)], env=env, capture_output=True, text=True, check=True).stdout
        self.assertIn('1 new matches added', run())
        self.assertIn('0 new matches added', run())   # the second time the job is already there
        self.assertEqual([m['title'] for m in hosted_run.read_matches(env)], ['One'])
        # the run card: one row of this Mac's run history for the one time something arrived, on our servers, in Always on's words
        code = 'import json; from src import store_access; print(json.dumps(store_access.open_run().cron_runs.list(), default=str))'
        rows = json.loads(subprocess.run([sys.executable, '-c', code], env=env, capture_output=True, text=True, check=True).stdout.strip().splitlines()[-1])
        self.assertEqual([(r['kind'], r['where'], r['trigger'], r['summary']) for r in rows], [('scheduled', 'cloud', 'Always on', '1 new job while you were away')])
        self.assertIn('Always on', rows[0]['title'])
        self.assertIn('New job: One | Co | https://a/1 | 7', rows[0]['log'].split('\n'))   # the run card's item, with its fit (renderer/new-jobs-card.js)

    def test_a_cloud_found_job_reaches_the_macs_drawer_with_its_posting_and_facts(self):
        # Why (owner, 14 Nov 2026: "Test the entire flow of a linkedin found job"; asked via AskUserQuestion: "Yes, both PRs (Recommended)"): a job Always on found
        # opened on the Mac with "This job has no saved description" and every fact "Not stated": merge() kept url, title, company, fit and reason only.
        import os, subprocess, sys
        cloud, mac = Path(tempfile.mkdtemp()), Path(tempfile.mkdtemp())
        import shutil
        for folder in (cloud, mac):
            shutil.copytree(hosted_run.DEFAULT_CONFIG, folder / 'config'); (folder / 'data').mkdir()   # src/store.py reads search.json at import, as on every install
        env = hosted_run.environment(cloud, self.site, 'HR1.r.t')
        url = 'https://www.linkedin.com/jobs/view/4487459339/'
        code = ('from src import store, store_access; from src.paths import JOBS_DB; '
                f's = store_access.open_run(); s.matches.upsert({{"url": "{url}", "title": "First Officer", "company": "ACM", "fit": 40, "status": "Open", '
                '"location": "Rheinmünster, Germany", "work_mode": "On-site", "seniority": "Mid", "contract": "Permanent", "languages": ["English", "German +"], '
                '"posted": "2026-11-12", "apply_route": "LinkedIn Easy Apply"}); db = store.connect(JOBS_DB); '
                f'job, _ = store.upsert_job(db, {{"url": "{url}", "title": "First Officer", "company": "ACM", "location": "Rheinmünster, Germany", '
                '"description": "Fly the Global 7500.", "date_posted": "2026-11-12"}, "LinkedIn", "", "job board"); '
                'db.execute("UPDATE jobs SET apply_route=? WHERE id=?", ("linkedin", job)); db.commit()')
        subprocess.run([sys.executable, '-c', code], env=env, check=True, capture_output=True)
        after = hosted_run.read_matches(env)
        sent = hosted_run.new_matches([], after, hosted_run.read_postings(env, [m['url'] for m in after]))
        inbox = mac / 'inbox.json'
        inbox.write_text(json.dumps(sent))
        menv = {**os.environ, 'JOBADABRA_STORE': 'sqlite', 'JOBADABRA_DISABLE': 'notion', 'JOBADABRA_CONFIG_DIR': str(mac / 'config'), 'JOBADABRA_DATA_DIR': str(mac / 'data')}
        subprocess.run([sys.executable, '-m', 'src', 'hosted', '--merge', str(inbox)], env=menv, capture_output=True, text=True, check=True)
        read = ('import json; from src import store, store_access, desktop_jobs; from src.paths import JOBS_DB; from src.notion.client import job_code; '
                f'm = store_access.open_run().matches.get("{url}"); p = desktop_jobs.posting(store.connect(JOBS_DB), job_code("{url}")); '
                'print(json.dumps({"match": m, "posting": p}, default=str))')
        got = json.loads(subprocess.run([sys.executable, '-c', read], env=menv, capture_output=True, text=True, check=True).stdout.strip().splitlines()[-1])
        self.assertEqual({k: got['match'].get(k) for k in ('location', 'work_mode', 'seniority', 'contract', 'posted', 'apply_route')},
                         {'location': 'Rheinmünster, Germany', 'work_mode': 'On-site', 'seniority': 'Mid', 'contract': 'Permanent', 'posted': '2026-11-12',
                          'apply_route': 'LinkedIn Easy Apply'})
        self.assertEqual(got['match'].get('languages'), ['English', 'German +'])
        self.assertTrue(got['posting']['ok'], got['posting'])
        self.assertEqual({k: got['posting'][k] for k in ('description', 'location', 'posted_at', 'source', 'source_kind')},
                         {'description': 'Fly the Global 7500.', 'location': 'Rheinmünster, Germany', 'posted_at': '2026-11-12', 'source': 'LinkedIn', 'source_kind': 'job board'})

    def test_the_server_runs_one_run_per_post_and_refuses_a_bad_token(self):
        import urllib.request
        from http.server import HTTPServer
        calls = []
        patcher = mock.patch.object(hosted_run, 'run', side_effect=lambda site, token, folder: calls.append((site, token)) or {'status': 'ok', 'matches': [1, 2]})
        patcher.start(); self.addCleanup(patcher.stop)
        with mock.patch('http.server.ThreadingHTTPServer', lambda addr, handler: HTTPServer(('127.0.0.1', 0), handler)), \
                mock.patch.object(HTTPServer, 'serve_forever', lambda server: setattr(self, 'handler', server.RequestHandlerClass)):
            hosted_run.serve()
        server = HTTPServer(('127.0.0.1', 0), self.handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        post = lambda body: urllib.request.Request(f'http://127.0.0.1:{server.server_port}/run', data=json.dumps(body).encode(), method='POST')
        with urllib.request.urlopen(post({'site': 'https://s.test', 'token': 'HR1.r.t'})) as reply:
            self.assertEqual(json.loads(reply.read()), {'ok': True, 'status': 'ok', 'matches': 2})
        with self.assertRaises(urllib.error.HTTPError) as bad:
            urllib.request.urlopen(post({'site': 'https://s.test', 'token': 'JPF1.x.y'}))
        self.assertEqual(bad.exception.code, 400)
        self.assertEqual(calls, [('https://s.test', 'HR1.r.t')])
        server.shutdown(); server.server_close()


    def test_a_crashed_run_answers_500_with_what_crashed_and_never_the_token(self):
        # Why (5 Nov 2026, hr 6/6 try 3): the Worker saw "500" after 1.7 s and nothing else; the reason was only in the container's stderr, which nobody reads.
        import urllib.request
        from http.server import HTTPServer
        boom = mock.patch.object(hosted_run, 'run', side_effect=urllib.error.URLError('Temporary failure in name resolution HR1.r.secret'))
        boom.start(); self.addCleanup(boom.stop)
        with mock.patch('http.server.ThreadingHTTPServer', lambda addr, handler: HTTPServer(('127.0.0.1', 0), handler)), \
                mock.patch.object(HTTPServer, 'serve_forever', lambda server: setattr(self, 'handler', server.RequestHandlerClass)):
            hosted_run.serve()
        server = HTTPServer(('127.0.0.1', 0), self.handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        request = urllib.request.Request(f'http://127.0.0.1:{server.server_port}/run', data=json.dumps({'site': 'https://s.test', 'token': 'HR1.r.secret'}).encode(), method='POST')
        with self.assertRaises(urllib.error.HTTPError) as crashed:
            urllib.request.urlopen(request)
        body = json.loads(crashed.exception.read())
        self.assertEqual(crashed.exception.code, 500)
        self.assertFalse(body['ok'])
        self.assertIn('URLError', body['error'])
        self.assertIn('name resolution', body['error'])
        self.assertNotIn('HR1.', body['error'])   # the run token is the only credential: never in an answer
        self.assertLessEqual(len(body['error']), 300)
        self.assertEqual(len(body['build']), 12)   # the crash answer names the code that crashed
        server.shutdown(); server.server_close()

    def test_the_build_is_a_hash_of_every_python_file_of_the_engine_not_of_one_file(self):
        # Why (5 Nov 2026, review of the stamp): run() calls into src.*; a stamp of hosted_run.py alone would not change when only another module did.
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'sources').mkdir()
            (root / 'hosted_run.py').write_text('a = 1\n'); (root / 'sources' / 'feeds.py').write_text('b = 1\n')
            from src.build_stamp import build_of
            first = build_of(root)
            self.assertEqual(first, build_of(root))   # stable
            (root / 'sources' / 'feeds.py').write_text('b = 2\n')
            self.assertNotEqual(first, build_of(root))   # a change in another module moves it
            (root / 'sources' / 'feeds.py').write_text('b = 1\n'); (root / 'new.py').write_text('')
            self.assertNotEqual(first, build_of(root))   # so does a new file
            self.assertEqual(len(first), 12)

    def test_get_root_says_which_code_is_running_and_since_when(self):
        # Why (5 Nov 2026, hr 6/6 try 4): the new image was on the instance by digest, yet the 500 had the OLD body; nothing said which code answered. An old process shows an old `started` or no `build` at all.
        import urllib.request
        from http.server import HTTPServer
        with mock.patch('http.server.ThreadingHTTPServer', lambda addr, handler: HTTPServer(('127.0.0.1', 0), handler)), \
                mock.patch.object(HTTPServer, 'serve_forever', lambda server: setattr(self, 'handler', server.RequestHandlerClass)):
            hosted_run.serve()
        server = HTTPServer(('127.0.0.1', 0), self.handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        with urllib.request.urlopen(f'http://127.0.0.1:{server.server_port}/') as reply:
            body = json.loads(reply.read())
        self.assertTrue(body['ok'])
        self.assertEqual(body['build'], hosted_run.BUILD)
        self.assertRegex(body['build'], r'^[0-9a-f]{12}$')
        self.assertRegex(body['started'], r'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$')
        self.assertIs(body['busy'], False)   # the runner never restarts a container that is busy with a run (review of the stamp check)
        server.shutdown(); server.server_close()

    def test_a_stop_signal_ends_the_server_so_a_deploy_replaces_it(self):
        # Why (5 Nov 2026, hr 6/6 try 6): the server is PID 1 in the container; Linux does not deliver a default SIGTERM to PID 1, so ten
        # "signalling container to stop" over 20 min were ignored and the 01:33 process kept answering with old code after the v5 rollout.
        import signal
        from http.server import HTTPServer
        real_forever, handlers, ended = HTTPServer.serve_forever, {}, []

        def forever(server, *args, **kwargs):
            handlers[signal.SIGTERM](signal.SIGTERM, None)   # Cloudflare's stop arrives while the server runs
            real_forever(server, poll_interval=0.05)
            ended.append(True)

        with mock.patch('signal.signal', side_effect=lambda sig, handler: handlers.__setitem__(sig, handler)), \
                mock.patch('http.server.ThreadingHTTPServer', lambda addr, handler: HTTPServer(('127.0.0.1', 0), handler)), \
                mock.patch.object(HTTPServer, 'serve_forever', autospec=True, side_effect=forever):
            hosted_run.serve()
        self.assertEqual(ended, [True])   # serve() returned: the process exits and the next start runs the new image

    def test_the_deploy_computes_the_same_stamp_as_the_container_without_loading_the_engine(self):
        # Why (5 Nov 2026, hr 6/6 try 6, owner: "Each run checks"): the deploy passes the expected stamp to the runner; it runs this file as a plain
        # script (src/__init__ loads .env and registers an exit hook), so it must print exactly what the container's GET / says.
        import subprocess, sys
        root = Path(hosted_run.__file__).resolve().parent
        printed = subprocess.run([sys.executable, '-P', str(root / 'build_stamp.py'), str(root)], capture_output=True, text=True, check=True, cwd=root.parent).stdout.strip()
        self.assertEqual(printed, hosted_run.BUILD)

    def test_a_stop_during_a_run_lets_the_run_finish_and_answer_before_the_process_ends(self):
        # Why (5 Nov 2026, review of the SIGTERM fix): handler threads are daemons, so ending serve_forever mid-run cut a search (up to 14 min) after its
        # AI was already paid; a rollout's stop must let it post its result. No run in progress: serve() returns at once.
        import signal, urllib.request
        from http.server import ThreadingHTTPServer
        handlers, servers, started, release, answers, returned = {}, [], threading.Event(), threading.Event(), [], threading.Event()

        def slow_run(site, token, folder):
            started.set(); release.wait(10)
            return {'status': 'ok', 'matches': [1]}

        def make(addr, handler):
            servers.append(ThreadingHTTPServer(('127.0.0.1', 0), handler)); return servers[0]

        def post():
            request = urllib.request.Request(f'http://127.0.0.1:{servers[0].server_port}/run', data=json.dumps({'site': 'https://s.test', 'token': 'HR1.r.t'}).encode(), method='POST')
            with urllib.request.urlopen(request, timeout=10) as reply:
                answers.append(json.loads(reply.read()))

        with mock.patch.object(hosted_run, 'run', side_effect=slow_run), mock.patch('signal.signal', side_effect=lambda sig, h: handlers.__setitem__(sig, h)), \
                mock.patch('http.server.ThreadingHTTPServer', make):
            serving = threading.Thread(target=lambda: (hosted_run.serve(), returned.set()), daemon=True)
            serving.start()
            while not servers or signal.SIGTERM not in handlers:
                time.sleep(0.01)
            client = threading.Thread(target=post, daemon=True); client.start()
            self.assertTrue(started.wait(5))
            handlers[signal.SIGTERM](signal.SIGTERM, None)   # Cloudflare's stop arrives mid-run
            self.assertFalse(returned.wait(0.5))             # the process does not end under the run
            release.set()
            self.assertTrue(returned.wait(5))
            client.join(5)
        self.assertEqual(answers, [{'ok': True, 'status': 'ok', 'matches': 1}])   # the run finished and answered the Worker

    def test_a_stop_before_an_accepted_call_reaches_its_run_still_answers_that_call(self):
        # Why (5 Nov 2026, Gitar on jobadabra#3222): the drain waited on the run lock, so a POST accepted but still reading its body was not seen:
        # the process ended under it and the Worker got a dropped connection. Every accepted call is answered before the process ends.
        import signal, socket
        from http.server import ThreadingHTTPServer
        handlers, servers, accepted, returned = {}, [], threading.Event(), threading.Event()

        class Watched(ThreadingHTTPServer):
            def process_request(self, request, client_address):
                super().process_request(request, client_address); accepted.set()

        def make(addr, handler):
            servers.append(Watched(('127.0.0.1', 0), handler)); return servers[0]

        body = json.dumps({'site': 'https://s.test', 'token': 'HR1.r.t'}).encode()
        with mock.patch.object(hosted_run, 'run', return_value={'status': 'ok', 'matches': [1, 2]}), \
                mock.patch('signal.signal', side_effect=lambda sig, h: handlers.__setitem__(sig, h)), mock.patch('http.server.ThreadingHTTPServer', make):
            serving = threading.Thread(target=lambda: (hosted_run.serve(), returned.set()), daemon=True)
            serving.start()
            while not servers or signal.SIGTERM not in handlers:
                time.sleep(0.01)
            with socket.create_connection(('127.0.0.1', servers[0].server_port), timeout=10) as call:
                call.sendall(b'POST /run HTTP/1.0\r\nContent-Type: application/json\r\nContent-Length: %d\r\n\r\n' % len(body))
                self.assertTrue(accepted.wait(5))
                handlers[signal.SIGTERM](signal.SIGTERM, None)   # the stop arrives while the call still reads its body
                self.assertFalse(returned.wait(0.5))
                call.sendall(body)
                answer = b''.join(iter(lambda: call.recv(4096), b''))
            self.assertTrue(returned.wait(5))
        self.assertIn(b'200 OK', answer.split(b'\r\n')[0])
        self.assertEqual(json.loads(answer.split(b'\r\n\r\n', 1)[1]), {'ok': True, 'status': 'ok', 'matches': 2})


if __name__ == '__main__':
    unittest.main()
