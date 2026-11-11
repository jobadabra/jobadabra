"""Guard: release — a search PR that loses a source main reads, or a person's right jobs, must be red on the replay (owner, 11 Nov 2026: "I want that once an
improvement made, it will never be overwrite"; tools/press-yardstick/verdict.py), and a loss that one runner's load made (one pair of three) must never be."""
import importlib.util
import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location('press_verdict_test', ROOT / 'tools' / 'press-yardstick' / 'verdict.py')
verdict = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(verdict)
ci = verdict.ci

JUDGED = {'rows': [{'title': 'Nurse', 'company': 'St Mary', 'location': 'Dublin', 'role': 'yes', 'place': 'yes'}]}
JOBS = [{'title': 'Nurse', 'company': 'St Mary', 'location': 'Dublin', 'seen_s': 10, 'fit': 80, 'scored_s': 20}]
BOARDS = {'job_boards': (30, 5), 'employer_sites': (40, 1)}
NO_BOARDS = {'job_boards': (0, 0), 'employer_sites': (40, 1)}
LIVE_MOVES = 'Moves: p1 coverage 0.40 → 0.55 (3 runs a side, spread 0.03)\n'


def replay(art, side, right=True, lanes=None, gap=False, persona='p1'):
    """One replay's artifact as replay.py leaves it: result/ (judged, ceiling, jobs-1.json), out/draw/presses.jsonl (step_yield), tape-report.jsonl."""
    work = Path(art, f'yardstick-{persona}-{side}')
    (work / 'result' / 'ceiling').mkdir(parents=True)
    (work / 'result' / 'judged.json').write_text(json.dumps(JUDGED))
    (work / 'result' / 'ceiling' / 'jobs-1.json').write_text(json.dumps(JOBS))
    (work / 'result' / 'jobs-1.json').write_text(json.dumps(JOBS if right else []))
    (work / 'out' / 'draw').mkdir(parents=True)
    steps = [{'step': step, 'seconds': s, 'jobs': j} for step, (s, j) in (lanes or BOARDS).items()]
    (work / 'out' / 'draw' / 'presses.jsonl').write_text(json.dumps({'press': 1, 'funnel': {'step_yield': steps}}) + '\n')
    (work / 'tape-report.jsonl').write_text(json.dumps({'mode': 'replay', 'web_tape': 100, 'web_missing': 20 if gap else 0, 'ai_tape': 30, 'ai_missing': 0}) + '\n')


class Verdict(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        (self.root / 'recordings' / 'p1').mkdir(parents=True)

    def fresh(self, name):
        self.n = getattr(self, 'n', 0) + 1
        return self.root / f'{name}-{self.n}'

    def band(self, lanes=(BOARDS, BOARDS), right=(True, True)):
        art, out = self.fresh('band-art'), self.fresh('band-out')
        for n, (one, ok) in enumerate(zip(lanes, right), 1):
            replay(art, f'main-{n}', right=ok, lanes=one)
        with redirect_stdout(io.StringIO()):
            ci.band_mode(art, out)
        return json.loads((out / 'band.json').read_text())

    def run_verdict(self, band, pairs, body=''):
        """pairs: [(main kwargs, pr kwargs)] for pair 1..n -> (exit code, text)."""
        art, out = self.fresh('art'), self.fresh('out')
        for (main, pr), (main_side, pr_side) in zip(pairs, verdict.PAIRS):
            replay(art, main_side, **main)
            replay(art, pr_side, **pr)
        out.mkdir(exist_ok=True)
        (out / 'band-used.json').write_text(json.dumps(band))
        said = io.StringIO()
        with mock.patch.dict(os.environ, {'PR_BODY': body}, clear=False), redirect_stdout(said):
            os.environ.pop('PR_NUMBER', None)
            code = verdict.final(art, out, self.root / 'recordings')
        return code, said.getvalue()

    def test_a_source_main_reads_that_the_pr_stops_reading_in_all_3_pairs_is_red(self):
        code, text = self.run_verdict(self.band(), [({}, {'lanes': NO_BOARDS})] * 3)
        self.assertEqual(code, 1, text)
        self.assertIn('job_boards did not run', text)
        self.assertIn('pair 3: job_boards did not run', text, 'all 3 pairs are printed for the person')

    def test_a_loss_in_one_pair_of_three_is_the_runners_load_never_red(self):
        code, text = self.run_verdict(self.band(), [({}, {'lanes': NO_BOARDS}), ({}, {}), ({}, {})])
        self.assertEqual(code, 0, text)

    def test_a_pair_that_did_not_run_never_completes_a_red(self):
        code, text = self.run_verdict(self.band(), [({}, {'lanes': NO_BOARDS})])
        self.assertEqual(code, 0, 'the repeat left no pairs 2 and 3: never red, never a 4th try')

    def test_right_jobs_lost_in_3_pairs_are_red_unless_the_owner_lowered_the_bar(self):
        lost = [({}, {'right': False})] * 3
        code, text = self.run_verdict(self.band(), lost)
        self.assertEqual(code, 1, text)
        self.assertIn('right jobs 1 → 0', text)
        code, text = self.run_verdict(self.band(), lost, body='Floor-change: "p1 may lose its one job, the new reader is worth it"\n')
        self.assertEqual(code, 0, text)
        self.assertIn('Accepted by the owner', text)

    def test_a_lane_main_ran_only_sometimes_is_a_clock_cliff_on_the_band_never_red(self):
        band = self.band(lanes=(BOARDS, NO_BOARDS))
        self.assertIn('p1', band['cliff']['1'], 'the cliff is said in the band, once')
        code, text = self.run_verdict(band, [({}, {'lanes': NO_BOARDS})] * 3)
        self.assertEqual(code, 0, text)
        self.assertIn("clock cliff on main's band 1", text)

    def test_a_recording_too_old_for_this_pr_is_held_by_a_live_moves_line_only(self):
        old = [({}, {'gap': True, 'right': False})]
        code, text = self.run_verdict(self.band(), old)
        self.assertEqual(code, 1, text)
        self.assertIn('recording too old for this PR', text)
        self.assertNotIn('right jobs 1 → 0', text, 'too old is never read as worse')
        code, _ = self.run_verdict(self.band(), old, body='Moves: nothing (a refactor)\n')
        self.assertEqual(code, 1, '"Moves: nothing" does not hold a path change')
        code, _ = self.run_verdict(self.band(), old, body=LIVE_MOVES)
        self.assertEqual(code, 0)

    def test_a_recording_stale_on_both_sides_and_people_without_one_are_not_measured(self):
        code, text = self.run_verdict(self.band(), [({'gap': True}, {'gap': True, 'right': False})] * 3)
        self.assertEqual(code, 0, text)
        self.assertIn('Verdict covers 0 of 18 people', text)
        self.assertIn('no recording 17', text)
        self.assertIn('fewer than half', text, 'a verdict that sees few people says it loudly')

    def test_a_repeat_pair_whose_pr_side_asks_beyond_the_recording_never_completes_a_red(self):
        """Gitar on #3805: pairs 2 and 3 were not gap-checked, so pages the recording lacks could finish a 3-of-3 red."""
        lost = {'lanes': NO_BOARDS}
        code, text = self.run_verdict(self.band(), [({}, lost), ({}, {**lost, 'gap': True}), ({}, {**lost, 'gap': True})])
        self.assertEqual(code, 0, text)

    def test_a_verdict_that_crashes_reads_not_measured_never_red(self):
        """Gitar on #3805: a malformed file a crashed replay left must not block the PR; only a confirmed 3-of-3 loss may."""
        band = self.band()
        art, out = self.fresh('art'), self.fresh('out')
        replay(art, 'main')
        replay(art, 'pr')
        (art / 'yardstick-p1-pr' / 'result' / 'jobs-1.json').write_text('[{not json')
        out.mkdir()
        (out / 'band-used.json').write_text(json.dumps(band))
        said = io.StringIO()
        with mock.patch.dict(os.environ, {'PR_BODY': ''}), redirect_stdout(said):
            code = verdict.main(['final', str(art), str(out), str(self.root / 'recordings')])
        self.assertEqual(code, 0)
        self.assertIn('not measured', said.getvalue())

    def test_the_lanes_are_main_reader_rows_lanes(self):
        reader_rows = verdict._load('rr', ROOT / 'src' / 'sources' / 'reader_rows.py')
        self.assertEqual(verdict.lanes(self.root / 'no-main-here'), [lane.id for lane in reader_rows.LANES])


if __name__ == '__main__':
    unittest.main()
