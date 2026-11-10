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
        self.assertEqual(reference.tally(rows), {'total': 1, 'reachable': 1, 'eures': 1})
        self.assertEqual(reference.tally([]), {'total': 0, 'reachable': 0, 'eures': 0})


class TheWeek(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch('src.sources.nuts_names.names', return_value=NUTS)
        patcher.start()
        self.addCleanup(patcher.stop)

    @staticmethod
    def post(body):
        return {'jvs': [job(i) for i in range(2)]}

    def test_every_persona_gets_a_record_and_the_record_holds_counts_only(self):
        record = reference.run(self.post, right_if('menuisier'))
        self.assertEqual(sorted(record['personas'], key=int), [str(n) for n in range(1, 19)])
        self.assertEqual(set(record), {'personas'})
        self.assertEqual(record['personas']['3'], {'total': 2, 'reachable': 2, 'eures': 2})
        self.assertEqual(set(record['personas']['3']), {'total', 'reachable', 'eures'})

    def test_the_right_jobs_keys_stay_beside_the_record_and_are_never_part_of_it(self):
        """WP3 (10 Nov 2026): a night's loss is matched job by job, so the artifact keeps each right job's title, employer and link; the record (the only thing sent) is unchanged."""
        jobs = {}
        record = reference.run(self.post, right_if('menuisier'), jobs)
        self.assertEqual(set(record), {'personas'})
        self.assertEqual(set(record['personas']['3']), {'total', 'reachable', 'eures'})
        self.assertEqual(len(jobs['3']), record['personas']['3']['total'], 'one key per right job, a posting listed twice once')
        self.assertTrue(all(set(j) == {'title', 'company', 'url'} and j['url'].startswith(eures.DETAIL) for j in jobs['3']))
        self.assertTrue(all('menuisier' in j['title'].lower() for j in jobs['3']), 'only the jobs the judge called right')

    def test_a_persona_whose_eures_read_failed_is_left_out_never_zero(self):
        def post(body):
            if body['locationCodes'][0].startswith('be'):
                raise OSError('EURES is down')
            return {'jvs': []}
        record = reference.run(post, right_if('menuisier'))
        self.assertEqual(sorted(record['personas'], key=int), [str(n) for n in range(1, 19) if n != 3])

    def test_a_judge_that_fails_for_one_persona_leaves_that_one_out(self):
        def asker(profile, jobs):
            if 'Carpenter' in profile:
                raise ValueError('the judge left out 2 of 2 jobs')
            return right_if('menuisier')(profile, jobs)
        record = reference.run(self.post, asker)
        self.assertEqual(sorted(record['personas'], key=int), [str(n) for n in range(1, 19) if n != 3])

    def test_only_title_employer_and_place_reach_the_judge(self):
        seen = []

        def asker(profile, jobs):
            seen.extend(jobs)
            return right_if('menuisier')(profile, jobs)
        reference.run(self.post, asker)
        self.assertTrue(seen and all(set(j) == {'n', 'title', 'company', 'location'} for j in seen))

    def test_nothing_in_the_tool_or_its_workflow_touches_serpapi_or_google(self):
        for path in (ROOT / 'tools' / 'persona-search' / 'reference.py', ROOT / '.github' / 'workflows' / 'search-reference.yml'):
            code = re.sub(r'"""[\s\S]*?"""', '', path.read_text(encoding='utf-8'))   # docstrings and comments may say why; code may not call it
            code = '\n'.join(re.sub(r'\s#.*$', '', line) for line in code.splitlines() if not line.lstrip().startswith('#'))
            self.assertIsNone(re.search(r'serp|google_jobs|REFERENCE_SERPAPI|CENTRAL_SCOUT', code, re.I), path.name)


class TheCommandLine(unittest.TestCase):
    """The first run of the CLI was the real run (6 Nov 2026, run 42191804037): `run out/reference.json` crashed with FileNotFoundError after a 6-minute read because nothing made `out/`
    (the workflow's `mkdir -p out` ran BEFORE actions/checkout, whose clean removed it). The tool makes its own output folder, and before it reads anything."""

    def test_run_writes_into_a_folder_that_does_not_exist_yet_and_makes_it_before_the_long_read(self):
        folder = Path(tempfile.mkdtemp()) / 'out' / 'deeper'
        seen = []

        def fake_run(jobs=None):
            seen.append(folder.is_dir())   # the folder is there before the read starts
            jobs['1'] = []
            return {'personas': {'1': {'total': 0, 'reachable': 0, 'eures': 0}}}
        with mock.patch.object(reference, 'run', fake_run):
            self.assertEqual(reference.main(['run', str(folder / 'reference.json')]), 0)
        self.assertEqual(seen, [True])
        self.assertEqual(json.loads((folder / 'reference.json').read_text()), {'personas': {'1': {'total': 0, 'reachable': 0, 'eures': 0}}})
        self.assertEqual(json.loads((folder / 'reference-jobs.json').read_text()), {'personas': {'1': []}}, 'the keys beside the counts, in their own file')

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
            record = reference.run(post, right_if('menuisier'))
        self.assertEqual(record['personas']['3'], {'total': 0, 'reachable': 0, 'eures': 0})
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
