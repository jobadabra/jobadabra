"""Guard: money — the weekly reference spends SerpApi credits (one search per persona, 18 a week, ~72 a month): it must search nothing without its own key, nothing when credits run low, stop after the first failure,
and never send a record from a branch. The counts it stores are the yardstick of the Admin Night search tab ("found 7 of 24 reachable"); a job in both sources counts once, an unread source is null, never 0.
Fakes only: no EURES, SerpApi, broker or Admin is called here."""
import json
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'tools' / 'persona-search'))
import reference  # noqa: E402
from src.sources import eures  # noqa: E402

NUTS = {'BE10': 'Brussels', 'BE100': 'Brussels-Capital', 'BG411': 'Sofia (stolitsa)'}
P3 = reference.PERSONAS[2]   # Carpenter, Brussels
KEY = 'a-fake-serpapi-key'


def job(i, title='Menuisier', code='BE100', employer='ACME'):
    return {'id': f'j{i}', 'title': f'{title} {i}', 'employer': {'name': employer}, 'locationMap': {'BE': [code]}}


def serp(i, link='https://careers.example.test/apply'):
    return {'title': f'Charpentier {i}', 'company_name': 'Bois SA', 'location': 'Brussels, Belgium', 'job_id': f'g{i}', 'apply_options': [{'link': link}]}


def right_if(word):
    """A fake blind judge: role yes when the title holds `word`, place yes for a Brussels location."""
    def asker(profile, jobs):
        return {j['n']: {'role': 'yes' if word.lower() in j['title'].lower() else 'no', 'place': 'yes' if 'Brussels' in j['location'] else 'no'} for j in jobs}
    return asker


class TheTable(unittest.TestCase):
    def test_every_persona_has_words_a_region_and_a_serpapi_place_in_its_language(self):
        for n, p in enumerate(reference.PERSONAS, 1):
            ref = p['reference']
            self.assertTrue(ref['words'] and all(isinstance(w, str) and w for w in ref['words']), f'p{n}: role words')
            self.assertRegex(ref['nuts2'], r'^[A-Z]{2}[0-9A-Z]{2}$', f'p{n}')
            self.assertTrue(ref['serp'].endswith(p['country']), f'p{n}: {ref["serp"]}')
            self.assertIn(p['language'], reference.HL, f'p{n}: Google Jobs needs the place\'s language code')


class Reading(unittest.TestCase):
    def test_eures_pages_stop_when_a_page_is_short_and_a_job_listed_twice_counts_once(self):
        pages = []

        def post(body):
            pages.append((body['keywords'][0]['keyword'], body['page'], body['locationCodes']))
            return {'jvs': [job(i) for i in range(3)]}   # short page: the word ends
        with mock.patch('src.sources.nuts_names.names', return_value=NUTS):
            rows = reference.eures_rows(P3, post)
        self.assertEqual([(w, page) for w, page, _ in pages], [('charpentier', 1), ('menuisier', 1)], 'a short page ends its word')
        self.assertEqual(pages[0][2], ['be10', 'be1', 'be100'])
        self.assertEqual(len(rows), 3, 'the same ids from the second word are one job each')
        self.assertEqual((rows[0]['location'], rows[0]['source'], rows[0]['reachable']), ('Brussels-Capital, Belgium', 'eures', True))

    def test_eures_reads_at_most_two_pages_a_word(self):
        calls = []

        def post(body):
            calls.append(body['page'])
            return {'jvs': [job(body['page'] * 100 + i) for i in range(eures.PAGE_SIZE)]}
        with mock.patch('src.sources.nuts_names.names', return_value=NUTS):
            reference.eures_rows(P3, post)
        self.assertEqual(calls, [1, 2, 1, 2])

    def test_google_jobs_is_one_search_in_the_places_language_and_a_sign_in_wall_is_not_reachable(self):
        seen = []

        def get(url, params):
            seen.append(params)
            return {'jobs_results': [serp(1), serp(2, 'https://www.linkedin.com/jobs/view/1')]}
        rows = reference.google_rows(P3, KEY, get)
        self.assertEqual(len(seen), 1)
        self.assertEqual({k: seen[0][k] for k in ('engine', 'q', 'location', 'hl')}, {'engine': 'google_jobs', 'q': 'charpentier', 'location': 'Brussels,Brussels,Belgium', 'hl': 'fr'})
        self.assertEqual([r['reachable'] for r in rows], [True, False])


class Counting(unittest.TestCase):
    def test_a_job_in_both_sources_counts_once_and_is_reachable_if_either_copy_is(self):
        rows = [{'title': 'A', 'company': 'X', 'location': 'Brussels', 'source': 'eures', 'reachable': True, 'role': 'yes', 'place': 'yes'},
                {'title': 'A', 'company': 'X', 'location': 'Brussels', 'source': 'google', 'reachable': False, 'role': 'yes', 'place': 'yes'},
                {'title': 'B', 'company': 'Y', 'location': 'Brussels', 'source': 'google', 'reachable': False, 'role': 'yes', 'place': 'yes'},
                {'title': 'C', 'company': 'Z', 'location': 'Brussels', 'source': 'eures', 'reachable': True, 'role': 'no', 'place': 'yes'}]
        self.assertEqual(reference.tally(rows, True), {'total': 2, 'reachable': 1, 'eures': 1, 'google': 2})

    def test_the_same_posting_in_both_sources_counts_once_although_they_write_the_place_differently(self):
        rows = [{'title': 'Menuisier  H/F', 'company': 'Bois SA', 'location': 'Brussels-Capital, Belgium', 'source': 'eures', 'reachable': True, 'role': 'yes', 'place': 'yes'},
                {'title': 'menuisier h/f', 'company': 'BOIS SA', 'location': 'Brussels, Belgium', 'source': 'google', 'reachable': True, 'role': 'yes', 'place': 'yes'}]
        self.assertEqual(reference.tally(rows, True), {'total': 1, 'reachable': 1, 'eures': 1, 'google': 1})

    def test_an_unread_source_is_null_never_zero(self):
        self.assertEqual(reference.tally([], False), {'total': 0, 'reachable': 0, 'eures': 0, 'google': None})


class TheWeek(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch('src.sources.nuts_names.names', return_value=NUTS)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.serp_calls = []

    def post(self, body):
        return {'jvs': [job(i, title='Menuisier') for i in range(2)]}

    def get(self, url, params):
        self.serp_calls.append(params)
        return {'jobs_results': [serp(1)]}

    def run_week(self, env, state=None, post=None):
        return reference.run(env, post or self.post, self.get, right_if('menuisier'), state)

    def test_without_its_own_key_google_is_not_searched_and_reads_null(self):
        record = self.run_week({})
        self.assertEqual((self.serp_calls, record['google']), ([], 'no key'))
        self.assertEqual(len(record['personas']), 18)
        self.assertTrue(all(row['google'] is None for row in record['personas'].values()))

    def test_with_the_key_it_is_one_search_per_persona_so_18_credits_a_week(self):
        record = self.run_week({'REFERENCE_SERPAPI_KEY': KEY}, state='read')
        self.assertEqual(len(self.serp_calls), 18)
        self.assertEqual(record['google'], 'read')

    @staticmethod
    def account(left):
        body = json.dumps({'total_searches_left': left}).encode()
        return lambda request, timeout=40: mock.MagicMock(__enter__=lambda s: s, __exit__=lambda *a: False, read=lambda *n: body)

    def test_the_week_needs_the_scouts_reserve_plus_one_credit_per_persona(self):
        self.assertEqual(reference.MIN_CREDITS_LEFT, 38)
        for left, state in [(19, 'credits low'), (20, 'credits low'), (37, 'credits low'), (38, 'read'), (500, 'read')]:
            self.assertEqual(reference.google_state(KEY, self.account(left)), state, left)
        self.assertEqual(reference.google_state(''), 'no key')

    def test_an_odd_account_answer_is_failed_never_a_crash(self):
        for odd in (None, 'many', {}):
            self.assertEqual(reference.google_state(KEY, self.account(odd)), 'failed', odd)

    def test_an_eures_error_body_is_not_no_jobs(self):
        record = self.run_week({}, post=lambda body: {'error': 'rate limited'})
        self.assertEqual(record['personas'], {}, 'every persona left out, not 18 zeros')

    def test_a_judge_that_fails_for_one_persona_leaves_that_one_out(self):
        def asker(profile, jobs):
            if 'Carpenter' in profile:
                raise ValueError('the judge left out 2 of 2 jobs')
            return right_if('menuisier')(profile, jobs)
        record = reference.run({}, self.post, self.get, asker, 'no key')
        self.assertEqual(sorted(record['personas']), sorted(str(n) for n in range(1, 19) if n != 3))

    def test_google_that_fails_after_some_personas_read_is_partial(self):
        calls = []

        def flaky(url, params):
            calls.append(1)
            if len(calls) == 3:
                raise OSError('SerpApi is down')
            return {'jobs_results': [serp(len(calls))]}
        record = reference.run({'REFERENCE_SERPAPI_KEY': KEY}, self.post, flaky, right_if('menuisier'), 'read')
        self.assertEqual((len(calls), record['google']), (3, 'partial'))
        self.assertEqual([record['personas'][str(n)]['google'] is None for n in (1, 2, 3, 4)], [False, False, True, True])

    def test_the_first_google_failure_stops_the_searches(self):
        calls = []

        def broken(url, params):
            calls.append(1)
            raise OSError('SerpApi is down')
        record = reference.run({'REFERENCE_SERPAPI_KEY': KEY}, self.post, broken, right_if('menuisier'), 'read')
        self.assertEqual((len(calls), record['google']), (1, 'failed'))
        self.assertEqual(len(record['personas']), 18, 'EURES still counted')

    def test_a_persona_whose_eures_read_failed_is_left_out_never_zero(self):
        def post(body):
            if body['locationCodes'][0].startswith('be'):
                raise OSError('EURES is down')
            return {'jvs': []}
        record = self.run_week({}, post=post)
        self.assertEqual(sorted(record['personas']), sorted(str(n) for n in range(1, 19) if n != 3))

    def test_the_two_phases_meet_in_a_file_that_holds_no_key_and_give_what_one_process_gives(self):
        env = {'REFERENCE_SERPAPI_KEY': KEY}
        doc = reference.read(env, self.post, self.get, 'read')
        text = json.dumps(doc)
        self.assertNotIn(KEY, text, 'phase 2 runs behind the relay and reads this file: no credential in it')
        self.assertEqual(reference.judge_all(json.loads(text), right_if('menuisier')), reference.run(env, self.post, self.get, right_if('menuisier'), 'read'))

    def test_only_title_employer_and_place_reach_the_judge(self):
        seen = []

        def asker(profile, jobs):
            seen.extend(jobs)
            return right_if('menuisier')(profile, jobs)
        reference.run({}, self.post, self.get, asker, 'no key')
        self.assertTrue(seen and all(set(j) == {'n', 'title', 'company', 'location'} for j in seen))


class Sending(unittest.TestCase):
    NOW = datetime(2026, 11, 8, 3, 0, tzinfo=timezone.utc)   # a Sunday: ISO week 45

    def record(self):
        folder = tempfile.mkdtemp()
        path = Path(folder) / 'r.json'
        path.write_text(json.dumps({'personas': {'1': {'total': 31, 'reachable': 24, 'eures': 20, 'google': None}}, 'google': 'no key'}))
        return path

    def env(self, **more):
        return {'CI': 'true', 'GITHUB_REF_NAME': 'main', 'REPLAYS_PUBLISH_KEY': 'k' * 20, 'GITHUB_RUN_ID': '42147413237', **more}

    def test_it_sends_nothing_from_a_laptop_a_branch_or_without_a_key_or_run_id(self):
        path, opener = self.record(), mock.Mock()
        for env, word in [({}, 'local run'), (self.env(GITHUB_REF_NAME='gi-x'), 'branch gi-x'), (self.env(REPLAYS_PUBLISH_KEY=''), 'REPLAYS_PUBLISH_KEY'), (self.env(GITHUB_RUN_ID='abc'), 'run id')]:
            self.assertIn(word, reference.send(path, env, self.NOW, opener))
        opener.assert_not_called()

    def test_a_run_on_main_puts_the_counts_of_this_iso_week(self):
        sent = {}

        def opener(request, timeout=30):
            sent.update(url=request.full_url, method=request.get_method(), body=json.loads(request.data), auth=request.get_header('Authorization'))
            return mock.MagicMock(__enter__=lambda s: s, __exit__=lambda *a: False, read=lambda: b'{"ok": true, "stored": true}')
        line = reference.send(self.record(), self.env(), self.NOW, opener)
        self.assertEqual((sent['method'], sent['url']), ('PUT', 'https://www.jobadabra.top/search-check/reference?week=2026-W45&run=42147413237'))
        self.assertEqual(sent['body'], {'personas': {'1': {'total': 31, 'reachable': 24, 'eures': 20, 'google': None}}})
        self.assertTrue(sent['auth'].startswith('Bearer '))
        self.assertIn('week 2026-W45 stored', line)

    def test_a_refused_upload_is_one_line_never_an_exception(self):
        def refuse(request, timeout=30):
            raise OSError('connection reset')
        self.assertIn('not sent', reference.send(self.record(), self.env(), self.NOW, refuse))


if __name__ == '__main__':
    unittest.main()
