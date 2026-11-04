"""A press whose AI answered too slowly to reach scoring is grey, "not measured: AI slow", never a product 0 (owner's coordinator, 3 Nov 2026).
Why (main runs 41463124217, 41582737531): the Codex plan was `ran-out`, the broker fell back to Haiku, and a call took 20-34 s on average (its own 10-16 s
plus 8-18 s in the queue) against 7-10 s on 41359673068 (the last run that found jobs). A press completed ~18 calls instead of ~40, never reached
the job boards or scoring, and the check read "found 0 right jobs on all six", so main's last three runs were 0 / 0 / 0 and the gate could not go red.
The fixtures are the `relay:` lines of persona 1's press in those two runs (timings only)."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'tools' / 'persona-search'))
import gate  # noqa: E402

FIXTURES = ROOT / 'tests' / 'fixtures' / 'persona_relay'


def press_folder(tmp, relay, seconds, scored, right=0, code=0):
    out = Path(tmp)
    (out / 'draw').mkdir()
    (out / 'draw' / 'presses.jsonl').write_text(json.dumps({'press': 1, 'code': code, 'crashes': [], 'seconds': seconds, 'scored_in_places': scored, 'funnel': {'ai_usd': 0}}) + '\n')
    (out / 'run.log').write_text((FIXTURES / relay).read_text())
    rows = [{'title': 'Truck Driver', 'company': 'X', 'role': 'yes', 'place': 'yes'}] * right + [{'title': 'Other', 'company': 'Y', 'role': 'no', 'place': 'no'}]
    (out / 'judged.json').write_text(json.dumps({'usd': 0, 'rows': rows}))
    return out


class SlowAiIsNotAProductZero(unittest.TestCase):
    def test_the_mean_call_time_of_the_real_logs(self):
        self.assertGreater(gate.mean_call_s(FIXTURES / 'main_41463124217_p1_slow.log'), gate.SLOW_CALL_S)
        self.assertLess(gate.mean_call_s(FIXTURES / 'main_41359673068_p1_fast.log'), gate.SLOW_CALL_S)
        self.assertIsNone(gate.mean_call_s(FIXTURES / 'missing.log'))

    def test_a_slow_press_that_found_no_right_job_is_grey_not_a_zero(self):
        with tempfile.TemporaryDirectory() as tmp:
            row = gate.result(1, press_folder(tmp, 'main_41463124217_p1_slow.log', 153, 0))   # run 41463124217, persona 1: 153 s, nothing scored
        self.assertTrue(row['not_measured'].startswith('AI slow (a call took '), row.get('not_measured'))
        verdict = gate.compare({n: {**row, 'persona': n} for n in range(1, 7)}, [])
        self.assertEqual(verdict['state'], 'neutral')
        self.assertIn('not measured (6 of 6): AI slow', verdict['head'])

    def test_a_press_the_ai_answered_fast_is_measured_even_with_no_right_job(self):
        with tempfile.TemporaryDirectory() as tmp:
            row = gate.result(1, press_folder(tmp, 'main_41359673068_p1_fast.log', 158, 12))   # run 41359673068, persona 1: 12 scored
        self.assertNotIn('not_measured', row)

    def test_a_slow_press_that_still_found_a_right_job_is_measured(self):
        with tempfile.TemporaryDirectory() as tmp:
            row = gate.result(1, press_folder(tmp, 'main_41463124217_p1_slow.log', 153, 3, right=2))
        self.assertNotIn('not_measured', row)

    def test_a_slow_press_that_scored_jobs_and_found_none_right_stays_a_measured_zero(self):
        with tempfile.TemporaryDirectory() as tmp:
            row = gate.result(1, press_folder(tmp, 'main_41463124217_p1_slow.log', 153, 12))   # reached scoring: a broken scorer must still show
        self.assertNotIn('not_measured', row)

    def test_a_press_that_wrote_no_numbers_keeps_its_error_and_its_red_reason(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = press_folder(tmp, 'main_41463124217_p1_slow.log', 153, 0)
            (out / 'draw' / 'presses.jsonl').unlink()
            row = gate.result(1, out)
        self.assertNotIn('not_measured', row)
        self.assertIn('error', row)

    def test_the_bound_is_18_s(self):
        for mean_ms, grey in ((17900, False), (18000, True)):
            with tempfile.TemporaryDirectory() as tmp:
                out = press_folder(tmp, 'main_41463124217_p1_slow.log', 153, 0)
                (out / 'run.log').write_text(''.join(f'relay: small total {mean_ms} broker 4000 waited 100 in-flight 2 kind decide status 200\n' for _ in range(5)))
                self.assertEqual('not_measured' in gate.result(1, out), grey, mean_ms)

    def test_a_slow_press_whose_cost_was_not_measured_or_is_over_the_cap_keeps_its_cost_red(self):
        # Gitar on #3082: the grey skips judge_one's reds, so it must not take a cost fault with it
        with tempfile.TemporaryDirectory() as tmp:
            out = press_folder(tmp, 'main_41463124217_p1_slow.log', 153, 0)
            (out / 'draw' / 'presses.jsonl').write_text(json.dumps({'press': 1, 'code': 0, 'crashes': [], 'seconds': 153, 'scored_in_places': 0, 'funnel': {}}) + '\n')
            unmeasured = gate.result(1, out)
        self.assertNotIn('not_measured', unmeasured)
        self.assertTrue(gate.judge_one(unmeasured, [])[0], 'the cost red is still said')
        with tempfile.TemporaryDirectory() as tmp:
            out = press_folder(tmp, 'main_41463124217_p1_slow.log', 153, 0)
            (out / 'draw' / 'presses.jsonl').write_text(json.dumps({'press': 1, 'code': 0, 'crashes': [], 'seconds': 153, 'scored_in_places': 0, 'funnel': {'ai_usd': 0.5}}) + '\n')
            over = gate.result(1, out)
        self.assertNotIn('not_measured', over)

    def test_a_slow_press_that_crashed_stays_red(self):
        with tempfile.TemporaryDirectory() as tmp:
            row = gate.result(1, press_folder(tmp, 'main_41463124217_p1_slow.log', 153, 0, code=1))
        self.assertNotIn('not_measured', row, 'a non-zero exit is a fault, not a slow AI')


if __name__ == '__main__':
    unittest.main()


class APressCutBeforeTheStoreOpened(unittest.TestCase):
    """Why (PR 3130, run 41807509648, persona 6, 4 Nov 2026): the Codex relay took 69 s to draft the strategy and 101 s for one decide call, the 3-minute stop came
    before any step opened the job store, and metrics.py died on "no such table: jobs". run.mjs then wrote no presses.jsonl and the row went red "wrote no numbers"
    instead of grey "AI slow" like the five personas whose press was cut a little later."""

    def test_every_script_run_after_a_press_reads_a_missing_store_as_zero(self):
        log = Path(tempfile.mkdtemp()) / 'run-1.log'
        log.write_text('[0s] Finding your first jobs…\n[175s] ⏱ Time is up (2 min 55 s) for the search: what it has not reached waits for the next search\n')
        with tempfile.TemporaryDirectory() as tmp:
            shutil.copytree(ROOT / 'config', Path(tmp) / 'config')   # what run.mjs's ensureConfig does before any press; only the stores are missing
            (Path(tmp) / 'data').mkdir()
            env = {**os.environ, 'PYTHONPATH': str(ROOT), 'JOBADABRA_NO_DOTENV': '1', 'JOBADABRA_FOLLOW_APP': '0',
                   'JOBADABRA_CONFIG_DIR': str(Path(tmp) / 'config'), 'JOBADABRA_DATA_DIR': str(Path(tmp) / 'data')}
            for script, args in (('metrics.py', []), ('crashes.py', [str(log)]), ('funnel.py', [str(log), '--since', '2026-11-04T09:39:00']), ('ttfr.py', [str(log)])):   # the four run.mjs calls per press
                done = subprocess.run([sys.executable, str(ROOT / 'tools' / 'persona-search' / script), *args], cwd=ROOT, env=env, capture_output=True, text=True)
                self.assertEqual(done.returncode, 0, f'{script}: {done.stderr[-300:]}')
                json.loads(done.stdout.strip().splitlines()[-1])
            numbers = json.loads(subprocess.run([sys.executable, str(ROOT / 'tools' / 'persona-search' / 'metrics.py')], cwd=ROOT, env=env, capture_output=True, text=True).stdout)
        self.assertEqual((numbers['open'], numbers['in_places'], numbers['local_jobs'], numbers['scored_in_places'], numbers['top10']), (0, 0, 0, 0, []))

    def test_such_a_press_with_slow_calls_is_grey(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = press_folder(tmp, 'main_41463124217_p1_slow.log', 178, 0)   # presses.jsonl now exists with zeros, as metrics.py returns them
            row = gate.result(1, out)
        self.assertTrue(row['not_measured'].startswith('AI slow'), row)
