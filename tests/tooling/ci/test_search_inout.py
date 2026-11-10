"""Guard: data — in = out per source is what Admin's Find jobs graph and the lost-source alert read (sa's finish-line plan, WP3/G6): a right job the list
lacks must be counted at the stage that lost it, never silently gone and never a made-up zero; a persona without a reference, a judged list or stage lines
gets no in = out at all; and only counts leave (no title or link in the row). Fakes only. Code: tools/persona-search/inout.py."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'tools' / 'persona-search'))
import inout  # noqa: E402

RIGHT = [{'title': f'Électricien {i}', 'company': f'Employeur {i}', 'url': f'https://europa.eu/eures/portal/jv-se/jv-details/j{i}?lang=en'} for i in range(7)]


def log(*lines):
    return '\n'.join(f'[{60 + i}s] {line}' for i, line in enumerate(lines))


class InEqualsOut(unittest.TestCase):
    def folder(self, n, run_log, judged):
        root = Path(tempfile.mkdtemp())
        press = root / f'search-personas-p{n}'
        (press / 'draw').mkdir(parents=True)
        if run_log is not None:
            (press / 'draw' / 'run-1.log').write_text(run_log, encoding='utf-8')
        if judged is not None:
            (press / 'judged.json').write_text(json.dumps({'rows': judged}), encoding='utf-8')
        reference = root / 'reference-jobs.json'
        reference.write_text(json.dumps({'personas': {str(n): RIGHT}}), encoding='utf-8')
        return root, reference

    def test_each_right_job_the_list_lacks_is_counted_at_the_stage_that_lost_it(self):
        url = [job['url'] for job in RIGHT]
        run_log = log(*[f'Stage: EURES read {u}' for u in url[1:6]], f'Stage: EURES kept {url[1]}', f'Stage: EURES ai_no {url[2]}', f'Stage: EURES placed_out {url[3]}',
                      f'Stage: EURES never_asked {url[4]}', 'Stages: EURES read 5 · kept 1 · ai_no 1 · placed_out 1 · never_asked 1')
        listed = [{'title': ' électricien 0 ', 'company': 'EMPLOYEUR 0', 'role': 'no'}]   # listed whatever the night's judge said; same posting, other spacing and case
        root, reference = self.folder(13, run_log, listed)
        rows = [{'persona': 13}, {'persona': 2}]
        self.assertEqual(inout.attach(rows, root, reference), 1)
        self.assertEqual(rows[0]['inout'], {'eures': {'in': 7, 'out': 1, 'lost': {'not_read': 1, 'never_asked': 2, 'ai_no': 1, 'placed_out': 1, 'double': 0, 'after_kept': 1}}})
        lost = rows[0]['inout']['eures']
        self.assertEqual(lost['out'] + sum(lost['lost'].values()), lost['in'], 'every right job is out or lost at one stage')
        self.assertNotIn('inout', rows[1], 'no reference for p2: no key, never zeros')
        self.assertNotIn('Électricien', json.dumps(rows) + json.dumps(rows, ensure_ascii=False), 'counts only leave')
        self.assertNotIn('europa.eu', json.dumps(rows))

    def test_a_listed_job_is_found_by_its_link_when_the_store_named_its_employer_otherwise(self):
        root, reference = self.folder(13, log(f"Stage: EURES kept {RIGHT[0]['url']}"), [{'title': RIGHT[0]['title'], 'company': 'Named from the page'}])
        (root / 'search-personas-p13' / 'jobs.json').write_text(json.dumps([{'title': RIGHT[0]['title'], 'company': 'Named from the page', 'url': RIGHT[0]['url']}]), encoding='utf-8')
        rows = [{'persona': 13}]
        inout.attach(rows, root, reference)
        self.assertEqual(rows[0]['inout']['eures']['out'], 1, 'listed, by its link')
        self.assertEqual(rows[0]['inout']['eures']['lost']['after_kept'], 0)

    def test_a_night_without_eures_counts_its_right_jobs_our_own_sources_did_not_read(self):
        """sa, 10 Nov 2026: the night's presses run with EURES off, so its in = out is "our own sources against EURES's jobs" (the row's eures 'off' keeps
        the series apart on the site): EURES's right jobs nobody listed are not_read, those another source listed are out."""
        night = log('EURES: off in this run', 'Stage: Job boards found kept https://board.example/1', 'Stages: Job boards found read 1 · kept 1')
        root, reference = self.folder(13, night, [{'title': RIGHT[0]['title'], 'company': RIGHT[0]['company']}])
        rows = [{'persona': 13}]
        inout.attach(rows, root, reference)
        self.assertEqual(rows[0]['inout']['eures']['out'], 1, 'the same job listed by another source counts as out')
        self.assertEqual(rows[0]['inout']['eures']['lost']['not_read'], 6)

    def test_right_jobs_only_another_source_showed_are_not_eures_in(self):
        """Review of [mc] 3/5: the reference also keeps the board's and the web search's right jobs; EURES's `in` counts only those EURES listed."""
        root, reference = self.folder(13, log(f"Stage: EURES kept {RIGHT[0]['url']}"), [])
        right = [{**RIGHT[0], 'sources': ['eures', 'web_search']}, {**RIGHT[1], 'sources': ['eures']}, {**RIGHT[2], 'sources': ['public_board']}, {**RIGHT[3], 'sources': ['web_search']}]
        reference.write_text(json.dumps({'personas': {'13': right}}), encoding='utf-8')
        rows = [{'persona': 13}]
        inout.attach(rows, root, reference)
        self.assertEqual(rows[0]['inout']['eures']['in'], 2)

    def test_without_stage_lines_or_a_judged_list_a_persona_gets_no_in_equals_out(self):
        for run_log, judged in (('[60s] EURES: 200 vacancies in your places read', []), (None, []), (log(f"Stage: EURES kept {RIGHT[0]['url']}"), None)):
            with self.subTest(run_log=run_log, judged=judged):
                root, reference = self.folder(5, run_log, judged)
                rows = [{'persona': 5}]
                self.assertEqual(inout.attach(rows, root, reference), 0)
                self.assertNotIn('inout', rows[0])


if __name__ == '__main__':
    unittest.main()
