"""A proposed job board is checked to be one when its read gave nothing (src/sources/board_check.py; owner's yes 19 Oct 2026, step 1 of
the local-sources sketch: fahrerjobs.de is one haulage company's own site, trucker.jobs has no address). Fake AI only."""
import socket
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

from src.ai import board_ideas
from src.sources import board_check, board_employers, board_yield, careers, found_boards

_READER = careers.READER


def setUpModule():   # no test here reaches a real model through a page read (guard: tests/unit/sources/test_found_boards_ai.py)
    careers.READER = None


def tearDownModule():
    careers.READER = _READER


SEARCH = {'role_keywords': ['Berufskraftfahrer'], 'locations': {'top_tier': ['nürnberg'], 'country_wide': [], 'abroad': []}}
HAULIER = ('<html><head><title>Müller Spedition | Transporte</title><meta name="description" content="Ihr Partner für Megatrailer-Transporte">'
           '</head><body><a href="/leistungen">Leistungsportfolio</a><a href="/frachtanfrage">Frachtanfrage</a>'
           '<a href="/karriere">Offene Stellenangebote</a></body></html>')
TEXT = '<p>' + 'Transporte in ganz Europa, jeden Tag. ' * 30 + '</p>'   # a page with text, not a frame scripts fill (careers._shell)
HAULIER = HAULIER.replace('</body>', TEXT + '</body>')
PORTAL = '<html><head><title>Jobs finden</title></head><body><a href="/s">Jobs suchen</a><a href="/firmen">Arbeitgeber</a></body></html>'


def board(n, host=None):
    host = host or f'b{n}.example'
    return {'name': f'Board {n}', 'host': host, 'search_url': f'https://{host}/jobs?q={{role}}&l={{place}}', 'countries': ['Germany'],
            'kinds': ['any'], 'source_kind': 'sector'}


def http(code):
    return urllib.error.HTTPError('https://x/', code, 'x', {}, None)


class KindTests(unittest.TestCase):
    def setUp(self):
        careers.READER = 'auto'
        self.addCleanup(setattr, careers, 'READER', None)
        self.asked = []

    def ask(self, answer):
        return lambda topic, key, text, answers, instructions: self.asked.append((topic, key, text, answers)) or answer

    def kind(self, fetch, answer='one employer', term=''):
        return board_check.kind(board(1, 'haulier.example'), fetch, term, ask=self.ask(answer))[0]

    def test_no_address_or_no_home_page_is_gone_without_asking_the_ai(self):
        for error in (ValueError('not a public web address'), http(404), http(410), urllib.error.URLError(socket.gaierror(8, 'nodename'))):
            with self.subTest(error=error):
                self.assertEqual(self.kind(mock.Mock(side_effect=error)), 'gone')
        self.assertEqual(self.asked, [])

    def test_a_refusal_or_a_passing_error_is_unknown(self):
        for error in (http(403), http(429), http(503), urllib.error.URLError(TimeoutError('timed out'))):
            with self.subTest(error=error):
                self.assertIsNone(self.kind(mock.Mock(side_effect=error)))

    def test_the_ai_says_what_the_home_page_is_with_a_fixed_answer(self):
        self.assertEqual(self.kind(lambda url: HAULIER), 'one employer')
        topic, key, text, answers = self.asked[0]
        self.assertEqual((topic, key, answers), (board_check.TOPIC, 'haulier.example', board_check.KINDS))
        self.assertIn('Müller Spedition', text)
        self.assertIn('Frachtanfrage', text)
        self.assertEqual(board_check.name_of(HAULIER, 'haulier.example'), 'Müller Spedition')

    def test_the_ai_judges_the_search_page_the_read_opened_not_the_home_page(self):
        # Why (14 Nov 2026, owner via sa): a classifieds site's job section was judged from its home page (cars, flats) as 'other'
        pages = {'https://haulier.example/jobs?q=Fahrer&l=': '<title>Fahrer: 12 Anzeigen</title><header><a>Autos</a><a>Wohnungen</a></header>'
                 '<a>Berufskraftfahrer CE, Nürnberg</a>' + TEXT, 'https://haulier.example/': '<title>Kleinanzeigen</title><a>Autos</a>' + TEXT}
        self.assertEqual(self.kind(pages.get, answer='job board', term='Fahrer'), 'job board')
        front, listing = self.asked[0][2].split("Its list for 'Fahrer':")
        self.assertIn('Kleinanzeigen', front, 'what the site is: its home page')
        self.assertIn('Berufskraftfahrer CE, Nürnberg', listing, 'what it lists: the page the read opened')
        self.assertLess(listing.index('Berufskraftfahrer'), listing.index('Autos'), "the page's own links before the site's menu")

    def test_a_search_page_built_by_scripts_or_a_short_empty_one_gives_no_verdict_and_the_ai_is_not_asked(self):
        # Why (14 Nov 2026, owner via sa, c12 runs A+B): a list built by scripts read 0 jobs, then its home page was judged 'other' for 30 days;
        # Why (#4198, Gitar): a short server-rendered "no results" page is no visit either: no verdict, the read's own state stands
        frame = '<html><head><title>alle jobs</title></head><body><div id="root"></div></body></html>'
        empty = '<html><head><title>Elektriker: 0 Treffer</title></head><body><p>Keine Treffer.</p><a href="/">Start</a></body></html>'
        for page in (frame, empty):
            with self.subTest(page=page[:40]):
                self.assertIsNone(self.kind({'https://haulier.example/jobs?q=Elektriker&l=': page, 'https://haulier.example/': HAULIER}.get,
                                            term='Elektriker'))
        self.assertEqual(self.asked, [])

    def test_a_search_page_that_is_not_there_leaves_the_home_page_alone(self):
        def fetch(url):
            if url != 'https://haulier.example/':
                raise http(404)
            return HAULIER
        self.assertEqual(self.kind(fetch, term='Fahrer'), 'one employer')
        self.assertIn('Müller Spedition', self.asked[0][2])
        self.assertNotIn('Its list for', self.asked[0][2], 'a list page that is not there: the home page alone')

    def test_a_dead_site_is_gone_even_when_its_link_is_a_list_page(self):
        # Why (#4205, Gitar): the list page was judged before the home page, so a dead site stayed in rotation
        def fetch(url):
            raise urllib.error.URLError(socket.gaierror(8, 'nodename'))   # no address: neither page loads
        self.assertEqual(self.kind(fetch, term='Fahrer'), 'gone')
        self.assertEqual(self.asked, [])

    def test_a_list_page_that_loads_behind_a_missing_home_page_is_not_gone(self):
        # Why (#4216, Gitar): a short list page that loaded proves the site is there; two such days would have dropped it
        def fetch(url):
            if url == 'https://haulier.example/':
                raise http(404)
            return '<html><body><p>0 Ergebnisse</p></body></html>'
        self.assertIsNone(self.kind(fetch, term='Fahrer'))
        self.assertEqual(self.asked, [])

    def test_the_list_page_is_asked_in_the_board_s_learned_charset(self):
        # Why (#4216, Gitar): the read asks a cp1251 board in cp1251; the judge must see that same list
        self.assertEqual(board_check.listed({'search_url': 'https://b.example/jobs?q={role}&l={place}', 'charset': 'cp1251'}, 'шофьор'),
                         'https://b.example/jobs?q=%F8%EE%F4%FC%EE%F0&l=')

    def test_a_refused_home_page_gives_no_verdict_from_the_list_page_alone(self):
        # Why (#4205, Gitar): a list-only 'other' would be kept for 30 days on one passing error
        def fetch(url):
            if url == 'https://haulier.example/':
                raise http(403)
            return '<title>Fahrer: 12 Anzeigen</title><a>Berufskraftfahrer CE</a>' + TEXT
        self.assertIsNone(self.kind(fetch, answer='other', term='Fahrer'))
        self.assertEqual(self.asked, [])

    def test_no_ai_or_an_answer_outside_the_list_is_unknown(self):
        self.assertIsNone(self.kind(lambda url: HAULIER, answer=None))
        self.assertIsNone(self.kind(lambda url: HAULIER, answer='a bakery'))

    def test_the_page_reader_off_means_no_check(self):
        careers.READER = None
        fetch = mock.Mock(return_value=HAULIER)
        self.assertIsNone(self.kind(fetch))
        self.assertEqual((self.asked, fetch.call_count), ([], 0), 'no page fetched, no AI asked')


class ReadTests(unittest.TestCase):
    """found_boards.read: a board found not to be one gives its place to a spare, goes to the scout when it is an employer, and is skipped."""
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.data, self.said, self.kinds = {'boards': {}}, [], {'b1.example': ('one employer', HAULIER), 'b2.example': ('gone', '')}
        for patch in (mock.patch('src.paths.DATA', Path(tmp.name)), mock.patch.object(board_ideas, 'load', side_effect=lambda: self.data),
                      mock.patch.object(board_ideas, 'save'), mock.patch.object(found_boards, '_dead', return_value=set()),
                      mock.patch.object(found_boards.board_employers, 'note'), mock.patch.object(careers, 'READER', 'auto'),   # kind is faked
                      mock.patch.object(board_check, 'kind', side_effect=lambda b, fetch, term='': self.kinds.get(b['host'], ('job board', PORTAL))),
                      mock.patch('builtins.print', lambda *a, **k: self.said.append(' '.join(map(str, a))))):
            patch.start()
            self.addCleanup(patch.stop)

    def read(self, boards, spare=(), now=None):
        def read_board(b, search, fetch, route=None, early=False, show=None):
            return ([], 'empty', None) if b['host'] in ('b1.example', 'b2.example', 'b3.example') else \
                ([{'title': 'Berufskraftfahrer', 'url': f"https://{b['host']}/1", 'location': 'Nürnberg'}], 'ok', None)
        with mock.patch.object(found_boards, 'read_board', read_board), mock.patch.object(found_boards, '_another_way', side_effect=lambda *a: a[-1]):
            return found_boards.read(SEARCH, boards, early=True, workers=4, spare=spare, is_relevant=list, dead=set(), now=now)

    def test_a_board_that_is_none_is_replaced_by_a_spare_and_an_employer_goes_to_the_scout(self):
        jobs = self.read([board(1), board(2), board(3), board(4)], spare=[board(5), board(6)])
        self.assertEqual(sorted(job['url'] for job in jobs), ['https://b4.example/1', 'https://b5.example/1', 'https://b6.example/1'])
        self.assertTrue(any("Board 1 is one employer's own site; reading Board" in line for line in self.said), self.said)
        self.assertTrue(any("Board 2 can't be reached; reading Board" in line for line in self.said), self.said)
        self.assertNotIn('Board 3', ' '.join(line for line in self.said if 'in its place' in line), 'an empty real board keeps its place')
        kept = {c['name']: c for c in board_employers.candidates()}
        self.assertEqual(kept['Müller Spedition'].get('website'), 'https://b1.example/', 'the scout gets the employer with its address')

    def test_one_employer_is_skipped_next_time_and_a_gone_board_after_two_days(self):
        from datetime import datetime, timedelta, timezone
        day = datetime(2026, 10, 19, 9, tzinfo=timezone.utc)
        self.read([board(1), board(2)], now=day)
        self.read([board(2)], now=day + timedelta(hours=1))   # the same search's full read, or a Mac offline all day
        later = [b['host'] for b in board_yield.pick([board(1), board(2)], self.data['boards'])]
        self.assertEqual(later, ['b2.example'], 'gone on one day only: read again')
        self.read([board(2)], now=day + timedelta(days=1))
        self.assertEqual(board_yield.pick([board(1), board(2)], self.data['boards']), [])

    def test_the_board_step_says_what_a_board_that_is_none_is(self):
        from datetime import datetime, timezone
        self.read([board(1), board(2)])
        with mock.patch.object(board_ideas, 'ideas', return_value=[board(1), board(2)]), mock.patch.object(found_boards, 'read'), \
                mock.patch.object(board_yield, '_read_since', return_value=datetime(2000, 1, 1, tzinfo=timezone.utc)):   # this search read them
            lines = board_yield.step(SEARCH)
        self.assertEqual([line['status'] for line in lines], ["one employer's own site: added to your employers", "can't be reached"])

    def test_the_employer_s_name_is_the_site_s_not_its_page_s(self):
        for title in ('TLH Transport Logistics Hauke: Bewerbung', 'TLH Transport Logistics Hauke | Karriere', 'TLH Transport Logistics Hauke - Home'):
            with self.subTest(title=title):
                self.assertEqual(board_check.name_of(f'<title>{title}</title>', 'x.example'), 'TLH Transport Logistics Hauke')

    def test_an_empty_read_of_a_list_built_by_scripts_is_neither_not_a_board_nor_a_visit(self):
        self.kinds['b3.example'] = (None, '')   # kind(): a frame scripts fill gives no verdict
        self.read([board(3)], spare=[board(5)])
        self.assertNotIn('site_kind', self.data['boards']['b3.example'], "never kept as 'other' for 30 days")
        self.assertNotEqual(self.data['boards']['b3.example'].get('state'), 'browser', 'a readable board is never offered as a visit')
        self.assertFalse(any('is not a job board' in line or 'refuses automated reading' in line for line in self.said), self.said)
        self.assertEqual(board_check.kind.call_args.args[2], 'Berufskraftfahrer', "the search page asked with the search's first word")

    def test_a_not_a_board_verdict_whose_retry_read_gives_jobs_becomes_a_board_without_asking(self):
        # Why (#4209, Gitar): the jobs read are the proof; asking again could call it 'other' and drop the jobs just read
        from datetime import datetime, timedelta, timezone
        day = datetime(2026, 11, 14, 9, tzinfo=timezone.utc)
        self.data['boards']['b4.example'] = {'site_kind': 'other', 'state': 'empty', 'last_read': (day - timedelta(days=31)).isoformat()}
        self.kinds['b4.example'] = ('other', '')   # what a wrong judge would say again
        jobs = self.read([board(4)], now=day)
        self.assertEqual([job['url'] for job in jobs], ['https://b4.example/1'], 'its retry was due: read, and its list shows jobs')
        self.assertEqual((board_check.kind.call_count, self.data['boards']['b4.example']['site_kind']), (0, 'job board'))
        self.assertEqual([b['host'] for b in board_yield.pick([board(4)], self.data['boards'])], ['b4.example'], 'and stays a board')

    def test_a_not_a_board_verdict_whose_retry_read_is_empty_is_asked_again_and_follows_the_answer(self):
        # Why (14 Nov 2026, owner via sa): a wrong 'other' was read again every 30 days but never judged again, so it never cleared
        from datetime import datetime, timedelta, timezone
        day = datetime(2026, 11, 14, 9, tzinfo=timezone.utc)
        self.data['boards']['b3.example'] = {'site_kind': 'other', 'state': 'empty', 'last_read': (day - timedelta(days=31)).isoformat()}
        self.read([board(3)], now=day)
        self.assertEqual((board_check.kind.call_count, self.data['boards']['b3.example']['site_kind']), (1, 'job board'))

    def test_the_page_reader_off_keeps_a_not_a_board_verdict_on_its_retry(self):
        # Why (#4209, Gitar): with no page reader there is no judge, so no answer is not a new verdict
        from datetime import datetime, timedelta, timezone
        day = datetime(2026, 11, 14, 9, tzinfo=timezone.utc)
        self.data['boards']['b3.example'] = {'site_kind': 'other', 'state': 'empty', 'last_read': (day - timedelta(days=31)).isoformat()}
        with mock.patch.object(careers, 'READER', None):
            self.read([board(3)], now=day)
        self.assertEqual((board_check.kind.call_count, self.data['boards']['b3.example']['site_kind']), (0, 'other'))

    def test_a_not_a_board_verdict_with_no_answer_on_its_retry_is_dropped(self):
        from datetime import datetime, timedelta, timezone
        day = datetime(2026, 11, 14, 9, tzinfo=timezone.utc)
        self.data['boards']['b3.example'] = {'site_kind': 'other', 'state': 'empty', 'last_read': (day - timedelta(days=31)).isoformat()}
        self.kinds['b3.example'] = (None, '')
        self.read([board(3)], now=day)
        self.assertNotIn('site_kind', self.data['boards']['b3.example'], 'no answer: the next empty read asks again')

    def test_a_not_a_board_verdict_before_its_retry_is_neither_read_nor_asked(self):
        from datetime import datetime, timedelta, timezone
        day = datetime(2026, 11, 14, 9, tzinfo=timezone.utc)
        self.data['boards']['b4.example'] = {'site_kind': 'other', 'state': 'empty', 'last_read': (day - timedelta(days=3)).isoformat()}
        self.assertEqual(self.read([board(4)], now=day), [])
        self.assertEqual((board_check.kind.call_count, self.data['boards']['b4.example']['site_kind']), (0, 'other'))

    def test_an_empty_real_board_is_checked_once(self):
        self.read([board(3)])
        self.read([board(3)])
        self.assertEqual(board_check.kind.call_count, 1)
        self.assertEqual(self.data['boards']['b3.example']['site_kind'], 'job board')


if __name__ == '__main__':
    unittest.main()
