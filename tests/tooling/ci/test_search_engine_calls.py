"""Guard: release — a night measured partly or wholly by Claude instead of Codex must say so on each person's row, or two nights by different models read as one series.
tools/persona-search/engine_calls.py counts the relay's `engine <name>` per answered call (codex.mjs timedRelay) for the press (run.log) and the judge (judge.log)."""
import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'tools/persona-search'))
spec = importlib.util.spec_from_file_location('engine_calls', ROOT / 'tools/persona-search/engine_calls.py')
engine_calls = importlib.util.module_from_spec(spec)
spec.loader.exec_module(engine_calls)
LINE = 'relay: small total 900 broker 800 waited 100 in-flight 1 prompt-chars 50 kind {kind} start 1 status {status} sent yes tools 0 out-tokens 3{tail}'


class EngineCalls(unittest.TestCase):
    def test_a_mixed_night_counts_each_engine_and_names_the_judge(self):
        with tempfile.TemporaryDirectory() as out:
            Path(out, 'run.log').write_text('\n'.join([LINE.format(kind='place_triage', status=200, tail=' engine codex')] * 3 +
                                                      [LINE.format(kind='score', status=200, tail=' engine claude'),
                                                       LINE.format(kind='score', status=503, tail=' why subs: codex failed, claude failed'),
                                                       LINE.format(kind='old', status=200, tail='')]) + '\n')
            Path(out, 'judge.log').write_text(LINE.format(kind='unlabelled', status=200, tail=' engine codex') + '\n')
            self.assertEqual(engine_calls.row_fields(out), {'calls_by_engine': {'codex': 3, 'claude': 1}, 'judged_by': 'codex'})

    def test_no_log_or_an_older_relay_says_nothing_rather_than_a_guess(self):
        with tempfile.TemporaryDirectory() as out:
            self.assertEqual(engine_calls.row_fields(out), {})
            Path(out, 'run.log').write_text(LINE.format(kind='x', status=200, tail='') + '\n')
            self.assertEqual(engine_calls.row_fields(out), {})


class NotRun(unittest.TestCase):
    """Guard: release — a night whose AI never answered (Codex and Claude both out) measured nothing: drawn as zeros it reads as a broken search and sets a
    false floor (sa, 10 Nov 2026, WP5 2/6). It is "not run" on the row and, when nobody was answered, on the night (jobadabra-web #523 draws it as a gap)."""
    REFUSED = LINE.format(kind='place_triage', status=503, tail=' why subs: codex ran-out, claude failed')

    def test_a_press_whose_every_call_was_refused_is_not_run_with_the_brokers_reason(self):
        with tempfile.TemporaryDirectory() as out:
            Path(out, 'run.log').write_text(self.REFUSED + '\n' + self.REFUSED + '\n')
            self.assertEqual(engine_calls.row_fields(out), {'not_run': 'subs: codex ran-out, claude failed'})
            Path(out, 'run.log').write_text(self.REFUSED + '\n' + LINE.format(kind='score', status=200, tail=' engine claude') + '\n')
            self.assertNotIn('not_run', engine_calls.row_fields(out), 'one answered call: the press ran (partly), it is measured as before')
            Path(out, 'run.log').write_text(LINE.format(kind='score', status='error', tail='').replace(' sent yes', ' sent no') + '\n')
            self.assertEqual(engine_calls.row_fields(out), {'not_run': 'status error'}, 'the broker never reached (no why) is not run too')

    def test_a_refused_press_is_not_run_only_when_it_ran_clean(self):
        import json
        import gate

        def press(tmp, code):
            out = Path(tmp)
            (out / 'draw').mkdir()
            (out / 'draw' / 'presses.jsonl').write_text(json.dumps({'press': 1, 'code': code, 'crashes': [], 'seconds': 40, 'scored_in_places': 0, 'funnel': {'ai_usd': 0}}) + '\n')
            (out / 'run.log').write_text(self.REFUSED + '\n')
            (out / 'judged.json').write_text(json.dumps({'usd': 0, 'rows': []}))
            return gate.result(1, out)
        with tempfile.TemporaryDirectory() as tmp:
            clean = press(tmp, 0)
        self.assertEqual(clean['not_measured'], 'not run: subs: codex ran-out, claude failed')
        self.assertEqual(gate.row_verdict(clean)[2], 'not-run')
        with tempfile.TemporaryDirectory() as tmp:
            failed = press(tmp, 1)
        self.assertNotIn('not_measured', failed)
        self.assertEqual(gate.row_verdict(failed)[2], 'fault', 'a press that exited non-zero is a fault even when its AI was refused (/code-review on 2/6)')

    def test_a_night_nobody_was_answered_is_not_run_never_red_never_zero(self):
        import gate
        row = lambda n: {'persona': n, 'not_run': 'subs: codex ran-out, claude failed', 'not_measured': 'not run: subs: codex ran-out, claude failed',
                         'seconds': 30, 'code': 0, 'crashes': 0, 'found': 0, 'local': 0, 'usd': 0, 'billing': 'subscription'}
        self.assertEqual(gate.row_verdict(row(1))[2], 'not-run')
        night = gate.compare({n: row(n) for n in range(1, len(gate.PERSONAS) + 1)}, [])
        self.assertEqual(night['state'], 'not-run')
        self.assertTrue(night['head'].startswith('⚪ not run: no AI answered (subs: codex ran-out, claude failed)'), night['head'])
        self.assertEqual({r['kind'] for r in night['rows']}, {'not-run'})
        slow = lambda n: {**row(n), 'not_run': None, 'not_measured': 'AI slow (a call took 25 s on average)', 'code': 0}
        mixed = gate.compare({n: row(n) if n == 1 else slow(n) for n in range(1, len(gate.PERSONAS) + 1)}, [])
        self.assertEqual(mixed['state'], 'neutral')
        self.assertNotIn('found 0', mixed['head'])


if __name__ == '__main__':
    unittest.main()
