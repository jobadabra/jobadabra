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


if __name__ == '__main__':
    unittest.main()
