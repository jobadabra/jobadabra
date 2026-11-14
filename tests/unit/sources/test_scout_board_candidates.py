"""The boards installs reported as the Scout's candidates (src/scout_board_candidates.py). 13 Nov 2026, owner via sa: "Any reported board (Recommended)": k >= 1 for the Scout only,
never the install id; a reported template is a hint, never read (rabota.md's is a job-alert subscribe form). Fake reads only: no network, no AI."""
import io
import json
import os
import sqlite3
import sys
import unittest
import urllib.error
from pathlib import Path
from urllib.parse import urlsplit
from datetime import date, timedelta
from unittest import mock

from src import employer_index, scout_board_candidates as candidates, scout_boards
from src.ai import board_ideas
from src.sources import ats, board_paths, careers

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', '..', 'tools', 'persona-search'))
import report_boards  # noqa: E402  (the report step of the CI searches: the whole-path test plays it)

TODAY = date(2026, 11, 13)
SUBSCRIBE = 'https://www.rabota.md/?source=main&subscribePosition={role}&subscribeName={place}'


class Valid(unittest.TestCase):
    def test_a_board_only_our_ci_searches_read_is_a_candidate_with_zero_installs_and_a_plain_zero_is_not(self):
        """13 Nov 2026, bp: web #643 serves Jobeka-like boards as installs 0 + ci true; without this the Scout would drop the very boards the CI feed was built for."""
        self.assertEqual(candidates.valid({'host': 'jobeka.com', 'url': None, 'countries': ['es'], 'installs': 0, 'ci': True}), {'host': 'jobeka.com', 'countries': ['es'], 'installs': 0, 'local': 0})
        self.assertIsNone(candidates.valid({'host': 'jobeka.com', 'countries': ['es'], 'installs': 0}))
        self.assertIsNone(candidates.valid({'host': 'jobeka.com', 'countries': ['es'], 'installs': 0, 'ci': 'yes'}))

    def test_only_host_countries_and_installs_are_kept_never_an_install_id_or_the_reported_template(self):
        got = candidates.valid({'host': 'rabota.md', 'url': SUBSCRIBE, 'countries': ['md', 'xx', 'md'], 'installs': 3, 'install': 'secret-id'})
        self.assertEqual(got, {'host': 'rabota.md', 'countries': ['md'], 'installs': 3, 'local': 0})
        self.assertNotIn('secret-id', json.dumps(got))
        self.assertNotIn('subscribe', json.dumps(got))

    def test_a_report_the_shape_gate_does_not_know_is_dropped(self):
        for bad in ({'host': 'Not A Host', 'countries': ['md'], 'installs': 1}, {'host': 'a.example', 'countries': ['xx'], 'installs': 1}, {'host': 'a.example', 'countries': ['md'], 'installs': 0},
                    {'host': 'a.example', 'countries': ['md'], 'installs': True}, {'host': 'a.example', 'countries': 'md', 'installs': 1}, 'a.example', None):
            self.assertIsNone(candidates.valid(bad), bad)


    def test_local_is_a_count_0_to_999_anything_else_is_0_and_never_drops_the_board(self):
        """13 Nov 2026, owner via sa: `local` is a fixed-shape count, validated at both ends (the site: jobadabra-web #647)."""
        def local(value):
            return candidates.valid({'host': 'jobeka.es', 'countries': ['es'], 'installs': 0, 'ci': True, 'local': value})['local']
        self.assertEqual([local(value) for value in (19, 0, 999)], [19, 0, 999])
        self.assertEqual([local(value) for value in (1000, -1, 4.5, '19', True, None, [3])], [0] * 7)
        self.assertEqual(candidates.valid({'host': 'jobeka.es', 'countries': ['es'], 'installs': 2})['local'], 0, 'an old site answer has no local')


    def test_the_same_board_means_the_company_domain_so_co_uk_and_com_br_boards_work_and_a_bare_suffix_matches_nothing(self):
        """Gitar on #4127: with a two-label guess a board keyed 'co.uk' made every *.co.uk address "the same board". One rule, the engine's own (careers_explore.company_domain), no .co.uk special case."""
        for host, url in (('indeed.co.uk', 'https://es.indeed.co.uk/jobs?q={role}&l={place}'), ('infojobs.com.br', 'https://www.infojobs.com.br/empregos/{role}'), ('jobeka.example', 'https://es.jobeka.example/s/{role}')):
            self.assertEqual(candidates.address_ok(url, host), url, host)
        for host, url in (('indeed.co.uk', 'https://evil.co.uk/s?q={role}'), ('indeed.co.uk', 'https://indeed.com/s?q={role}'), ('infojobs.com.br', 'https://other.com.br/s/{role}'),
                          ('co.uk', 'https://evil.co.uk/s?q={role}'), ('co.uk', 'https://es.indeed.co.uk/jobs?q={role}'), ('com.br', 'https://other.com.br/s/{role}'), ('com.au', 'https://x.com.au/s/{role}'), ('es.indeed.co.uk', 'https://es.indeed.co.uk/jobs?q={role}')):
            self.assertIsNone(candidates.address_ok(url, host), f'{host} {url}')
        item = {'host': 'co.uk', 'countries': ['es'], 'installs': 0, 'ci': True}
        self.assertNotIn('ci_urls', candidates.valid({**item, 'ci_urls': {'es': 'https://evil.co.uk/s?q={role}'}}), 'a board reported as co.uk keeps the home read, never a loose address')
        self.assertEqual(candidates.valid({**item, 'host': 'indeed.co.uk', 'ci_urls': {'es': 'https://es.indeed.co.uk/jobs?q={role}'}})['ci_urls'], {'es': 'https://es.indeed.co.uk/jobs?q={role}'})

    def test_a_ci_address_is_kept_per_country_only_when_it_is_a_search_template_of_the_board(self):
        """14 Nov 2026, owner via sa ("CI report carries it"): the site hands `ci_urls`; the Scout checks the same shape again (jobadabra-web api/ci-boards.js searchAddress)."""
        item = {'host': 'jobeka.example', 'countries': ['es', 'pt'], 'installs': 0, 'ci': True, 'local': 19}
        good = 'https://es.jobeka.example/empleos-{role}-provincia-de-{place}'
        self.assertEqual(candidates.valid({**item, 'ci_urls': {'es': good}})['ci_urls'], {'es': good})
        self.assertNotIn('ci_urls', candidates.valid(item), 'none reported: the key is absent, the board is read by its home page')
        self.assertEqual(candidates.valid({**item, 'ci_urls': {'es': good, 'pt': 'https://evil.example/s/{role}', 'xx': good, 'fr': good}})['ci_urls'], {'es': good}, 'another host, a country the board lacks')
        for bad in ('http://jobeka.example/s/{role}', 'https://evil.example/s/{role}', 'https://notjobeka.example/s/{role}', 'https://jobeka.example.evil.example/s/{role}', 'https://u@jobeka.example/s/{role}',
                    'https://jobeka.example:8443/s/{role}', 'https://jobeka.example/s/{role}#top', 'https://jobeka.example/s/{role}/{city}', 'https://jobeka.example/s/{role', 'https://jobeka.example/s/electrician-madrid',
                    'https://jobeka.example/s/{place}', 'https://jobeka.example/s/{role}?name=An%20Person', 'https://jobeka.example/s/{role}?x=a b', 'https://jobeka.example/s/{role}/ñandú',
                    'https://jobeka.example/' + 'a' * 250 + '{role}', 'https://JOBEKA.example/s/{role}', 'https://jobeka.example/s/{role}\n', 'javascript:alert({role})', '', None, 7, {}):
            self.assertIsNone(candidates.address_ok(bad, 'jobeka.example'), repr(bad))
            self.assertNotIn('ci_urls', candidates.valid({**item, 'ci_urls': {'es': bad}}), repr(bad))
        self.assertEqual(candidates.address_ok('https://jobs.uk.jobeka.example/s/{role}', 'jobeka.example'), 'https://jobs.uk.jobeka.example/s/{role}')
        for not_a_map in ('es', ['es'], None, 5):
            self.assertNotIn('ci_urls', candidates.valid({**item, 'ci_urls': not_a_map}))


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
        self.assertEqual(got, [{'host': 'rabota.md', 'countries': ['md'], 'installs': 2, 'local': 0}])
        self.assertEqual(asked, [('https://www.jobadabra.top/api/scout-memory?boards=1', 'Bearer k3y-secret')])
        self.assertNotIn('k3y-secret', ' '.join(out))

    def test_the_pass_line_counts_the_boards_whose_address_is_on_another_host_than_the_reported_one(self):
        """14 Nov 2026, sa: the owner is told how many boards the subdomain fix reaches; the first pass after it prints the number."""
        out = []
        boards = [{'host': 'jobeka.com', 'countries': ['es'], 'installs': 0, 'ci': True, 'ci_urls': {'es': 'https://es.jobeka.com/empleos-{role}'}},
                  {'host': 'plain.example', 'countries': ['es'], 'installs': 0, 'ci': True, 'ci_urls': {'es': 'https://www.plain.example/s?q={role}'}}, {'host': 'home.example', 'countries': ['es'], 'installs': 1}]
        with mock.patch.dict(os.environ, {'INDEX_PUBLISH_KEY': 'k'}):
            candidates.fetch(out.append, urlopen=lambda request, timeout=None: self.answer(boards))
        self.assertEqual(out[-1], 'Board pass: reported boards: 3 of 3 read; 1 with an address on another host than the reported one', 'www. is no other host; a board with no address is none')

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

    def test_boards_that_gave_jobs_come_first_then_installs_then_the_alphabet(self):
        """13 Nov 2026, owner via sa, run 43520706763 (es:electrical_mechanical): 77 reported boards, 4 read, equal installs went alphabetically (apiem.org, ayto-coslada.es, campuseducacion.com,
        flightdeckfriend.com) while Jobeka (19 right jobs) and Trabajo.org (16) waited. Fails on the old key (-installs, host)."""
        def report(host, installs, local):
            return {'host': host, 'countries': ['es'], 'installs': installs, 'local': local}
        reports = [report('apiem.org', 0, 0), report('ayto-coslada.es', 0, 0), report('campuseducacion.com', 0, 0), report('flightdeckfriend.com', 0, 0),
                   report('trabajo.org', 0, 16), report('jobeka.es', 0, 19), report('five-installs.example', 5, 0), report('also-16.example', 0, 16)]
        got = [item['host'] for item in candidates.for_country(reports, 'es', today=TODAY)]
        self.assertEqual(got, ['jobeka.es', 'also-16.example', 'trabajo.org', 'five-installs.example'][:candidates.RESERVE], 'jobs kept first, ties by installs then host')
        self.assertEqual(got[:2], ['jobeka.es', 'also-16.example'])
        zero = [report('b.example', 1, 0), report('a.example', 1, 0), report('c.example', 7, 0)]
        self.assertEqual([item['host'] for item in candidates.for_country(zero, 'es', today=TODAY)], ['c.example', 'a.example', 'b.example'], 'no local anywhere: installs, then alphabetical, as before')

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
        self.assertEqual({(host, code) for host, code, *_ in candidates.tried(db)}, {('empty.example', 'es'), ('refused.example', 'es')}, 'the one the pass never reached waits for the next pass')
        reports = [{'host': host, 'countries': ['es'], 'installs': 1} for host in ('empty.example', 'refused.example', 'unread.example')]
        self.assertEqual([c['host'] for c in candidates.choose(db, reports, 'es')], ['unread.example'])

    def test_an_old_measure_makes_the_board_a_candidate_again(self):
        got = candidates.for_country([self.report('old.example', 1)], 'md', measured=[('old.example', 'md', (TODAY - timedelta(days=21)).isoformat())], today=TODAY)
        self.assertEqual([item['host'] for item in got], ['old.example'])

    def test_a_board_a_ci_search_read_at_an_address_in_this_country_is_read_there_any_other_by_its_home_page(self):
        """14 Nov 2026, owner via sa, runs 43524652066 / 43526430106: Jobeka was read at https://jobeka.com/ (0 rows) where the CI search read https://es.jobeka.com/... (20 jobs)."""
        address = 'https://es.jobeka.example/empleos-{role}-provincia-de-{place}'
        reports = [{'host': 'jobeka.example', 'countries': ['es', 'pt'], 'installs': 0, 'local': 19, 'ci_urls': {'es': address}}, {'host': 'plain.example', 'countries': ['es'], 'installs': 0, 'local': 3}]
        got = {item['host']: item for item in candidates.for_country(reports, 'es', today=TODAY)}
        self.assertEqual(got['es.jobeka.example']['search_url'], address)
        self.assertEqual(got['es.jobeka.example']['name'], 'jobeka.example', 'the reported name stays the name; the host is the address\'s own (Design: scout_board_candidates.py)')
        self.assertNotIn('home', got['es.jobeka.example'], 'read like an AI-named template board: its own address, no home step')
        self.assertEqual((got['plain.example']['search_url'], got['plain.example']['home']), ('https://plain.example/', True))
        self.assertEqual(candidates.for_country(reports, 'pt', today=TODAY)[0]['search_url'], 'https://jobeka.example/', 'no address for pt: the es address is never used there')

    def test_a_candidate_with_an_address_the_scout_has_not_read_is_due_whatever_the_home_page_stamp_says_and_the_20_day_rule_holds_for_the_rest(self):
        """14 Nov 2026, sa: home reads with 0 rows stamped jobeka.example|es for 20 days, so a stored address would never be read. Fails on the host-only stamp."""
        db = sqlite3.connect(':memory:')
        address = 'https://es.jobeka.example/empleos-{role}-provincia-de-{place}'
        home = [{'host': 'jobeka.example', 'search_url': 'https://jobeka.example/', 'home': True}, {'host': 'plain.example', 'search_url': 'https://plain.example/', 'home': True}]
        candidates.stamp_read(db, 'es', home, ['jobeka.example 0/0', 'plain.example 0/0'])
        reports = [{'host': 'jobeka.example', 'countries': ['es'], 'installs': 0, 'local': 19}, {'host': 'plain.example', 'countries': ['es'], 'installs': 0}]
        self.assertEqual(candidates.choose(db, reports, 'es'), [], 'home page read lately, nothing else known: not asked again (the 20-day rule)')
        reports[0]['ci_urls'] = {'es': address}
        due = candidates.choose(db, reports, 'es')
        self.assertEqual([(item['host'], item['search_url']) for item in due], [('es.jobeka.example', address)], 'the address arrives: due now; plain.example (no address) stays blocked')
        candidates.stamp_read(db, 'es', due, ['es.jobeka.example 20/19'])
        self.assertEqual(candidates.choose(db, reports, 'es'), [], 'read at that address: not again for 20 days')
        old = sqlite3.connect(':memory:')
        candidates.stamp(old, 'es', [('jobeka.example', address), ('plain.example', '')], today=TODAY)   # stamped on a fixed day: no real clock in this test
        self.assertEqual([item['host'] for item in candidates.for_country(reports, 'es', measured=candidates.tried(old), today=TODAY + timedelta(days=21))], ['es.jobeka.example', 'plain.example'], 'both are candidates again after the refresh days')
        self.assertEqual(candidates.for_country(reports, 'es', measured=candidates.tried(old), today=TODAY + timedelta(days=19)), [], 'still inside the 20 days: neither')
        reports[0]['ci_urls'] = {'es': 'https://es.jobeka.example/search?q={role}'}
        self.assertEqual([item['search_url'] for item in candidates.choose(db, reports, 'es')], ['https://es.jobeka.example/search?q={role}'], 'a changed address is a new one: due')

    def test_a_kept_fact_blocks_an_address_only_when_it_was_read_there(self):
        db = sqlite3.connect(':memory:')
        scout_boards.ensure(db)
        address = 'https://es.jobeka.example/empleos-{role}-provincia-de-{place}'
        report = {'host': 'jobeka.example', 'countries': ['es'], 'installs': 0, 'ci_urls': {'es': address}}
        today = TODAY.isoformat()
        for host, url, due in (('jobeka.example', 'https://jobeka.example/search?q={role}', True), ('jobeka.example', address, False), ('es.jobeka.example', address, False), ('es.jobeka.example', 'https://es.jobeka.example/search?q={role}', True)):
            db.execute('DELETE FROM scout_board_facts')
            db.execute('INSERT INTO scout_board_facts (host, country, url, families, read_at, local_jobs, family_jobs) VALUES (?, ?, ?, ?, ?, ?, ?)', (host, 'es', url, '[]', today, scout_boards.MIN_LOCAL, '{}'))
            self.assertEqual(bool(candidates.choose(db, [report], 'es')), due, (host, url))   # a fact kept under either name counts: the report's (before the fix) or the address's

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


# What the site's `?boards=1` answers for a board a CI search read at an address (jobadabra-web #648, api/scout-memory.js reportedBoards), as a literal: the contract between the halves.
ADDRESS = 'https://md.jobeka.example/empleos-{role}-provincia-de-{place}'
SITE_ANSWER = {'ok': True, 'boards': [{'host': 'jobeka.example', 'url': None, 'countries': ['md'], 'installs': 0, 'local': 19, 'ci': True, 'ci_urls': {'md': ADDRESS}}]}


class WholePath(unittest.TestCase):
    """14 Nov 2026, owner via sa, asked via AskUserQuestion ("CI report carries it (Recommended)"), discovery runs 43524652066 / 43526430106: Jobeka was read by its home page (0 rows) where the CI search read its country page (20 jobs).
    The path: a board a search read through ADDRESS with 19 right jobs -> report_boards builds the report -> (the site's literal answer) -> fetch/valid keep it -> for_country reads THAT address -> the Scout's read counts > 0.
    Fails on main: report_boards sends no address, valid drops it, for_country reads the home page; and with the host-only stamp, a home read with 0 rows today blocks the address for 20 days (sa)."""

    def setUp(self):
        import tempfile
        self.db, self.tmp = sqlite3.connect(':memory:'), tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        for patch in (mock.patch.object(scout_boards.pool_tags, 'countries_each', lambda texts: ({t: {'md'} for t in texts}, [])),
                      mock.patch.object(scout_boards.pool_tags, 'families_each', lambda titles: ({t: ['software_dev'] for t in titles}, [])),
                      mock.patch.object(careers, 'get_text', lambda url, *a, **k: '')):
            patch.start()
            self.addCleanup(patch.stop)

    def reported(self, answer):
        body = mock.MagicMock(read=lambda limit=None: json.dumps(answer).encode(), __enter__=lambda self: self, __exit__=lambda *a: False)
        with mock.patch.dict(os.environ, {'INDEX_PUBLISH_KEY': 'k'}):
            return candidates.fetch(lambda line: None, urlopen=lambda request, timeout=None: body)

    def run_pass(self, reported):
        """One Scout pass over `reported`; returns [search_url asked] and the pass's lines. The one page with jobs is the filled ADDRESS (the page the search read)."""
        seen, lines = [], []
        page = board_paths.forms(ADDRESS, 'programator', 'Chisinau')[0]

        def read_board(item, search, fetch):
            asked = board_paths.forms(item['search_url'], 'programator', 'Chisinau')[0]
            seen.append(item['search_url'])   # (the home mark is taken off by the reader at the first read: the address says home or not)
            return ([{'title': f'Developer {n}', 'location': 'Chisinau', 'url': f'https://md.jobeka.example/oferta-{n}'} for n in range(20)] if asked == page else []), 'ok', None
        self.kept = scout_boards.run(self.db, ideas=lambda search: [], read_board=read_board, out=lines.append, named='md', google=lambda *a: [], families=['software_dev'], words=lambda db, country, families: {'software_dev': ['programator']}, reported=reported)
        return seen, lines

    def report_of_the_search(self):
        """What report_boards sends for a CI search of person d03 (Moldova) that read Jobeka through ADDRESS and kept 19 right jobs."""
        folder = os.path.join(self.tmp.name, 'search-profile-d03')
        os.makedirs(os.path.join(folder, 'draw'))
        with open(os.path.join(folder, 'draw', 'presses.jsonl'), 'w') as file:
            file.write(json.dumps({'sources': [{'source': 'jobeka.example', 'kind': 'job board', 'local': 19}]}) + '\n')
        with open(os.path.join(folder, 'found-boards.json'), 'w') as file:
            json.dump({'boards': {'md.jobeka.example': {'search_url': ADDRESS, 'state': 'ok'}}}, file)
        return report_boards.body(report_boards.collect(folder, 'd03'), 'run-1')['ci_boards']

    def test_a_board_a_search_read_at_an_address_is_read_there_by_the_scout_and_counts_jobs(self):
        sent = self.report_of_the_search()
        self.assertEqual(sent, [{'host': 'jobeka.example', 'countries': ['md'], 'local': 19, 'url': ADDRESS}], 'the report: host, country, the count and the template')
        self.assertEqual(SITE_ANSWER['boards'][0]['ci_urls']['md'], sent[0]['url'], 'the site serves back what the report sent')
        reports = self.reported(SITE_ANSWER)
        self.assertEqual(reports[0]['ci_urls'], {'md': ADDRESS})
        seen, lines = self.run_pass(reports)
        self.assertEqual(seen, [ADDRESS], 'read at the address the search read, not at https://jobeka.example/')
        self.assertTrue(any('listed/local: md.jobeka.example 20/20' in line for line in lines), lines)

    def test_the_fact_of_a_board_read_at_a_subdomain_address_is_kept_by_the_site_and_served_by_the_engine(self):
        """14 Nov 2026, sa for the owner ("a subdomain board is never served, so the whole chain is dead for it"), found by a local run of the Scout half for Jobeka: reported jobeka.com with its es.jobeka.com address gave a fact with
        host jobeka.com and a url on es.jobeka.com, which the site's boardFactsOf (the url's host must be the fact's host) and the engine's board_ideas.served (the same check) both dropped. Fails on main (host jobeka.example);
        passes with one definition: the board's host is the address's host (scout_board_candidates.read_host)."""
        self.run_pass(self.reported(SITE_ANSWER))
        fact = next(item for item in self.kept if item['url'] == ADDRESS)
        self.assertEqual(fact['host'], 'md.jobeka.example', 'the fact is kept under the host of the address it was read at')
        # the site's rule, jobadabra-web api/employers.js boardFactsOf: `urlHost !== host.replace(/^www\./, '')` drops the fact
        self.assertEqual(urlsplit(fact['url'].replace('{role}', 'x').replace('{place}', 'x')).hostname, fact['host'].removeprefix('www.'), 'the site drops a fact whose host is not its url\'s host')
        # the engine's rule: the cache a search reads (the site's answer for this fact) -> board_ideas.served
        cache = Path(self.tmp.name) / 'employer_index.json'
        cache.write_text(json.dumps({'sites': [{'kind': 'board', 'host': fact['host'], 'url': fact['url'], 'recipe': {'countries': ['md']},
                                                'relevant': [{'family': 'software_dev', 'country': 'md', 'installs': 1, 'in_places': fact['family_jobs']['software_dev'], 'fit70': 0, 'measured': True}]}]}))
        with mock.patch.object(employer_index, 'CACHE', cache):
            self.assertEqual([board['host'] for board in board_ideas.served(['Moldova'])], ['md.jobeka.example'], 'a search for Moldova is served the board')

    def test_a_stamp_or_fact_kept_under_the_reported_host_before_the_fix_still_counts_for_the_address(self):
        """The fix must not make every board read before it due again: a read under jobeka.example (the report's host) at this address blocks it, under md.jobeka.example too."""
        db = sqlite3.connect(':memory:')
        candidates.stamp(db, 'md', [('jobeka.example', ADDRESS)], today=TODAY)
        report = candidates.valid(SITE_ANSWER['boards'][0])
        self.assertEqual(candidates.for_country([report], 'md', measured=candidates.tried(db), today=TODAY), [])
        self.assertEqual(candidates.for_country([report], 'md', today=TODAY)[0]['host'], 'md.jobeka.example')

    def test_a_home_page_read_today_with_no_rows_does_not_block_the_address_that_arrives_after_it(self):
        """sa, 14 Nov 2026: tonight's home reads (0 rows) stamped the host for 20 days, so a stored address would never have been read."""
        without = [{**SITE_ANSWER['boards'][0], 'ci_urls': {}}]
        first, _ = self.run_pass(self.reported({'ok': True, 'boards': without}))
        self.assertEqual(first, ['https://jobeka.example/'], 'no address yet: the home page, 0 rows, stamped')
        again, _ = self.run_pass(self.reported({'ok': True, 'boards': without}))
        self.assertEqual(again, [], 'still no address: the 20-day rule holds')
        now, lines = self.run_pass(self.reported(SITE_ANSWER))
        self.assertEqual(now, [ADDRESS], 'the address arrives: read in the next pass whatever the home stamp says')
        self.assertTrue(any('listed/local: md.jobeka.example 20/20' in line for line in lines), lines)
        after, _ = self.run_pass(self.reported(SITE_ANSWER))
        self.assertEqual(after, [], 'read at that address: not again for 20 days')


if __name__ == '__main__':
    unittest.main()
