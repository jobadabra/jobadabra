"""Guard: release — the press's yardstick says whether a PR changed coverage, quality or speed (tools/press-yardstick/three_numbers.py); a wrong number lets a
change that loses jobs merge as "no change", the circle the owner named (7 Nov 2026: "we overwrite one another and we never get it right")."""
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / 'tools' / 'press-yardstick' / 'three_numbers.py'
SPEC = importlib.util.spec_from_file_location('press_numbers', SCRIPT)
numbers = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(numbers)

JUDGED = [{'title': 'Nurse', 'company': 'St Mary', 'location': 'Dublin', 'role': 'yes', 'place': 'yes'},
          {'title': 'Ward nurse', 'company': 'HSE', 'location': 'Cork', 'role': 'yes', 'place': 'no'},
          {'title': 'Night nurse', 'company': 'Beacon', 'location': 'Dublin', 'role': 'yes', 'place': 'yes'},
          {'title': 'Carer', 'company': 'Home Inst', 'location': 'Dublin', 'role': 'no', 'place': 'yes'}]


def job(title, company, location, seen, fit=None, scored=None):
    return {'title': title, 'company': company, 'location': location, 'seen_s': seen, 'fit': fit, 'scored_s': scored}


CEILING = [job('Nurse', 'St Mary', 'Dublin', 10), job('Night nurse', 'Beacon', 'Dublin', 300), job('Carer', 'Home Inst', 'Dublin', 20)]
MAIN = [job('Nurse', 'St Mary', 'Dublin', 10, 82, 40), job('Carer', 'Home Inst', 'Dublin', 20, 30, 45)]
PR = [job('Nurse', 'St Mary', 'Dublin', 10, 82, 30), job('Night nurse', 'Beacon', 'Dublin', 60, 75, 70), job('Carer', 'Home Inst', 'Dublin', 20, 30, 35),
      job('Midwife', 'Rotunda', 'Dublin', 50, 90, 55)]


class ThreeNumbersTest(unittest.TestCase):
    def test_a_fixed_pair_reads_as_the_judge_said(self):
        judged = numbers.verdicts(JUDGED)
        main, pr = numbers.three(MAIN, judged, CEILING), numbers.three(PR, judged, CEILING)
        self.assertEqual((main['coverage'], main['quality'], main['speed'], main['unjudged']), (0.5, 0.5, 40, 0))
        self.assertEqual((pr['coverage'], pr['right']), (1.0, 2), 'the night nurse the ceiling found is found now')
        self.assertAlmostEqual(pr['quality'], 2 / 4, msg='the midwife was never judged: scored, never right')
        self.assertEqual(pr['speed'], 30)
        self.assertEqual(pr['unjudged'], 1, 'a job the judge never saw is counted apart, not as right')

    def test_a_job_is_the_judges_job_whatever_its_case_or_spaces(self):
        judged = numbers.verdicts(JUDGED)
        self.assertEqual(numbers.three([job(' nurse ', 'ST MARY', 'dublin', 5)], judged, CEILING)['right'], 1)

    def test_a_job_read_from_two_sources_is_one_job(self):
        # Gitar on #3582: the judge keeps one verdict per job; two rows of it would put coverage past 100% and read as better.
        judged = numbers.verdicts(JUDGED)
        twice = MAIN + [job('Nurse', 'St Mary', 'Dublin', 15, 82, 25)]
        out = numbers.three(twice, judged, CEILING + [CEILING[0]])
        self.assertEqual((out['coverage'], out['right'], out['speed']), (0.5, 1, 25), 'one job, scored first at 25 s')

    def test_a_later_press_is_timed_from_its_own_start(self):
        # Gitar on #3582: press 2's file holds press 1's jobs too; one press 1 scored has negative seconds and is not press 2's speed.
        judged = numbers.verdicts(JUDGED)
        press2 = [job('Nurse', 'St Mary', 'Dublin', -170, 82, -140), job('Night nurse', 'Beacon', 'Dublin', 12, 75, 33)]
        out = numbers.three(press2, judged, CEILING)
        self.assertEqual((out['coverage'], out['speed']), (1.0, 33), 'both are found by now; the first right 70+ of this press is at 33 s')

    def test_nothing_to_measure_is_none_never_zero(self):
        out = numbers.three([], {}, [])
        self.assertEqual((out['coverage'], out['quality'], out['speed']), (None, None, None))
        self.assertEqual(numbers.summary([out]), {'unjudged': 0, 'coverage': None, 'quality': None, 'speed': None})

    def test_a_change_counts_only_outside_mains_band(self):
        runs = [{'coverage': c, 'quality': 0.6, 'speed': s} for c, s in ((0.50, 40), (0.52, 44), (0.48, 36))]
        band = numbers.band(runs)
        self.assertEqual(numbers.compare(band, {'coverage': 0.51, 'quality': 0.6, 'speed': 41}),
                         {'coverage': 'no change', 'quality': 'no change', 'speed': 'no change'}, 'main against itself reads no change')
        self.assertEqual(numbers.compare(band, {'coverage': 0.70, 'quality': 0.3, 'speed': 20}),
                         {'coverage': 'better', 'quality': 'worse', 'speed': 'better'}, 'speed: fewer seconds is better')
        self.assertEqual(numbers.compare(numbers.band(runs[:1]), runs[0])['coverage'], 'not measured', 'one replay is no band')

    def test_a_person_is_worse_only_beyond_one_job_and_the_cell_shows_both_numbers(self):
        # Plan ys 1/2 (owner, 10 Nov 2026): main's replays repeat to the digit, so one person losing more than one job is a real loss, and one job is not.
        row = lambda **kw: {'persona': 'p1', 'coverage': 0.5, 'quality': 0.5, 'speed': 40, 'most': 10, 'scored': 20, **kw}
        verdict = lambda main, pr: numbers.people([main], [pr])['p1']['verdict']
        self.assertEqual(verdict(row(), row(coverage=0.4, quality=0.45, speed=44))['coverage'], 'no change', 'one job of ten')
        self.assertEqual(verdict(row(), row(coverage=0.3))['coverage'], 'worse', 'two jobs of ten')
        self.assertEqual(verdict(row(), row(speed=46))['speed'], 'worse', 'more than 5 s')
        self.assertEqual(verdict(row(), row(speed=30))['speed'], 'better')
        self.assertEqual(verdict(row(speed=None), row(speed=30))['speed'], 'better', 'a first right 70+ job where there was none')
        self.assertEqual(verdict(row(), row(speed=None))['speed'], 'worse', 'the first right 70+ job is lost')
        self.assertEqual(verdict(row(coverage=0.1, most=10), row(coverage=0.0, most=10))['coverage'], 'worse', 'the one right job lost is all of it')
        self.assertEqual(verdict(row(coverage=None), row(coverage=None))['coverage'], 'not measured')

    def test_jobs_listed_in_the_wrong_place_show_as_a_person_getting_worse(self):
        # Owner, 10 Nov 2026, on #3674: 24 of 25 listed jobs were in the wrong country for a Dublin search and no number said so (coverage counts right jobs found,
        # quality the right share of the jobs SCORED). The judge's place verdict on every job LISTED, scored or not, does.
        rows = [{'title': f'Nurse {n}', 'company': 'HSE', 'location': place, 'role': 'yes', 'place': verdict}
                for n, (place, verdict) in enumerate([('Dublin', 'yes')] * 4 + [('Vienna', 'no')] * 6)]
        judged, placed = numbers.verdicts(rows), numbers.places(rows)
        listed = lambda count: [job(row['title'], 'HSE', row['location'], 5) for row in rows[:count]]   # none of them scored: the quality number cannot see them
        main = {'persona': 'p7', **numbers.three(listed(4), judged, listed(4), placed)}
        pr = {'persona': 'p7', **numbers.three(listed(10), judged, listed(4), placed)}
        self.assertEqual((main['placed'], pr['placed'], pr['listed']), (1.0, 0.4, 10))
        self.assertIsNone(pr['quality'], 'positive control: nothing was scored, so quality could not tell')
        found = numbers.people([main], [pr])
        self.assertEqual(found['p7']['verdict']['placed'], 'worse')
        self.assertEqual(numbers.wrong_place_line(found), 'Listed in the right place, lowest: p7 40% (main 100%)')
        self.assertEqual(numbers.three(listed(4), judged, listed(4))['placed'], None, 'no verdicts handed in: not measured')

    def test_a_person_whose_main_replays_differ_gets_a_wider_step(self):
        # Measured 10 Nov 2026 (5 replays of main, 16 people): p3's speed moved 8.7 s (sd) between identical replays; one fixed 5 s step named p3 worse on about every PR.
        row = lambda speed: {'persona': 'p3', 'coverage': 0.5, 'quality': 0.5, 'speed': speed, 'most': 10, 'scored': 20, 'placed': 1.0, 'listed': 10}
        noise = numbers.person_noise([[row(s)] for s in (40, 52, 31, 47, 38)])
        self.assertGreater(noise['p3']['speed'], 10)
        self.assertEqual(noise['p3']['coverage'], 0, 'a number that repeated exactly has no extra width')
        self.assertEqual(numbers.people([row(40)], [row(52)])['p3']['verdict']['speed'], 'worse', 'positive control: the fixed step alone names it')
        self.assertEqual(numbers.people([row(40)], [row(52)], noise)['p3']['verdict']['speed'], 'no change')
        self.assertEqual(numbers.people([row(40)], [row(80)], noise)['p3']['verdict']['speed'], 'worse', 'a real loss is still named')

    def test_the_first_line_names_who_got_worse_and_counts_the_rest(self):
        row = lambda persona, **kw: {'persona': persona, 'coverage': 0.5, 'quality': 0.5, 'speed': 40, 'most': 10, 'scored': 20, **kw}
        found = numbers.people([row('p1'), row('p2'), row('p3')], [row('p1'), row('p2', coverage=0.1, speed=20), row('p3', speed=20)])
        self.assertEqual(numbers.people_line(found, ['p1', 'p2', 'p3', 'p4']),
                         '1 better, 1 no change, 1 worse, 1 not measured; worse: p2 (coverage)', 'p2 got faster and lost jobs: worse, named')
        table = numbers.people_table(found, ['p1', 'p2', 'p3', 'p4'], {'p4': 'no recording'})
        self.assertIn('| p2 | 50% → 10% ❌ worse |', table)
        self.assertIn('| p4 | ⚪ not measured (no recording) |', table)
        self.assertEqual(table.count('\n'), 5, 'a header, a rule and a row for every person asked about')

    def test_the_command_reads_the_tape_and_replay_folders(self):
        with tempfile.TemporaryDirectory() as root:
            tapes, replay = Path(root, 'tapes', 'p7'), Path(root, 'replay', 'p7')
            tapes.mkdir(parents=True)
            replay.mkdir(parents=True)
            (tapes / 'judged.json').write_text(json.dumps({'rows': JUDGED}))
            (tapes / 'jobs-1.json').write_text(json.dumps(CEILING))
            (replay / 'jobs-1.json').write_text(json.dumps(MAIN))
            rows = numbers.persona_rows(Path(root, 'tapes'), Path(root, 'replay'), '1')
        self.assertEqual([(r['persona'], r['coverage']) for r in rows], [('p7', 0.5)])
        self.assertIn('| coverage | 50% |', numbers.table({'coverage': [0.4, 0.6], 'quality': None, 'speed': None}, numbers.summary(rows)))

    def test_the_command_runs_as_ci_starts_it(self):
        # 2c-2 found the file named numbers.py: Python puts the script's folder first, so `import statistics` found it in place of the standard
        # numbers module and the command never ran; the tests above load it by path and never saw that.
        with tempfile.TemporaryDirectory() as root:
            tapes, replay = Path(root, 'tapes', 'p7'), Path(root, 'replay', 'p7')
            tapes.mkdir(parents=True)
            replay.mkdir(parents=True)
            (tapes / 'judged.json').write_text(json.dumps({'rows': JUDGED}))
            (tapes / 'jobs-1.json').write_text(json.dumps(CEILING))
            (replay / 'jobs-1.json').write_text(json.dumps(MAIN))
            ran = subprocess.run([sys.executable, str(SCRIPT), 'summary', str(Path(root, 'tapes')), str(Path(root, 'replay'))], capture_output=True, text=True)
        self.assertEqual(ran.returncode, 0, ran.stderr[-300:])
        self.assertEqual(json.loads(ran.stdout)['summary']['coverage'], 0.5)


if __name__ == '__main__':
    unittest.main()
