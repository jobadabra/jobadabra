"""Every engine call to our site names Jobadabra as its client: Cloudflare's edge refuses urllib's own `Python-urllib/3.x` with 403 "error code: 1010"
on www.jobadabra.top and on staging, before our Worker sees the call (5 Nov 2026, hr 6/6 try 5: the hosted run answered `HTTPError: HTTP Error 403`;
curl got the Worker's 401). The header is set at each call, as src/service.py and src/contribute.py do: `python -m src.notify` and the modules the app
spawns directly never pass through `python -m src`, so a process-wide default would miss them."""
import http.server
import threading
import unittest

from src import hosted_run, notify, trial
from src.sources import ats


class Seen(http.server.BaseHTTPRequestHandler):
    calls = []

    def log_message(self, *args):
        pass

    def answer(self):
        if self.headers.get('Content-Length'):
            self.rfile.read(int(self.headers['Content-Length']))
        Seen.calls.append((self.path.split('?')[0], self.headers.get('User-Agent')))
        self.send_response(200); self.send_header('Content-Type', 'application/json'); self.end_headers(); self.wfile.write(b'{"ok": true}')

    do_GET = do_POST = answer


class UserAgentTest(unittest.TestCase):
    def setUp(self):
        Seen.calls = []
        self.server = http.server.HTTPServer(('127.0.0.1', 0), Seen)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.site = f'http://127.0.0.1:{self.server.server_port}'
        self.addCleanup(lambda: (self.server.shutdown(), self.server.server_close()))

    def test_every_engine_call_to_our_site_arrives_as_jobadabra_not_as_python_urllib(self):
        env = {'JOBADABRA_TRIAL_KEY': 'JPF1.i.k', 'JOBADABRA_SITE_URL': self.site}
        calls = {
            '/api/hosted/state': lambda: hosted_run._call(f'{self.site}/api/hosted/state', 'HR1.r.t'),   # the hosted run (state, config, result)
            '/api/trial/status': lambda: trial.status(1, env=env),
            '/api/notify/email': lambda: notify._post([('<p>hi</p>', None)], env=env),   # also `python -m src.notify`, the failed-run notice
        }
        for path, call in calls.items():
            with self.subTest(path):
                Seen.calls = []
                call()
                self.assertEqual(Seen.calls, [(path, ats.USER_AGENT)])


if __name__ == '__main__':
    unittest.main()
