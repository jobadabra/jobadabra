"""Guard: data — the weekly reference is the yardstick of the Admin Night search tab ("found 7 of 24 reachable"): a failed EURES read or judge must leave a candidate OUT (the tab then says "no reference"), never
store a wrong 0; a posting counts once; only counts leave, and only from a CI run on main. EURES only (owner, 6 Nov 2026: the SerpApi quota is the central scout's alone): nothing here may call SerpApi or Google.
Fakes only: no EURES, broker or Admin is called here."""
import json
import re
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


def job(i, title='Menuisier', code='BE100', employer='ACME'):
    return {'id': f'j{i}', 'title': f'{title} {i}', 'employer': {'name': employer}, 'locationMap': {'BE': [code]}}


def NO_BOARD(n, words):
    """A board reader for a country with no board row: no network in these tests."""
    return {'source': 'public_board', 'board': None, 'status': 'none (no board)', 'rows': []}


def NO_WEB(persona):
    """A web search outside the relay: never an AI call in these tests."""
    return {'source': 'web_search', 'status': 'not counted: ValueError', 'rows': []}


def setUpModule():
    patcher = mock.patch.object(reference.market_web, 'read', NO_WEB)
    patcher.start()
    unittest.addModuleCleanup(patcher.stop)


def right_if(word):
    """A fake blind judge: role yes when the title holds `word`, place yes for a Brussels location."""
    def asker(profile, jobs):
        return {j['n']: {'role': 'yes' if word.lower() in j['title'].lower() else 'no', 'place': 'yes' if 'Brussels' in j['location'] else 'no'} for j in jobs}
    return asker


class TheTable(unittest.TestCase):
    def test_every_persona_has_role_words_and_a_nuts2_region_of_its_country(self):
        for n, p in enumerate(reference.PERSONAS, 1):
            ref = p['reference']
            self.assertTrue(ref['words'] and all(isinstance(w, str) and w for w in ref['words']), f'p{n}: role words')
            self.assertRegex(ref['nuts2'], r'^[A-Z]{2}[0-9A-Z]{2}$', f'p{n}')
            self.assertNotIn('serp', ref, f'p{n}: no SerpApi place: the quota is the central scout\'s alone')


class Reading(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch('src.sources.nuts_names.names', return_value=NUTS)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_pages_stop_when_a_page_is_short_and_a_posting_listed_twice_counts_once(self):
        pages = []

        def post(body):
            pages.append((body['keywords'][0]['keyword'], body['page'], body['locationCodes']))
            return {'jvs': [job(i) for i in range(3)]}   # a short page: the word ends
        rows = reference.eures_rows(P3, post)
        self.assertEqual([(w, page) for w, page, _ in pages], [('charpentier', 1), ('menuisier', 1)])
        self.assertEqual(pages[0][2], ['be10', 'be1', 'be100'])
        self.assertEqual(len(rows), 3, 'the same ids from the second word are one job each')
        self.assertEqual(rows[0], {'title': 'Menuisier 0', 'company': 'ACME', 'location': 'Brussels-Capital, Belgium', 'url': eures.DETAIL + 'j0?lang=en'})

    def test_it_reads_at_most_two_pages_a_word(self):
        calls = []

        def post(body):
            calls.append(body['page'])
            return {'jvs': [job(body['page'] * 100 + i) for i in range(eures.PAGE_SIZE)]}
        reference.eures_rows(P3, post)
        self.assertEqual(calls, [1, 2, 1, 2])

    def test_an_answer_without_a_job_list_is_an_error_not_no_jobs(self):
        for odd in ({'error': 'rate limited'}, {'jvs': None}, [], None):
            with self.assertRaises(ValueError, msg=repr(odd)):
                reference.eures_rows(P3, lambda body, odd=odd: odd)


class Counting(unittest.TestCase):
    def test_a_posting_listed_twice_counts_once_and_only_a_right_role_in_the_right_place_counts(self):
        rows = [{'title': 'Menuisier  H/F', 'company': 'Bois SA', 'location': 'Brussels-Capital, Belgium', 'role': 'yes', 'place': 'yes'},
                {'title': 'menuisier h/f', 'company': 'BOIS SA', 'location': 'Brussels, Belgium', 'role': 'yes', 'place': 'yes'},
                {'title': 'Comptable', 'company': 'Z', 'location': 'Brussels', 'role': 'no', 'place': 'yes'},
                {'title': 'Menuisier', 'company': 'Y', 'location': 'Liege', 'role': 'yes', 'place': 'no'}]
        self.assertEqual(reference.tally(rows), {'total': 1, 'reachable': 1, 'eures': 1, 'public_board': None, 'web_search': None, 'market': 1})
        self.assertEqual(reference.tally([]), {'total': 0, 'reachable': 0, 'eures': 0, 'public_board': None, 'web_search': None, 'market': 0})


class TheWeek(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch('src.sources.nuts_names.names', return_value=NUTS)
        patcher.start()
        self.addCleanup(patcher.stop)

    @staticmethod
    def post(body):
        return {'jvs': [job(i) for i in range(2)]}

    def test_every_persona_gets_a_record_and_the_record_holds_counts_only(self):
        record = reference.run(self.post, right_if('menuisier'), boards=NO_BOARD)
        self.assertEqual(sorted(record['personas'], key=int), [str(n) for n in range(1, 19)])
        self.assertEqual(set(record), {'personas'})
        self.assertEqual(record['personas']['3'], {'total': 2, 'reachable': 2, 'eures': 2, 'public_board': None, 'web_search': None, 'market': 2})
        self.assertEqual(set(record['personas']['3']), {'total', 'reachable', 'eures', 'public_board', 'web_search', 'market'})

    def test_the_right_jobs_keys_stay_beside_the_record_and_are_never_part_of_it(self):
        """WP3 (10 Nov 2026): a night's loss is matched job by job, so the artifact keeps each right job's title, employer and link; the record (the only thing sent) is unchanged."""
        jobs = {}
        record = reference.run(self.post, right_if('menuisier'), jobs, boards=NO_BOARD)
        self.assertEqual(set(record), {'personas'})
        self.assertEqual(set(record['personas']['3']), {'total', 'reachable', 'eures', 'public_board', 'web_search', 'market'})
        self.assertEqual(len(jobs['3']), record['personas']['3']['total'], 'one key per right job, a posting listed twice once')
        self.assertTrue(all(set(j) == {'title', 'company', 'url', 'sources'} and j['url'].startswith(eures.DETAIL) and j['sources'] == ['eures'] for j in jobs['3']))
        self.assertTrue(all('menuisier' in j['title'].lower() for j in jobs['3']), 'only the jobs the judge called right')

    def test_a_persona_whose_eures_read_failed_is_left_out_never_zero(self):
        def post(body):
            if body['locationCodes'][0].startswith('be'):
                raise OSError('EURES is down')
            return {'jvs': []}
        record = reference.run(post, right_if('menuisier'), boards=NO_BOARD)
        self.assertEqual(sorted(record['personas'], key=int), [str(n) for n in range(1, 19) if n != 3])

    def test_a_judge_that_fails_for_one_persona_leaves_that_one_out(self):
        def asker(profile, jobs):
            if 'Carpenter' in profile:
                raise ValueError('the judge left out 2 of 2 jobs')
            return right_if('menuisier')(profile, jobs)
        record = reference.run(self.post, asker, boards=NO_BOARD)
        self.assertEqual(sorted(record['personas'], key=int), [str(n) for n in range(1, 19) if n != 3])

    def test_only_title_employer_and_place_reach_the_judge(self):
        seen = []

        def asker(profile, jobs):
            seen.extend(jobs)
            return right_if('menuisier')(profile, jobs)
        reference.run(self.post, asker, boards=NO_BOARD)
        self.assertTrue(seen and all(set(j) == {'n', 'title', 'company', 'location'} for j in seen))

    def test_nothing_in_the_tool_or_its_workflow_touches_serpapi_or_google(self):
        for path in (ROOT / 'tools' / 'persona-search' / 'reference.py', ROOT / '.github' / 'workflows' / 'search-reference.yml'):
            code = re.sub(r'"""[\s\S]*?"""', '', path.read_text(encoding='utf-8'))   # docstrings and comments may say why; code may not call it
            code = '\n'.join(re.sub(r'\s#.*$', '', line) for line in code.splitlines() if not line.lstrip().startswith('#'))
            self.assertIsNone(re.search(r'serp|google_jobs|REFERENCE_SERPAPI|CENTRAL_SCOUT', code, re.I), path.name)


class TheMarket(unittest.TestCase):
    """The market count (sa's finish-line plan WP2, 10 Nov 2026): EURES and the person's national board are judged in one pass; total = the distinct right jobs of every counted source,
    each source's own count beside it; a source that was not counted is None, never 0, and never ends the other."""
    def setUp(self):
        patcher = mock.patch('src.sources.nuts_names.names', return_value=NUTS)
        patcher.start()
        self.addCleanup(patcher.stop)

    @staticmethod
    def board(status='counted', titles=('Menuisier 0', 'Menuisier 9')):
        def read(n, words):
            rows = [{'title': t, 'company': 'ACME', 'location': 'Brussels', 'url': f'https://board.example/{i}'} for i, t in enumerate(titles)] if n == 3 and status == 'counted' else []
            return {'source': 'public_board', 'board': 'board.example' if n == 3 else None, 'status': status if n == 3 else 'none (no board)', 'rows': rows}
        return read

    def test_a_job_two_sources_show_counts_once_and_each_source_keeps_its_own_count(self):
        jobs, details = {}, {}
        record = reference.run(lambda body: {'jvs': [job(i) for i in range(2)]}, right_if('menuisier'), jobs, boards=self.board(), details=details)
        self.assertEqual(record['personas']['3'], {'total': 2, 'reachable': 2, 'eures': 2, 'public_board': 2, 'web_search': None, 'market': 3}, 'total keeps meaning EURES: Admin labels it so')
        self.assertEqual({j['title']: j['sources'] for j in jobs['3']}, {'Menuisier 0': ['eures', 'public_board'], 'Menuisier 1': ['eures'], 'Menuisier 9': ['public_board']})
        self.assertEqual(details['3']['public_board'], {'status': 'counted', 'read': 2, 'board': 'board.example', 'pages': 0, 'right': 2, 'only': 1})
        self.assertEqual((details['3']['eures']['right'], details['3']['eures']['only']), (2, 1))
        self.assertEqual(details['3']['market'], 3)
        self.assertEqual(details['3']['free_job_apis'], {'status': 'none (no query)'})
        self.assertEqual(details['3']['linkedin'], {'status': 'by hand'})

    def test_a_web_search_is_judged_in_the_same_pass_and_a_job_it_shares_counts_once(self):
        """[mc] 3/5: the web search's postings go to the one blind judge pass; one it shares with the board is one job in the market and adds to neither's `only`."""
        def web(persona):
            rows = [{'title': t, 'company': 'ACME', 'location': loc, 'url': f'https://web.example/{i}'} for i, (t, loc) in enumerate((('Menuisier 9', 'Brussels'), ('Menuisier 7', 'Brussels'), ('Menuisier 8', 'Ghent')))]
            return {'source': 'web_search', 'status': 'counted', 'rows': rows if persona is P3 else []}
        jobs, details = {}, {}
        record = reference.run(lambda body: {'jvs': [job(i) for i in range(2)]}, right_if('menuisier'), jobs, boards=self.board(), details=details, web=web)
        self.assertEqual(record['personas']['3'], {'total': 2, 'reachable': 2, 'eures': 2, 'public_board': 2, 'web_search': 2, 'market': 4}, 'Ghent is the wrong place')
        self.assertEqual({j['title']: j['sources'] for j in jobs['3']}['Menuisier 9'], ['public_board', 'web_search'])
        self.assertEqual(details['3']['web_search'], {'status': 'counted', 'read': 3, 'right': 2, 'only': 1})
        self.assertEqual(details['3']['public_board']['only'], 0, 'the job the web search also found is no longer the board alone')

    def test_a_web_search_that_failed_or_raised_is_not_counted_and_ends_nothing_else(self):
        def failed(persona):
            return {'source': 'web_search', 'status': 'not counted: HTTPError', 'rows': []}

        def raised(persona):
            raise RuntimeError('relay gone')
        for web, status in ((failed, 'not counted: HTTPError'), (raised, 'not counted: RuntimeError')):
            details = {}
            record = reference.run(lambda body: {'jvs': [job(i) for i in range(2)]}, right_if('menuisier'), boards=self.board(), details=details, web=web)
            self.assertEqual(len(record['personas']), 18)
            self.assertEqual((record['personas']['3']['web_search'], record['personas']['3']['market']), (None, 3), 'not counted is None, never 0')
            self.assertEqual(details['3']['web_search'], {'status': status, 'read': 0})

    def test_a_refused_board_is_not_counted_and_the_market_is_eures_alone(self):
        details = {}
        record = reference.run(lambda body: {'jvs': [job(i) for i in range(2)]}, right_if('menuisier'), boards=self.board('not counted: refused 403'), details=details)
        self.assertEqual(record['personas']['3'], {'total': 2, 'reachable': 2, 'eures': 2, 'public_board': None, 'web_search': None, 'market': 2})
        self.assertNotIn('right', details['3']['public_board'])

    def test_a_board_that_raises_is_not_counted_and_ends_nothing_else(self):
        """Review of [mc] 1/5: a connection cut mid-page (http.client.IncompleteRead) went up through run() and lost all 18 references."""
        def board(n, words):
            raise RuntimeError('connection cut')
        details = {}
        record = reference.run(lambda body: {'jvs': [job(i) for i in range(2)]}, right_if('menuisier'), boards=board, details=details)
        self.assertEqual(len(record['personas']), 18)
        self.assertEqual(details['3']['public_board']['status'], 'not counted: RuntimeError')
        self.assertIsNone(record['personas']['3']['public_board'])

    def test_when_eures_failed_the_board_still_counts_in_the_artifact_and_the_sent_record_leaves_the_person_out(self):
        def post(body):
            raise OSError('EURES is down')
        jobs, details = {}, {}
        record = reference.run(post, right_if('menuisier'), jobs, boards=self.board(), details=details)
        self.assertEqual(record['personas'], {}, 'total means EURES on Admin: no EURES read, no record (never 0)')
        self.assertEqual((details['3']['public_board']['right'], details['3']['market'], details['3']['eures']['status']), (2, 2, 'not counted: OSError'))
        self.assertEqual(len(jobs['3']), 2)


class TheCommandLine(unittest.TestCase):
    """The first run of the CLI was the real run (6 Nov 2026, run 42191804037): `run out/reference.json` crashed with FileNotFoundError after a 6-minute read because nothing made `out/`
    (the workflow's `mkdir -p out` ran BEFORE actions/checkout, whose clean removed it). The tool makes its own output folder, and before it reads anything."""

    def test_run_writes_into_a_folder_that_does_not_exist_yet_and_makes_it_before_the_long_read(self):
        folder = Path(tempfile.mkdtemp()) / 'out' / 'deeper'
        seen = []

        def fake_run(jobs=None, details=None):
            seen.append(folder.is_dir())   # the folder is there before the read starts
            jobs['1'] = []
            return {'personas': {'1': {'total': 0, 'reachable': 0, 'eures': 0}}}
        with mock.patch.object(reference, 'run', fake_run):
            self.assertEqual(reference.main(['run', str(folder / 'reference.json')]), 0)
        self.assertEqual(seen, [True])
        self.assertEqual(json.loads((folder / 'reference.json').read_text()), {'personas': {'1': {'total': 0, 'reachable': 0, 'eures': 0}}})
        beside = json.loads((folder / 'reference-jobs.json').read_text())
        self.assertEqual(beside['personas'], {'1': []}, 'the keys beside the counts, in their own file')
        self.assertEqual(set(beside), {'personas', 'sources', 'counted_on'}, 'per-source detail and the date of the count stay in the artifact too')

    def test_the_siblings_make_their_own_output_folder_too(self):
        """The same pattern in gate.py extract and gate_judge.py main: they worked in the nightly only because an earlier step had made `out/`."""
        import gate
        import gate_judge
        folder = Path(tempfile.mkdtemp()) / 'fresh'
        gate.extract(str(folder / 'no.sqlite'), str(folder / 'jobs.json'))
        self.assertEqual(json.loads((folder / 'jobs.json').read_text()), [])
        jobs = folder.parent / 'in.json'
        jobs.write_text('[]')
        seen = []

        def fake_judge(n, pool):
            seen.append((folder.parent / 'other').is_dir())   # the paid call: the folder must already be there
            return {'rows': [], 'usd': 0, 'judged_jobs': 0}
        with mock.patch.object(gate_judge, 'judge', fake_judge):
            gate_judge.main(['1', str(jobs), str(folder.parent / 'other' / 'judged.json')])
        self.assertEqual(seen, [True], 'a bad output path must fail before the paid judge call, not after it')
        self.assertTrue((folder.parent / 'other' / 'judged.json').exists())

    def test_the_workflow_makes_out_after_the_checkout_that_would_wipe_it(self):
        text = (ROOT / '.github' / 'workflows' / 'search-reference.yml').read_text(encoding='utf-8')
        self.assertGreater(text.index('mkdir -p out'), text.index('actions/checkout'), 'checkout cleans untracked folders: a mkdir before it is lost')

    def test_a_total_of_zero_is_stored_as_zero_not_left_out(self):
        """EURES listing nothing for a region and role is a measurement ("EURES lists none"); only a failed read or judge leaves a candidate out."""
        def post(body):
            return {'jvs': []}
        with mock.patch('src.sources.nuts_names.names', return_value=NUTS):
            record = reference.run(post, right_if('menuisier'), boards=NO_BOARD)
        self.assertEqual(record['personas']['3'], {'total': 0, 'reachable': 0, 'eures': 0, 'public_board': None, 'web_search': None, 'market': 0})
        self.assertEqual(len(record['personas']), 18)


class Sending(unittest.TestCase):
    NOW = datetime(2026, 11, 8, 3, 0, tzinfo=timezone.utc)   # a Sunday: ISO week 45

    def record(self):
        path = Path(tempfile.mkdtemp()) / 'r.json'
        path.write_text(json.dumps({'personas': {'1': {'total': 31, 'reachable': 31, 'eures': 31}}}))
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
            return mock.MagicMock(__enter__=lambda s: s, __exit__=lambda *a: False, read=lambda *n: b'{"ok": true, "stored": true}')
        line = reference.send(self.record(), self.env(), self.NOW, opener)
        self.assertEqual((sent['method'], sent['url']), ('PUT', 'https://www.jobadabra.top/search-check/reference?week=2026-W45&run=42147413237'))
        self.assertEqual(sent['body'], {'personas': {'1': {'total': 31, 'reachable': 31, 'eures': 31}}})
        self.assertTrue(sent['auth'].startswith('Bearer '))
        self.assertIn('week 2026-W45 stored', line)

    def test_the_upload_carries_a_named_user_agent_the_default_urllib_one_is_refused_by_the_edge(self):
        """Run 42299710525 (6 Nov 2026): the site's edge answered 403 to `Python-urllib/3.12`, so the weekly record was not stored; a named client reaches the Worker."""
        seen = {}

        def opener(request, timeout=30):
            seen['agent'] = request.get_header('User-agent')
            return mock.MagicMock(__enter__=lambda s: s, __exit__=lambda *a: False, read=lambda *n: b'{"ok": true, "stored": true}')
        reference.send(self.record(), self.env(), self.NOW, opener)
        self.assertTrue(seen['agent'], 'no User-Agent set: urllib would send its default, which the edge refuses with a 403')
        self.assertNotIn('urllib', seen['agent'].lower())

    def test_a_refused_upload_is_one_line_never_an_exception(self):
        def refuse(request, timeout=30):
            raise OSError('connection reset')
        self.assertIn('not sent', reference.send(self.record(), self.env(), self.NOW, refuse))


if __name__ == '__main__':
    unittest.main()
