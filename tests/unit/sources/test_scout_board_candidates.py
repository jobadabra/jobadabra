"""The boards installs reported as the Scout's candidates (src/scout_board_candidates.py). 13 Nov 2026, owner via sa: "Any reported board (Recommended)": k >= 1 for the Scout only,
never the install id; a reported template is a hint, never read (rabota.md's is a job-alert subscribe form). Fake reads only: no network, no AI."""
import io
import json
import os
import sqlite3
import unittest
import urllib.error
from datetime import date, timedelta
from unittest import mock

from src import scout_board_candidates as candidates, scout_boards
from src.sources import ats, careers

TODAY = date(2026, 11, 13)
SUBSCRIBE = 'https://www.rabota.md/?source=main&subscribePosition={role}&subscribeName={place}'


class Valid(unittest.TestCase):
    def test_a_board_only_our_ci_searches_read_is_a_candidate_with_zero_installs_and_a_plain_zero_is_not(self):
        """13 Nov 2026, bp: web #643 serves Jobeka-like boards as installs 0 + ci true; without this the Scout would drop the very boards the CI feed was built for."""
        self.assertEqual(candidates.valid({'host': 'jobeka.com', 'url': None, 'countries': ['es'], 'installs': 0, 'ci': True}), {'host': 'jobeka.com', 'countries': ['es'], 'installs': 0})
        self.assertIsNone(candidates.valid({'host': 'jobeka.com', 'countries': ['es'], 'installs': 0}))
        self.assertIsNone(candidates.valid({'host': 'jobeka.com', 'countries': ['es'], 'installs': 0, 'ci': 'yes'}))

    def test_only_host_countries_and_installs_are_kept_never_an_install_id_or_the_reported_template(self):
        got = candidates.valid({'host': 'rabota.md', 'url': SUBSCRIBE, 'countries': ['md', 'xx', 'md'], 'installs': 3, 'install': 'secret-id'})
        self.assertEqual(got, {'host': 'rabota.md', 'countries': ['md'], 'installs': 3})
        self.assertNotIn('secret-id', json.dumps(got))
        self.assertNotIn('subscribe', json.dumps(got))

    def test_a_report_the_shape_gate_does_not_know_is_dropped(self):
        for bad in ({'host': 'Not A Host', 'countries': ['md'], 'installs': 1}, {'host': 'a.example', 'countries': ['xx'], 'installs': 1}, {'host': 'a.example', 'countries': ['md'], 'installs': 0},
                    {'host': 'a.example', 'countries': ['md'], 'installs': True}, {'host': 'a.example', 'countries': 'md', 'installs': 1}, 'a.example', None):
            self.assertIsNone(candidates.valid(bad), bad)


class Fetch(unittest.TestCase):
    def answer(self, boards):
        return mock.MagicMock(read=lambda limit=None: json.dumps({'ok': True, 'boards': boards}).encode(), __enter__=lambda self: self, __exit__=lambda *a: False)

    def test_without_the_key_nothing_is_asked(self):
        out = []
        with mock.patch.dict(os.environ, {'INDEX_PUBLISH_KEY': ''}):
            self.assertEqual(candidates.fetch(out.append, urlopen=lambda *a, **k: self.fail('no key: no request')), [])
        self.assertIn('no INDEX_PUBLISH_KEY', out[0])

    def test_the_site_answer_is_validated_and_the_key_never_reaches_the_log(self):
        out, asked = [], []

        def urlopen(request, timeout=None):
            asked.append((request.full_url, request.get_header('Authorization')))
            return self.answer([{'host': 'rabota.md', 'url': SUBSCRIBE, 'countries': ['md'], 'installs': 2, 'install': 'x'}, {'host': 'bad host', 'countries': ['md'], 'installs': 1}])
        with mock.patch.dict(os.environ, {'INDEX_PUBLISH_KEY': 'k3y-secret', 'SCOUT_MEMORY_URL': 'https://elsewhere.example/x'}):   # the lab job sets this variable for its memory restore: the key still goes only to the fixed address
            got = candidates.fetch(out.append, urlopen=urlopen)
        self.assertEqual(got, [{'host': 'rabota.md', 'countries': ['md'], 'installs': 2}])
        self.assertEqual(asked, [('https://www.jobadabra.top/api/scout-memory?boards=1', 'Bearer k3y-secret')])
        self.assertNotIn('k3y-secret', ' '.join(out))

    def test_a_site_that_does_not_answer_gives_none_and_the_pass_goes_on(self):
        out = []

        def urlopen(*a, **k):
            raise OSError('down')
        with mock.patch.dict(os.environ, {'INDEX_PUBLISH_KEY': 'k3y-secret'}):
            self.assertEqual(candidates.fetch(out.append, urlopen=urlopen), [])
        self.assertIn('not read (OSError)', out[0])

    def test_the_request_carries_the_scout_s_own_user_agent_never_urllib_s_default(self):
        seen = []

        def urlopen(request, **k):
            seen.append(dict(request.header_items()))
            raise OSError('stop')
        with mock.patch.dict(os.environ, {'INDEX_PUBLISH_KEY': 'k3y-secret'}):
            candidates.fetch(lambda line: None, urlopen=urlopen)
        self.assertEqual(seen[0]['User-agent'], ats.USER_AGENT, 'Cloudflare answers urllib\'s default agent with 403 1010 before the Worker is reached')

    def test_a_refusal_names_its_status_and_the_site_s_word_and_never_the_key(self):
        out = []

        def urlopen(*a, **k):
            raise urllib.error.HTTPError('https://x', 503, 'unavailable', {}, io.BytesIO(b'{"ok": false, "error": "could not read the reported boards"}'))
        with mock.patch.dict(os.environ, {'INDEX_PUBLISH_KEY': 'k3y-secret'}):
            self.assertEqual(candidates.fetch(out.append, urlopen=urlopen), [])
        self.assertIn('not read (HTTPError HTTP 503: could not read the reported boards)', out[0])
        self.assertNotIn('k3y-secret', out[0])


class ForCountry(unittest.TestCase):
    def report(self, host, installs, countries=('md',)):
        return {'host': host, 'countries': list(countries), 'installs': installs}

    def test_the_country_s_unmeasured_boards_most_installs_first_at_most_reserve_each_as_its_home_page(self):
        reports = [self.report(f'b{n}.example', n) for n in range(1, 8)] + [self.report('other.example', 99, ('es',)), self.report('measured.example', 50)]
        got = candidates.for_country(reports, 'md', measured=[('measured.example', 'md', (TODAY - timedelta(days=3)).isoformat())], today=TODAY)
        self.assertEqual([item['host'] for item in got], ['b7.example', 'b6.example', 'b5.example', 'b4.example'][:candidates.RESERVE], 'not another country, not a board measured lately')
        self.assertTrue(all(item['home'] and item['search_url'] == f"https://{item['host']}/" for item in got), 'the home page, marked: the pass finds its own search')

    def test_reserve_comes_from_the_env_clamped_and_anything_else_is_the_default(self):
        """13 Nov 2026 (bp): a by-hand dispatch asks for more candidates (lab `reserve` input); the schedule sends nothing and keeps RESERVE."""
        for raw, want in (('', candidates.RESERVE), ('12', 12), (' 7 ', 7), ('0', 1), ('-5', 1), ('99', candidates.MAX_RESERVE), ('24', 24), ('lots', candidates.RESERVE), ('3.5', candidates.RESERVE), ('1e1', candidates.RESERVE)):
            with mock.patch.dict(os.environ, {'SCOUT_BOARD_RESERVE': raw}):
                self.assertEqual(candidates.reserve(), want, repr(raw))
        with mock.patch.dict(os.environ):
            os.environ.pop('SCOUT_BOARD_RESERVE', None)
            self.assertEqual(candidates.reserve(), candidates.RESERVE)

    def test_a_by_hand_reserve_reads_that_many_candidates_a_pass(self):
        reports = [self.report(f'b{n}.example', n) for n in range(1, 21)]
        with mock.patch.dict(os.environ, {'SCOUT_BOARD_RESERVE': '12'}):
            self.assertEqual(len(candidates.for_country(reports, 'md', today=TODAY)), 12)
        with mock.patch.dict(os.environ, {'SCOUT_BOARD_RESERVE': ''}):
            self.assertEqual(len(candidates.for_country(reports, 'md', today=TODAY)), candidates.RESERVE)

    def test_a_candidate_whose_page_was_empty_or_refused_is_stamped_so_it_is_not_read_again_for_20_days(self):
        """13 Nov 2026 (bp, lab run 43520706763): ayto-coslada.es 0/0 and campuseducacion.com 0/0 ("not measured") must not take a slot again next pass: every candidate the pass read has a line."""
        db = sqlite3.connect(':memory:')
        picked = [{'host': 'empty.example'}, {'host': 'refused.example'}, {'host': 'unread.example'}]
        candidates.stamp_read(db, 'es', picked, ['empty.example 0/0', 'refused.example 0/0 (no places; the AI: this country)'])
        self.assertEqual({(host, code) for host, code, _ in candidates.tried(db)}, {('empty.example', 'es'), ('refused.example', 'es')}, 'the one the pass never reached waits for the next pass')
        reports = [{'host': host, 'countries': ['es'], 'installs': 1} for host in ('empty.example', 'refused.example', 'unread.example')]
        self.assertEqual([c['host'] for c in candidates.choose(db, reports, 'es')], ['unread.example'])

    def test_an_old_measure_makes_the_board_a_candidate_again(self):
        got = candidates.for_country([self.report('old.example', 1)], 'md', measured=[('old.example', 'md', (TODAY - timedelta(days=21)).isoformat())], today=TODAY)
        self.assertEqual([item['host'] for item in got], ['old.example'])

    def test_a_reported_subscribe_style_template_is_never_read_the_board_is_read_by_its_home(self):
        report = candidates.valid({'host': 'rabota.md', 'url': SUBSCRIBE, 'countries': ['md'], 'installs': 1})
        got = candidates.for_country([report], 'md', today=TODAY)
        self.assertEqual(got[0]['search_url'], 'https://rabota.md/')
        self.assertTrue(got[0]['home'])
        self.assertNotIn('subscribe', json.dumps(got), 'the reported template is dropped on entry: nothing downstream can open it')


HOME_PAGE = ('<html><form action="/search"><input name="query"></form>'   # rabota.md's home page holds a search form and a subscribe form (13 Nov 2026)
             '<form class="subscribeWrap"><input type="text" name="subscribePosition"><input type="text" name="subscribeName"><input type="email" name="subscribeEmail"></form></html>')


class InThePass(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        for patch in (mock.patch.object(scout_boards.pool_tags, 'countries_each', lambda texts: ({t: {'md'} for t in texts}, [])),
                      mock.patch.object(scout_boards.pool_tags, 'families_each', lambda titles: ({t: ['software_dev'] for t in titles}, []))):
            patch.start()
            self.addCleanup(patch.stop)

    def run_pass(self, reported):
        seen = []
        patch = mock.patch.object(careers, 'get_text', lambda url, *a, **k: HOME_PAGE if url.startswith('https://rabota.md/') else '')   # no network: the board's home page is this one
        patch.start()
        self.addCleanup(patch.stop)

        def read_board(item, search, fetch):
            seen.append((item['host'], item['search_url'], bool(item.get('home'))))
            return [{'title': f'Developer {n}', 'location': 'Chisinau', 'url': f"https://{item['host']}/{n}"} for n in range(4)], 'ok', None
        asked = {'software_dev': ['programator']}
        scout_boards.run(self.db, ideas=lambda search: [{'name': 'idea.example', 'host': 'idea.example', 'search_url': 'https://idea.example/s?q={role}', 'countries': ['Moldova'], 'kinds': ['any'], 'source_kind': 'general'}],
                         read_board=read_board, out=lambda line: None, named='md', google=lambda *a: [], families=['software_dev'], words=lambda db, country, families: asked, reported=reported)
        return seen

    def test_a_reported_board_is_read_by_its_home_before_the_ai_s_ideas_and_not_again_next_pass(self):
        report = candidates.valid({'host': 'rabota.md', 'url': SUBSCRIBE, 'countries': ['md'], 'installs': 1})
        first = self.run_pass([report])
        self.assertEqual([item[0] for item in first], ['rabota.md', 'idea.example'])
        self.assertEqual(first[0][1:], ('https://rabota.md/search?query={role}', False), 'read through the search form its home page holds: not the reported template, not the subscribe form')
        self.assertFalse(any('subscribe' in item[1] for item in first))
        second = self.run_pass([report])
        self.assertEqual([item[0] for item in second], ['idea.example'], 'read lately (kept or not): the AI s ideas keep the slots')

    def test_a_host_the_browser_was_stopped_at_is_never_a_candidate_whoever_reported_it(self):
        scout_boards.run(self.db, ideas=lambda search: [], read_board=lambda *a: ([], 'ok', None), out=lambda line: None, named='md', google=lambda *a: [], families=['software_dev'], words=lambda db, country, families: {})   # makes the memory tables
        self.db.execute("INSERT INTO scout_browser_final (host, why, at) VALUES ('jooble.org', 'HTTP 403', '2026-11-13')")
        reports = [candidates.valid({'host': host, 'countries': ['md'], 'installs': installs, 'ci': ci}) for host, installs, ci in (('jooble.org', 0, True), ('jooble.org', 5, False), ('www.jooble.org', 0, True), ('open.example', 0, True))]
        self.assertEqual([item['host'] for item in candidates.choose(self.db, reports, 'md')], ['open.example'], 'CI report or install report: the stop wins')

    def test_a_refused_candidate_is_read_once_then_left_alone_for_the_refresh_days(self):
        report = candidates.valid({'host': 'refused.example', 'countries': ['md'], 'installs': 0, 'ci': True})
        seen = []

        def read_board(item, search, fetch):
            seen.append(item['host'])
            return [], 'ok', None   # a refusal reads as no job
        for _ in range(2):
            scout_boards.run(self.db, ideas=lambda search: [], read_board=read_board, out=lambda line: None, named='md', google=lambda *a: [], families=['software_dev'], words=lambda db, country, families: {'software_dev': ['x']}, reported=[report])
        self.assertEqual(seen, ['refused.example'], 'a refused board is stamped like any read one: not asked again by the next pass')


if __name__ == '__main__':
    unittest.main()
