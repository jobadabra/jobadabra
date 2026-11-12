"""Job boards that refuse the plain reader are read in Jobadabra's own headless Chrome during a Find jobs press (owner, 12 Nov 2026: "Yes, as boards (Recommended)",
"Boards now, employers next (Recommended)", "5 boards, each once a day (Recommended)"): the press's queue lists boards only, never a login-wall site, at most 5 reads a
day; a board that opened is read again the next day; the browser's 'login' or 'refused' verdict is a stop; the button's queue keeps employer sites only."""
import json
import tempfile
import unittest
from datetime import timedelta, datetime, timezone
from pathlib import Path
from unittest import mock

from src.sources import host_pace, refused_reads, visits

NOW = datetime(2026, 11, 12, 9, 0, tzinfo=timezone.utc)
SEARCH = {'role_keywords': ['nurse'], 'locations': {'top_tier': ['Exampletown'], 'country_wide': []}}
BOARD_HOSTS = [f'board{n}.example.net' for n in range(1, 8)]
BOARDS = {'boards': {
    **{host: {'name': f'Board {n}', 'search_url': f'https://{host}/jobs?q={{role}}&where={{place}}', 'state': 'browser'} for n, host in enumerate(BOARD_HOSTS, 1)},
    'open.example.org': {'name': 'Open board', 'search_url': 'https://open.example.org/jobs?q={role}', 'state': 'ok'},
    'indeed.com': {'name': 'Indeed', 'search_url': 'https://www.indeed.com/jobs?q={role}', 'state': 'browser'}}}


def _posting(n):
    return json.dumps({'@context': 'https://schema.org', '@type': 'JobPosting', 'title': f'Nurse {n}', 'url': f'https://board1.example.net/job/{n}',
                       'jobLocation': {'@type': 'Place', 'address': {'addressLocality': 'Exampletown', 'addressCountry': 'CH'}}, 'hiringOrganization': {'@type': 'Organization', 'name': 'Example clinic'}})


JOBS = '<html><title>Jobs</title><body>' + ''.join(f'<script type="application/ld+json">{_posting(n)}</script>' for n in range(1, 4)) + '</body></html>'


def hosts(items):
    return {item['url'].split('/')[2] for item in items}


class HeadlessBoardsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.patches = [mock.patch.object(visits, 'STORE', Path(self.tmp.name) / 'visits.json'),
                        mock.patch('src.ai.board_ideas.load', lambda: json.loads(json.dumps(BOARDS))),
                        mock.patch.object(refused_reads, 'search_config', lambda: SEARCH),
                        mock.patch.object(visits, 'relevant', lambda items, *a, **k: items),   # the AI's fit judge: every board fits this search
                        mock.patch.object(host_pace, 'FILE', Path(self.tmp.name) / 'host_pace.json')]
        for patch in self.patches:
            patch.start()
        host_pace.reset()
        visits.refused('Example employer', 'https://careers.example.com', 'HTTP 403', now=NOW)

    def tearDown(self):
        for patch in self.patches:
            patch.stop()
        host_pace.reset()
        self.tmp.cleanup()

    def test_the_press_queue_lists_refused_boards_only_and_never_a_login_wall_board(self):
        listed = refused_reads.board_queue(now=NOW)
        self.assertTrue(listed and all(item['kind'] == 'board' for item in listed))
        self.assertNotIn('careers.example.com', hosts(listed), 'employer sites stay with the button until PR 2')
        self.assertNotIn('open.example.org', hosts(listed), 'a board the plain reader reads is not a browser read')
        self.assertFalse(any('indeed' in host for host in hosts(listed)))

    def test_the_buttons_queue_keeps_employer_sites_only(self):
        self.assertEqual(hosts(refused_reads.queue(now=NOW, kinds=('employer',))), {'careers.example.com'})

    def test_at_most_five_headless_reads_a_day_spent_before_each_page_loads(self):
        self.assertEqual(len(refused_reads.board_queue(now=NOW)), refused_reads.DAY_SITES)
        for host in BOARD_HOSTS[:5]:   # five reads started; the app never brought an answer for any (killed, the engine call lost)
            self.assertTrue(refused_reads.headless_begin(f'https://{host}/jobs', now=NOW))
        self.assertFalse(refused_reads.headless_begin(f'https://{BOARD_HOSTS[5]}/jobs', now=NOW), "today's five are spent, whatever the queue said")
        self.assertEqual(refused_reads.board_queue(now=NOW + timedelta(hours=2)), [], 'and the queue says so')
        self.assertNotIn(BOARD_HOSTS[0], hosts(refused_reads.board_queue(now=NOW + timedelta(hours=23))), 'a started read is not repeated the same day')
        tomorrow = hosts(refused_reads.board_queue(now=NOW + timedelta(days=1, minutes=1)))
        self.assertIn(BOARD_HOSTS[0], tomorrow, 'a read that never finished is asked again the next day')
        self.assertFalse(refused_reads.headless_begin('https://www.indeed.com/jobs', now=NOW + timedelta(days=2)), 'never a login-wall site')

    def test_a_captcha_board_is_offered_on_the_visit_list_for_the_person_to_open(self):
        refused_reads.headless_begin(f'https://{BOARD_HOSTS[0]}/jobs', now=NOW)
        answer = refused_reads.outcome(f'https://{BOARD_HOSTS[0]}/jobs', 200, '<html>check</html>', now=NOW, step=refused_reads.HEADLESS, judged='captcha')
        self.assertEqual((answer['state'], answer.get('needs_check')), ('stopped', True))
        self.assertIn(BOARD_HOSTS[0], {visits.host_of(item['url']) for item in visits.visit_list(SEARCH, now=NOW)}, 'listed with the sites only you can open')

    def test_a_board_that_opened_is_read_again_the_next_day_one_that_stopped_is_never_asked_again(self):
        """sa for the owner, 12 Nov 2026, "final stop": a 401/403, a check or captcha, a sign-in page ends the headless reads of that board for good;
        a 429 is "slow down", not a refusal: back the next day."""
        due = lambda days: hosts(refused_reads.queue(now=NOW + timedelta(days=days), kinds=('board',)))   # what is due, past the day's share of 5
        url = lambda n: f'https://{BOARD_HOSTS[n]}/jobs'
        refused_reads.outcome(url(0), 200, JOBS, now=NOW, step=refused_reads.HEADLESS)
        stops = {1: refused_reads.outcome(url(1), 401, '', now=NOW, step=refused_reads.HEADLESS),
                 2: refused_reads.outcome(url(2), 403, '', now=NOW, step=refused_reads.HEADLESS),
                 3: refused_reads.outcome(url(3), 200, '<html>check</html>', now=NOW, step=refused_reads.HEADLESS, judged='captcha'),
                 4: refused_reads.outcome(url(4), 200, JOBS, now=NOW, step=refused_reads.HEADLESS, judged='login'),
                 5: refused_reads.outcome(url(5), 200, JOBS, now=NOW, step=refused_reads.HEADLESS, judged='passive_check')}
        slow = refused_reads.outcome(url(6), 429, '', now=NOW, step=refused_reads.HEADLESS)
        self.assertEqual({n: (answer['state'], answer['final']) for n, answer in stops.items()}, {n: ('stopped', True) for n in stops})
        self.assertEqual((slow['state'], slow.get('final')), ('waiting', None), 'a 429 is no refusal')
        self.assertEqual(due(1.01) & set(BOARD_HOSTS), {BOARD_HOSTS[0], BOARD_HOSTS[6]}, 'the opened board and the 429 one come back the next day')
        for days in (31, 365):
            self.assertFalse(due(days) & {BOARD_HOSTS[n] for n in stops}, f'{days} days on: a stopped board is never asked again')
        refused_reads.outcome(url(0), 403, '', now=NOW, step='download')   # the employer button's steps keep their 30 days
        self.assertFalse(refused_reads.final(visits._load()['refused_reads'][BOARD_HOSTS[0]]))

    def test_the_browsers_login_refused_or_lasting_check_verdict_is_a_stop_and_nothing_is_read(self):
        for judged, why in [('login', 'a login page'), ('refused', 'refused in the browser'), ('passive_check', 'a bot check')]:
            with self.subTest(judged=judged):
                answer = refused_reads.outcome(f'https://{BOARD_HOSTS[2]}/jobs', 200, JOBS, now=NOW, step=refused_reads.HEADLESS, judged=judged)
                self.assertEqual((answer['state'], answer['why']), ('stopped', why))

    def test_a_headless_read_is_kept_with_its_step_but_the_shared_step_stays_the_ladders(self):
        refused_reads.outcome(f'https://{BOARD_HOSTS[0]}/jobs', 200, JOBS, now=NOW, step=refused_reads.HEADLESS)
        self.assertEqual(visits._load()['refused_reads'][BOARD_HOSTS[0]]['step'], 'headless')
        shared = next(row for row in refused_reads.shared() if row['host'] == BOARD_HOSTS[0])
        self.assertEqual(shared['read']['outcome'], 'opened')
        self.assertNotIn('step', shared['read'], "the pool's step list is the ladder's; the site's validator knows no other")


if __name__ == '__main__':
    unittest.main()
