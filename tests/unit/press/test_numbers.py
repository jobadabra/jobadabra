"""Guard: release — the press's yardstick says whether a PR changed coverage, quality or speed (tools/press-yardstick/numbers.py); a wrong number lets a
change that loses jobs merge as "no change", the circle the owner named (7 Nov 2026: "we overwrite one another and we never get it right")."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location('press_numbers', ROOT / 'tools' / 'press-yardstick' / 'numbers.py')
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


if __name__ == '__main__':
    unittest.main()
