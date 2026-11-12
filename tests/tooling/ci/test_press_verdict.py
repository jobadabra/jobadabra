"""Guard: release — the replay's report on a search PR must name a source main reads that the PR lost, or a person's lost right jobs, and never name a loss
that one runner's load made (one pair of three); and it must never red the PR: the live proof decides (owner, 12 Nov 2026, asked via AskUserQuestion by sa:
"Report only, live decides (Recommended)"; tools/press-yardstick/verdict.py). Below, code 1 = the report names a loss to check live, 0 = it names none."""
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
LIVE_MOVES = 'Moves: p1 coverage 0.40 → 0.55 (1 run a side, same minute, usual difference 0.03)\n'
LOSS = 'To check live:'   # the report's words for a loss the replay shows and the body does not answer


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

    def run_verdict(self, band, pairs, body='', controls=None):
        """pairs: [(main kwargs, pr kwargs)] for pair 1..n; controls: {side: kwargs} of main's extra replays -> (exit code, text)."""
        art, out = self.fresh('art'), self.fresh('out')
        for side, kwargs in (controls or {}).items():
            replay(art, side, **kwargs)
        for (main, pr), (main_side, pr_side) in zip(pairs, verdict.PAIRS):
            replay(art, main_side, **main)
            replay(art, pr_side, **pr)
        out.mkdir(exist_ok=True)
        (out / 'band-used.json').write_text(json.dumps(band))
        said = io.StringIO()
        with mock.patch.dict(os.environ, {'PR_BODY': body}, clear=False), redirect_stdout(said):
            os.environ.pop('PR_NUMBER', None)
            self.exit = verdict.final(art, out, self.root / 'recordings')
        return int(LOSS in said.getvalue()), said.getvalue()

    def test_a_loss_is_reported_and_never_reds_the_pr(self):
        code, text = self.run_verdict(self.band(), [({}, {'lanes': NO_BOARDS})] * 3)
        self.assertEqual((code, self.exit), (1, 0), 'the report names the loss; its exit is 0: the live proof decides, not the replay')
        self.assertIn('Run the live proof (one search a side, both started in the same minute)', text)

    def test_a_source_main_reads_that_the_pr_stops_reading_in_all_3_pairs_is_named(self):
        code, text = self.run_verdict(self.band(), [({}, {'lanes': NO_BOARDS})] * 3)
        self.assertEqual(code, 1, text)
        self.assertIn('job_boards did not run', text)
        self.assertIn('pair 3: job_boards did not run', text, 'all 3 pairs are printed for the person')

    def test_a_source_that_took_one_rounding_step_on_main_and_none_on_the_pr_is_the_clock_never_red(self):
        """#3859, 12 Nov 2026: p1's sources answered from the recording in 0.1 s on main and under 0.05 s on the PR, 0 jobs on both sides, in all 3 pairs."""
        quick, none = {'job_boards': (0.1, 0), 'employer_sites': (40, 1)}, {'job_boards': (0, 0), 'employer_sites': (40, 1)}
        code, text = self.run_verdict(self.band(lanes=(quick, quick)), [({'lanes': quick}, {'lanes': none})] * 3)
        self.assertEqual(code, 0, text)
        self.assertNotIn('did not run', text)

    def test_a_loss_in_one_pair_of_three_is_the_runners_load_never_red(self):
        code, text = self.run_verdict(self.band(), [({}, {'lanes': NO_BOARDS}), ({}, {}), ({}, {})])
        self.assertEqual(code, 0, text)

    def test_a_pair_that_did_not_run_never_completes_a_red(self):
        code, text = self.run_verdict(self.band(), [({}, {'lanes': NO_BOARDS})])
        self.assertEqual(code, 0, 'the repeat left no pairs 2 and 3: never red, never a 4th try')

    def test_right_jobs_lost_in_3_pairs_are_named_unless_the_owner_lowered_the_bar(self):
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

    def test_a_pr_side_that_asks_beyond_the_recording_in_one_pair_of_three_is_the_runners_clock_never_held(self):
        """#3878, 12 Nov 2026: a PR that changes no file a search runs was held because one PR-side replay of one person got further than main's."""
        once = [({}, {'gap': True}), ({}, {}), ({}, {})]
        code, text = self.run_verdict(self.band(), once)
        self.assertEqual(code, 0, text)
        self.assertNotIn('recording too old for this PR', text)
        code, text = self.run_verdict(self.band(), [({}, {'gap': True})] * 3)
        self.assertEqual(code, 1, 'positive control: beyond the recording in all 3 pairs is a changed path, held')
        self.assertIn('recording too old for this PR', text)
        code, text = self.run_verdict(self.band(), [({}, {'gap': True}), ({'gap': True}, {'gap': True}), ({'gap': True}, {'gap': True})])
        self.assertEqual(code, 0, 'main asks beyond the recording too in the 2 more pairs: an aged recording, never this PR\'s path')
        self.assertNotIn('recording too old for this PR', text)

    def test_a_gap_that_mains_own_extra_replay_shows_too_is_the_replays_place_never_held(self):
        """#3883, 12 Nov 2026: the PR side asked beyond the recording in 3 of 3 pairs on a PR whose change no replayed search runs."""
        three = [({}, {'gap': True})] * 3
        code, text = self.run_verdict(self.band(), three, controls={'ctl-2': {}, 'ctl-3': {'gap': True}})
        self.assertEqual(code, 0, text)
        self.assertNotIn('recording too old for this PR', text)
        self.assertIn("the replay's place, not this PR", text)
        code, text = self.run_verdict(self.band(), three, controls={'ctl-2': {}, 'ctl-3': {}})
        self.assertEqual(code, 1, 'positive control: main stays within the recording in both extra replays, so the PR changed the path')
        self.assertIn('recording too old for this PR', text)

    def test_the_workflow_replays_every_control_on_mains_side_and_passes_the_art_folder(self):
        """#3889, Gitar: a shell comment inside the run line dropped `art` and the tee, so no repeat pair and no control ever ran."""
        text = (ROOT / '.github' / 'workflows' / 'press-yardstick.yml').read_text(encoding='utf-8')
        line = next(line for line in text.splitlines() if 'replay.py recordings-again' in line)
        sides = json.loads(line.split("'")[1])
        self.assertEqual([side for side in sides if side.startswith('ctl')], list(verdict.CONTROLS))
        self.assertTrue(all(sides[side] == 'sides/main' for side in verdict.CONTROLS))
        self.assertEqual([side for pair in verdict.PAIRS[1:] for side in pair], [side for side in sides if not side.startswith('ctl')])
        self.assertRegex(line.split("'")[2], r'^ art \| tee -a "\$GITHUB_STEP_SUMMARY"$')

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

    def test_once_main_asks_beyond_the_recording_it_reads_re_record_loudly_never_worse(self):
        """sa, 11 Nov 2026 (#3803's title prompt: the tapes key each AI answer by the whole request): after such a PR merges, main fails the same way;
        that is "not measured: re-record", said with the people, never fewer right jobs."""
        code, text = self.run_verdict(self.band(), [({'gap': True, 'right': False}, {'right': False})] * 3)
        self.assertEqual(code, 0, text)
        self.assertIn('recording stale, re-record 1', text)
        self.assertIn('Re-record: p1', text)
        self.assertNotIn('right jobs', text)

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

    def test_the_verdict_reads_the_same_band_ci_py_read_in_the_same_job(self):
        """#3805's own run: ci.py downloaded main's band, then the verdict's second download hit gh's "file exists", read {} and said
        "no band on this recording" for 16 people: a gate that can never be red."""
        band = {'recordings': {'p1': 'abc'}, 'personas': {'1': ['p1']}, 'runs': {'1': {}}}

        def gh(cmd, **_):
            if cmd[:3] == ['gh', 'run', 'list']:
                return mock.Mock(stdout=json.dumps([{'databaseId': 7, 'displayTitle': ci.BAND_RUN}]))
            target = Path(cmd[cmd.index('-D') + 1], 'out', 'band.json')
            if target.exists():   # what gh does: it never extracts over a file
                raise verdict.ci.subprocess.CalledProcessError(1, cmd, stderr='error extracting "out/band.json": file exists')
            target.parent.mkdir(parents=True)
            target.write_text(json.dumps(band))
            return mock.Mock(stdout='')

        cwd = os.getcwd()
        os.chdir(self.root)
        try:
            with mock.patch.object(ci.subprocess, 'run', side_effect=gh):
                self.assertEqual(ci.newest_band(), band)
                self.assertEqual(ci.newest_band(), band, 'the second read in the job is the same band, never {}')
            self.assertEqual(sorted(p.name for p in self.root.iterdir()), ['recordings'],
                             'nothing is downloaded into the working folder: #3805 committed 609 band files a by-hand run left in the repo')
        finally:
            os.chdir(cwd)

    def test_the_lanes_are_main_reader_rows_lanes(self):
        reader_rows = verdict._load('rr', ROOT / 'src' / 'sources' / 'reader_rows.py')
        self.assertEqual(verdict.lanes(self.root / 'no-main-here'), [lane.id for lane in reader_rows.LANES])


if __name__ == '__main__':
    unittest.main()
