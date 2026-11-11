"""Guard: release — the night's right jobs per source of our list (finish-line G6): a source that loses its jobs must show as a lower number under its own
word, never hidden inside another word, credited to whichever reader the store kept, or shown as a zero it did not measure; and this report never costs the night.
tools/persona-search/sources_count.py + gate.extract's stored kind and "also on" readers."""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'tools/persona-search'))
import gate  # noqa: E402
import sources_count as sc  # noqa: E402

FREE = {'arbeitnow', 'himalayas', 'jobicy', 'jobs.ch'}


def right(title, provider, kind, url='', also=(), company='Acme', location='Lyon'):
    return {'title': title, 'company': company, 'location': location, 'provider': provider, 'kind': kind, 'url': url, 'also': [list(a) for a in also],
            'role': 'yes', 'place': 'yes'}


def stored(readers):
    """Jobs written through the real store (src/store.py upsert_job), then gate.extract's rows judged right: [(title, url, reader, kind)]."""
    from src import store
    with tempfile.TemporaryDirectory() as tmp:
        db = store.connect(os.path.join(tmp, 'jobs.sqlite'))
        for title, url, reader, kind in readers:
            store.upsert_job(db, {'company': 'Acme', 'title': title, 'url': url, 'location': 'Lyon'}, reader, source_kind=kind)
        db.commit()
        db.close()
        rows = gate.extract(os.path.join(tmp, 'jobs.sqlite'), os.path.join(tmp, 'jobs.json'), include_urls=True)
    return [{**row, 'role': 'yes', 'place': 'yes'} for row in rows]


class Word(unittest.TestCase):
    def test_each_reader_gets_its_fixed_word(self):
        cases = [(('EURES', 'job board', ''), 'eures'), (('x', 'job board', 'https://eures.europa.eu/jobs/1'), 'eures'),
                 (('LinkedIn Jobs', 'job board', ''), 'linkedin'), (('LinkedIn', 'employer feed', ''), 'employer_sites'),
                 (('Acme careers', 'employer feed', ''), 'employer_sites'), (('Himalayas', 'job board', ''), 'free_job_apis'),
                 (('Arbeitnow', 'job board', ''), 'free_job_apis'), (('Job boards found', 'job board', ''), 'job_boards'), (('Some board', 'job board', ''), 'job_boards'),
                 (('Indeed alert', 'job board', ''), 'other'), (('odd', 'something new', ''), 'other'),
                 (('mine', 'you', ''), None), (('mine', 'manual', ''), None), (('Imported link', 'job board', ''), None)]
        for (name, kind, url), want in cases:
            self.assertEqual(sc.word(name, kind, url, FREE), want, name)

    def test_without_the_reader_list_a_free_api_is_never_guessed(self):
        self.assertEqual(sc.word('Himalayas', 'job board', '', None), 'job_boards')

    def test_the_free_apis_are_in_the_engines_list(self):
        self.assertTrue({'arbeitnow', 'himalayas', 'jobicy'} <= (sc.free_api_names() or set()), 'read from src/sources/aggregators.py')


class Count(unittest.TestCase):
    def test_a_job_two_readers_brought_counts_for_both_and_only_for_neither(self):
        rows = stored([('Cook', 'https://himalayas.example/1', 'Himalayas', 'job board'), ('Cook', 'https://acme.example/jobs/cook', 'Acme careers', 'employer feed'),
                       ('Chef', 'https://acme.example/jobs/chef', 'Acme careers', 'employer feed')])
        self.assertEqual(len(rows), 2, 'the store keeps one row for the job both readers listed')
        out = sc.count(rows, [{'step': 'employer_sites', 'fit70': 5, 'local_fit70': 3, 'seconds': 40}], FREE, set())
        self.assertEqual(out['free_job_apis'], {'right': 1, 'only': 0, 'fit70': None, 'seconds': None})
        self.assertEqual(out['employer_sites'], {'right': 2, 'only': 1, 'fit70': 3, 'seconds': 40}, 'the "also on" reader counts: not only the kept one')

    def test_one_job_listed_twice_is_one_right_job(self):
        rows = [right('Cook', 'Some board', 'job board'), right('Cook', 'Other board', 'job board')]
        self.assertEqual(sc.count(rows, [], FREE, set())['job_boards'], {'right': 1, 'only': 1, 'fit70': None, 'seconds': None})

    def test_web_search_by_host_and_wrong_place_not_counted(self):
        rows = [right('Waiter', 'Job boards found', 'job board', 'https://fr.localjobs.example/w/1'), right('Porter', 'Job boards found', 'job board', 'https://other.example/p'),
                {**right('Baker', 'Job boards found', 'job board', 'https://www.localjobs.example/b'), 'place': 'no'}, right('Mine', 'you', 'you')]
        out = sc.count(rows, [], FREE, {'localjobs.example'})
        self.assertEqual(out['web_search'], {'right': 1, 'only': 1, 'fit70': None, 'seconds': None}, 'a subdomain of a web-found board counts; a wrong place never')
        self.assertEqual(out['job_boards']['right'], 2)
        self.assertNotIn('linkedin', out, 'the word appears once LinkedIn jobs are judged right')
        self.assertEqual(sum(v['right'] for k, v in out.items() if 'right' in v and k != 'web_search'), 2, "the person's own adds are left out")

    def test_unknown_split_and_unmeasured_web_say_so_never_zero(self):
        out = sc.count([right('Baker', 'Himalayas', 'job board'), right('Chef', 'Some board', 'job board')], [], None, None)
        self.assertEqual(out['free_job_apis'], {'status': 'inside job_boards'})
        self.assertEqual(out['job_boards']['right'], 2, 'the free API job counted under job_boards')
        self.assertEqual(out['web_search'], {'status': 'not measured'})

    def test_a_malformed_link_is_no_crash(self):
        self.assertEqual(sc.count([right('Cook', 'Some board', 'job board', 'http://[bad/x')], [], FREE, {'b.example'})['job_boards']['right'], 1)


class Files(unittest.TestCase):
    def write(self, folder, name, data):
        Path(folder, name).write_text(json.dumps(data), encoding='utf-8')

    def test_web_search_is_measured_only_when_one_ran(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertIsNone(sc.web_boards(tmp), 'no file')
            self.write(tmp, 'found-boards.json', {'ideas': {'k': [{'host': 'b.example', 'origin': 'web'}]}})
            self.assertIsNone(sc.web_boards(tmp), 'no web_used: no web search ran, so "not measured", never 0')
            self.write(tmp, 'found-boards.json', {'web_used': {'k': '2026-11-10T22:00:00'}, 'ideas': {'k': [{'host': 'www.b.example', 'origin': 'web'}, {'host': 'c.example'}]}})
            self.assertEqual(sc.web_boards(tmp), {'b.example'})

    def test_annotate_counts_and_never_raises_on_odd_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            good, odd, empty = (Path(tmp, f'search-personas-p{n}') for n in (1, 2, 3))
            for folder in (good, odd, empty):
                folder.mkdir()
            self.write(good, 'result.json', {'persona': 1, 'step_yield': []})
            self.write(good, 'judged.json', {'rows': [right('Cook', 'EURES', 'job board')]})
            self.write(odd, 'result.json', {'persona': 2})
            self.write(odd, 'judged.json', {'rows': {'not': 'a list'}})
            self.write(odd, 'found-boards.json', {'web_used': {'k': 'x'}, 'ideas': ['a list']})
            self.write(empty, 'result.json', {'persona': 3, 'not_measured': 'not run: queue'})
            self.assertEqual(sc.annotate(tmp), [1])
            self.assertEqual(json.loads(Path(good, 'result.json').read_text(encoding='utf-8'))['sources']['eures']['right'], 1)
            for folder in (odd, empty):
                self.assertNotIn('sources', json.loads(Path(folder, 'result.json').read_text(encoding='utf-8')), 'nothing claimed for a row it could not read')

    def test_the_verdict_rows_carry_what_the_admin_reads(self):
        """11 Nov 2026: sources_count.py wrote `sources` on each result, gate.compare built rows from a fixed field list without it, and the Admin Sources card
        (it reads verdict rows) said "No run has sent per-source counts". One loop over the fields the Admin reads: each one a result carries must reach its row."""
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp, 'search-personas-p1')
            folder.mkdir()
            self.write(folder, 'result.json', {'persona': 1, 'step_yield': [], 'counters': {'sites': 1}, 'relevant_sources': {'other': 1}, 'place': {'yes': 1}, 'role': {'yes': 1}, 'scout': {'served': 4, 'in_places': 3}})
            self.write(folder, 'judged.json', {'rows': [right('Cook', 'Acme', 'employer feed')]})
            sc.annotate(tmp)
            result = json.loads(Path(folder, 'result.json').read_text(encoding='utf-8'))
        row = gate.compare({1: result}, [])['rows'][0]
        for field in ('sources', 'scout', 'step_yield', 'counters', 'relevant_sources', 'place', 'role'):
            self.assertIsNotNone(result.get(field), f'the fixture result carries {field}')
            self.assertEqual(row[field], result[field], f'the verdict row passes {field} on to the Admin')
        self.assertEqual(row['sources']['employer_sites']['right'], 1)

    def test_the_night_step_is_report_only(self):
        text = (ROOT / '.github/workflows/search-personas.yml').read_text(encoding='utf-8')
        step = text[text.index('- name: Right jobs per source of our list (G6)'):text.index('- name: Compare with the earlier runs')]
        self.assertIn('continue-on-error: true', step)


if __name__ == '__main__':
    unittest.main()
