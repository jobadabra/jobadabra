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

    def test_at_most_five_headless_reads_a_day_whatever_they_brought(self):
        self.assertEqual(len(refused_reads.board_queue(now=NOW)), refused_reads.DAY_SITES)
        answers = [(200, JOBS), (403, ''), (429, ''), (0, ''), (200, '<html>Please verify you are human</html>')]
        for host, (status, html) in zip(BOARD_HOSTS, answers):
            refused_reads.outcome(f'https://{host}/jobs', status, html, now=NOW, step=refused_reads.HEADLESS)
        self.assertEqual(refused_reads.board_queue(now=NOW + timedelta(hours=2)), [], "today's five are spent")
        self.assertEqual(hosts(refused_reads.board_queue(now=NOW + timedelta(days=1))) & set(BOARD_HOSTS[5:]), set(BOARD_HOSTS[5:]), 'a new day, a new share')

    def test_a_board_that_opened_is_read_again_the_next_day_one_that_stopped_rests_thirty(self):
        refused_reads.outcome(f'https://{BOARD_HOSTS[0]}/jobs', 200, JOBS, now=NOW, step=refused_reads.HEADLESS)
        refused_reads.outcome(f'https://{BOARD_HOSTS[1]}/jobs', 403, '', now=NOW, step=refused_reads.HEADLESS)
        tomorrow = hosts(refused_reads.board_queue(now=NOW + timedelta(days=1, minutes=1)))
        self.assertIn(BOARD_HOSTS[0], tomorrow)
        self.assertNotIn(BOARD_HOSTS[1], tomorrow)
        self.assertNotIn(BOARD_HOSTS[1], hosts(refused_reads.board_queue(now=NOW + timedelta(days=29))))
        self.assertIn(BOARD_HOSTS[1], hosts(refused_reads.board_queue(now=NOW + timedelta(days=31))))

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
