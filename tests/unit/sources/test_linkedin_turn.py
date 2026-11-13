"""The Always on LinkedIn trial on the engine's side (src/sources/linkedin_turn.py, linkedin_guest._get): in a cloud run no LinkedIn GET starts without the site's "go", a "no" or a silent
site ends LinkedIn for the run, a cached page is used with no GET, and every GET's answer goes back to the site. Owner, 13 Nov 2026: "Both ways"; the site is the one gate."""
import http.client
import io
import json
import tempfile
import unittest
import urllib.error
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

from src import hosted_run, time_budget
from src.sources import host_pace, linkedin_guest, linkedin_turn, page_bytes, read_budget
from tests.unit.sources.test_linkedin_guest import CARDS, Site

URL = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=sre&location=Geneva&start=0'
CLOUD = {linkedin_turn.TURN: 'https://site.example', 'JOBADABRA_RUN_TOKEN': 'HR1.run.mac'}


class FakeSite:
    """Stand-in for our site: `answers` is the list of turn answers given in order; every call is kept as (path, body, headers)."""

    def __init__(self, answers):
        self.answers, self.calls = list(answers), []

    def open(self, request, timeout=None):
        path = request.full_url.rsplit('/', 1)[1]
        self.calls.append((path, json.loads(request.data), dict(request.header_items())))
        if path == 'answer':
            if getattr(self, 'answer_error', None):
                raise self.answer_error
            return io.BytesIO(b'{"ok": true}')
        got = self.answers.pop(0)
        if isinstance(got, Exception):
            raise got
        return io.BytesIO(json.dumps(got).encode())


class TurnTest(unittest.TestCase):
    def setUp(self):
        linkedin_guest.reset()
        self.addCleanup(linkedin_guest.reset)
        self.clock, self.sleeps, self.dir = [1000.0], [], tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        host_pace.reset()
        self.addCleanup(host_pace.reset)

        def sleep(seconds):
            self.sleeps.append(seconds)
            self.clock[0] += seconds
        for patch in (mock.patch.object(time_budget, 'now', side_effect=lambda: self.clock[0]),
                      mock.patch.object(time_budget, 'wall', side_effect=lambda: datetime.fromtimestamp(self.clock[0], timezone.utc)),
                      mock.patch.object(linkedin_guest, 'FILE', Path(self.dir.name) / 'linkedin_guest.json'),
                      mock.patch.object(linkedin_guest, '_sleep', side_effect=sleep),
                      mock.patch.object(linkedin_turn, '_sleep', side_effect=sleep),
                      mock.patch.object(read_budget, 'cut_at', return_value=None),
                      mock.patch.object(host_pace, 'FILE', Path(self.dir.name) / 'host_pace.json'),
                      mock.patch.dict('os.environ', CLOUD),
                      mock.patch('builtins.print')):
            patch.start()
            self.addCleanup(patch.stop)

    def run_with(self, answers, linkedin=lambda url: CARDS):
        site, linkedin_site = FakeSite(answers), Site(linkedin, self.clock)
        self.last_site = site
        with mock.patch.object(linkedin_turn, '_open', site.open), mock.patch.object(linkedin_guest, '_opener', linkedin_site):
            try:
                got = linkedin_guest._get(URL)
            except linkedin_guest.Later as later:
                got = later
        return got, site, linkedin_site

    def test_no_or_a_silent_site_sends_nothing_to_linkedin_and_ends_the_run(self):
        for answers in ([{'answer': 'no', 'why': 'LinkedIn in Always on is a trial on one install for now'}], [urllib.error.URLError('down')], [{'ok': False, 'error': 'unauthorized'}]):
            linkedin_guest.reset()
            got, site, linkedin = self.run_with(answers)
            self.assertIsInstance(got, linkedin_guest.Later, answers)
            self.assertEqual(linkedin.requests, [], 'no GET without the site\'s go')
            self.assertEqual(linkedin_guest.PACE.stopped, 'cloud')
            got, _, linkedin = self.run_with([{'answer': 'go', 'lease': 'lt_1'}])
            self.assertIsInstance(got, linkedin_guest.Later, 'stopped for the rest of the run, the site is not asked again')
            self.assertEqual(linkedin.requests, [])

    def test_a_cached_page_is_used_without_a_get_or_a_window_slot(self):
        got, site, linkedin = self.run_with([{'answer': 'cached', 'body': CARDS}])
        self.assertEqual(got, (URL, CARDS))
        self.assertEqual(linkedin.requests, [])
        self.assertEqual(linkedin_guest.left(), linkedin_guest.WINDOW_MAX)

    def test_go_sends_one_get_and_tells_the_site_its_answer_with_the_run_token(self):
        got, site, linkedin = self.run_with([{'answer': 'go', 'lease': 'lt_1'}])
        self.assertEqual(got[1], CARDS)
        self.assertEqual(len(linkedin.requests), 1)
        self.assertEqual([call[0] for call in site.calls], ['turn', 'answer'])
        self.assertEqual(site.calls[1][1], {'lease': 'lt_1', 'status': 200, 'word': 'page', 'body': CARDS})
        self.assertEqual(site.calls[0][2].get('Authorization'), 'Bearer HR1.run.mac')
        self.assertNotIn('Cookie', linkedin.requests[0].headers)

    def test_a_429_is_told_to_the_site_and_stops_the_run(self):
        got, site, linkedin = self.run_with([{'answer': 'go', 'lease': 'lt_1'}], linkedin=lambda url: 429)
        self.assertIsInstance(got, linkedin_guest.Later)
        self.assertEqual(site.calls[1][1], {'lease': 'lt_1', 'status': 429, 'word': 'refused'})
        self.assertEqual(linkedin_guest.PACE.stopped, 'limited')

    def test_a_sign_in_page_is_told_as_signin_and_never_sent_for_the_cache(self):
        got, site, _ = self.run_with([{'answer': 'go', 'lease': 'lt_1'}], linkedin=lambda url: ('redirect', 'https://www.linkedin.com/authwall?x=1', '<html>sign in</html>'))
        self.assertIsInstance(got, linkedin_guest.Later)
        self.assertEqual(site.calls[1][1], {'lease': 'lt_1', 'status': 200, 'word': 'signin'})

    def test_wait_is_slept_but_never_past_the_read_cut(self):
        _, site, linkedin = self.run_with([{'answer': 'wait', 'seconds': 12}, {'answer': 'go', 'lease': 'lt_2'}])
        self.assertIn(12, self.sleeps)
        self.assertEqual(len(linkedin.requests), 1)
        linkedin_guest.reset()
        with mock.patch.object(read_budget, 'cut_at', return_value=self.clock[0] + 5):
            got, _, linkedin = self.run_with([{'answer': 'wait', 'seconds': 30}])
        self.assertIsInstance(got, linkedin_guest.Later)
        self.assertEqual(linkedin.requests, [])

    def test_a_full_window_or_a_passed_cut_never_takes_a_lease(self):
        # Why (Gitar on #4004): the site's turn comes after this computer's own checks, so no lease is left open for a GET that never happens
        linkedin_guest.FILE.write_text(json.dumps({'sent': [self.clock[0] - 10 - i for i in range(linkedin_guest.WINDOW_MAX)]}))
        got, site, linkedin = self.run_with([{'answer': 'go', 'lease': 'lt_1'}])
        self.assertIsInstance(got, linkedin_guest.Later)
        self.assertEqual((site.calls, linkedin.requests), ([], []))
        linkedin_guest.FILE.write_text(json.dumps({'sent': [self.clock[0] - 5]}))
        with mock.patch.object(read_budget, 'cut_at', return_value=self.clock[0] + 3):   # the gap (20-40 s) would pass the cut
            got, site, linkedin = self.run_with([{'answer': 'go', 'lease': 'lt_1'}])
        self.assertIsInstance(got, linkedin_guest.Later)
        self.assertEqual((site.calls, linkedin.requests), ([], []))

    def test_a_window_filled_after_go_tells_the_lease_unused(self):
        with mock.patch.object(linkedin_guest, '_spend', return_value=False):
            got, site, linkedin = self.run_with([{'answer': 'go', 'lease': 'lt_1'}])
        self.assertIsInstance(got, linkedin_guest.Later)
        self.assertEqual(linkedin.requests, [])
        self.assertEqual(site.calls[1][1], {'lease': 'lt_1', 'status': 0, 'word': 'unused'})

    def test_a_broken_reply_is_told_as_neterror_and_still_raised(self):
        # Why (Gitar on #4004): a read that dies mid-body (not an OSError) still answers the lease, so the site never waits out 90 s on it
        for broken in (http.client.IncompleteRead(b'<li'), UnicodeDecodeError('utf-8', b'\xff', 0, 1, 'bad'), ValueError('bad length')):
            linkedin_guest.reset()
            with mock.patch.object(page_bytes, 'reply', side_effect=broken), self.assertRaises(type(broken)):
                self.run_with([{'answer': 'go', 'lease': 'lt_1'}])
            site = self.last_site
            self.assertEqual(site.calls[-1][1], {'lease': 'lt_1', 'status': 0, 'word': 'neterror'}, type(broken).__name__)

    def test_a_site_reply_cut_mid_body_is_a_no_and_never_hides_a_429_stop(self):
        # Why (Gitar on #4004): the site's own reply can break too; a turn that breaks is a "no", and a tell that breaks never skips the run's stop after a 429
        got, _, linkedin = self.run_with([http.client.IncompleteRead(b'{"ans')])
        self.assertIsInstance(got, linkedin_guest.Later)
        self.assertEqual(linkedin.requests, [])
        linkedin_guest.reset()
        with mock.patch.object(FakeSite, 'answer_error', http.client.IncompleteRead(b''), create=True):
            got, _, _ = self.run_with([{'answer': 'go', 'lease': 'lt_1'}], linkedin=lambda url: 429)
        self.assertIsInstance(got, linkedin_guest.Later)
        self.assertEqual(linkedin_guest.PACE.stopped, 'limited')

    def test_a_github_run_asks_with_its_repo_key(self):
        env = {linkedin_turn.TURN: 'https://site.example', 'JOBADABRA_TRIAL_KEY': 'JPT1.handle.mac'}
        site = FakeSite([{'answer': 'no', 'why': 'x'}])
        with mock.patch.object(linkedin_turn, '_open', site.open):
            self.assertEqual(linkedin_turn.ask(URL, env=env), ('no', 'x'))
        self.assertEqual(site.calls[0][2].get('X-api-key'), 'JPT1.handle.mac')

    def test_a_cloud_run_reads_linkedin_only_with_the_turn_address(self):
        flag = {'JOBADABRA_LINKEDIN_GUEST': '1'}
        self.assertTrue(linkedin_guest.on(flag), 'the desktop app: no cloud, no turn needed')
        for cloud in ({'GITHUB_ACTIONS': 'true'}, {'JOBADABRA_TRIGGER': 'hosted'}):
            self.assertFalse(linkedin_guest.on({**flag, **cloud}), f'{cloud}: the flag alone never reads LinkedIn from shared addresses')
            self.assertTrue(linkedin_guest.on({**flag, **cloud, linkedin_turn.TURN: 'https://site.example'}))

    def test_the_hosted_run_sets_the_turn_beside_the_flag(self):
        env = hosted_run.environment(Path(self.dir.name), 'https://site.example', 'HR1.run.mac', base={})
        self.assertEqual((env['JOBADABRA_LINKEDIN_GUEST'], env[linkedin_turn.TURN], env['JOBADABRA_RUN_TOKEN']), ('1', 'https://site.example', 'HR1.run.mac'))
        self.assertTrue(linkedin_guest.on(env))


if __name__ == '__main__':
    unittest.main()
