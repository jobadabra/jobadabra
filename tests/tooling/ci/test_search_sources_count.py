"""Guard: release — the night's right jobs per source of our list (finish-line G6): a source that loses its jobs must show as a lower number under its own
word, never hidden inside another word or shown as a zero it did not measure. tools/persona-search/sources_count.py + gate.extract's stored source kind."""
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


def job(title, provider, kind, url='', company='Acme'):
    return {'title': title, 'company': company, 'provider': provider, 'kind': kind, 'url': url}


def right(title, company='Acme'):
    return {'title': title, 'company': company, 'role': 'yes', 'place': 'yes'}


class Word(unittest.TestCase):
    def test_each_stored_source_gets_its_fixed_word(self):
        cases = [(job('a', 'EURES', 'job board'), 'eures'), (job('b', 'x', 'job board', 'https://eures.europa.eu/jobs/1'), 'eures'),
                 (job('c', 'LinkedIn', 'job board'), 'linkedin'), (job('d', 'Acme careers', 'employer feed'), 'employer_sites'),
                 (job('e', 'Himalayas', 'job board'), 'free_job_apis'), (job('f', 'Job boards found', 'job board'), 'job_boards'),
                 (job('g', 'Some board', 'job board'), 'job_boards'), (job('h', 'mine', 'you'), None), (job('i', 'mine', 'manual'), None),
                 (job('j', 'odd', 'something new'), 'other')]
        for row, want in cases:
            self.assertEqual(sc.word(row, FREE), want, row)

    def test_without_the_reader_list_a_free_api_is_never_guessed(self):
        self.assertEqual(sc.word(job('e', 'Himalayas', 'job board'), None), 'job_boards')


class Count(unittest.TestCase):
    STEPS = [{'step': 'employer_sites', 'fit70': 3, 'seconds': 40}, {'step': 'job_boards', 'fit70': 1, 'seconds': 70}, {'step': 'scoring', 'fit70': 9}]

    def test_right_only_and_the_steps_numbers(self):
        listed = [job('Cook', 'EURES', 'job board'), job('Cook', 'Acme careers', 'employer feed'),          # one job, two readers: right for both, only for neither
                  job('Chef', 'Acme careers', 'employer feed'), job('Baker', 'Himalayas', 'job board'),
                  job('Waiter', 'Job boards found', 'job board', 'https://www.localjobs.example/w/1'), job('Mine', 'you', 'you'),
                  job('Porter', 'Job boards found', 'job board', 'https://other.example/p')]
        judged = [right('Cook'), right('Chef'), right('Baker'), right('Waiter'), right('Mine'), {**right('Porter'), 'place': 'no'}]
        out = sc.count(listed, judged, self.STEPS, FREE, {'localjobs.example'})
        self.assertEqual(out['eures'], {'right': 1, 'only': 0, 'fit70': None, 'seconds': None})
        self.assertEqual(out['employer_sites'], {'right': 2, 'only': 1, 'fit70': 3, 'seconds': 40})
        self.assertEqual(out['free_job_apis'], {'right': 1, 'only': 1, 'fit70': None, 'seconds': None})
        self.assertEqual(out['job_boards'], {'right': 1, 'only': 1, 'fit70': 1, 'seconds': 70}, 'the wrong-place Porter is not right')
        self.assertEqual(out['web_search'], {'right': 1, 'only': 1, 'fit70': None, 'seconds': None}, 'a web-found board host, www. dropped')
        self.assertEqual(out['other'], {'right': 0, 'only': 0, 'fit70': None, 'seconds': None})
        self.assertNotIn('linkedin', out, 'the word appears once LinkedIn jobs are kept')
        self.assertNotIn('you', json.dumps(out), "the person's own adds are left out")

    def test_unknown_split_and_unmeasured_web_say_so_never_zero(self):
        listed = [job('Baker', 'Himalayas', 'job board'), job('Chef', 'Some board', 'job board')]
        out = sc.count(listed, [right('Baker'), right('Chef')], [], None, None)
        self.assertEqual(out['free_job_apis'], {'status': 'inside job_boards'})
        self.assertEqual(out['job_boards']['right'], 2, 'the free API job counted under job_boards')
        self.assertEqual(out['web_search'], {'status': 'not measured'})

    def test_linkedin_shows_once_its_jobs_are_listed(self):
        out = sc.count([job('Dev', 'LinkedIn', 'job board')], [], [], FREE, set())
        self.assertEqual(out['linkedin'], {'right': 0, 'only': 0, 'fit70': None, 'seconds': None})
        self.assertEqual(out['web_search']['right'], 0, 'an empty web list is measured: 0, not "not measured"')


class Files(unittest.TestCase):
    def test_extract_carries_the_kind_the_store_wrote(self):
        from src import store
        with tempfile.TemporaryDirectory() as tmp:
            db = store.connect(os.path.join(tmp, 'jobs.sqlite'))
            for title, source, kind in (('Cook', 'Acme careers', 'employer feed'), ('Baker', 'Himalayas', 'job board')):
                store.upsert_job(db, {'company': 'Acme', 'title': title, 'url': f'https://acme.example/{title}', 'location': 'Lyon'}, source, source_kind=kind)
            db.commit()
            db.close()
            rows = gate.extract(os.path.join(tmp, 'jobs.sqlite'), os.path.join(tmp, 'jobs.json'), include_urls=True)
        self.assertEqual(sorted((r['title'], r['kind'], sc.word(r, FREE)) for r in rows),
                         [('Baker', 'job board', 'free_job_apis'), ('Cook', 'employer feed', 'employer_sites')])

    def test_annotate_sets_sources_and_leaves_a_row_without_jobs(self):
        with tempfile.TemporaryDirectory() as tmp:
            one, two = Path(tmp, 'search-personas-p1'), Path(tmp, 'search-personas-p2')
            one.mkdir()
            two.mkdir()
            Path(one, 'result.json').write_text(json.dumps({'persona': 1, 'step_yield': []}), encoding='utf-8')
            Path(one, 'jobs.json').write_text(json.dumps([job('Cook', 'EURES', 'job board')]), encoding='utf-8')
            Path(one, 'judged.json').write_text(json.dumps({'rows': [right('Cook')]}), encoding='utf-8')
            Path(one, 'found-boards.json').write_text(json.dumps({'ideas': {'k': [{'host': 'b.example', 'origin': 'web'}, {'host': 'c.example'}]}}), encoding='utf-8')
            Path(two, 'result.json').write_text(json.dumps({'persona': 2, 'not_measured': 'not run: queue'}), encoding='utf-8')
            self.assertEqual(sc.annotate(tmp), [1])
            row = json.loads(Path(one, 'result.json').read_text(encoding='utf-8'))
            self.assertEqual(row['sources']['eures']['right'], 1)
            self.assertEqual(sc.web_boards(one), {'b.example'})
            self.assertNotIn('sources', json.loads(Path(two, 'result.json').read_text(encoding='utf-8')), 'no jobs listed: nothing claimed')


if __name__ == '__main__':
    unittest.main()
