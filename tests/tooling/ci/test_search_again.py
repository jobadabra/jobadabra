"""Guard: release — a person the AI was too slow or too busy for runs once more at the end of the same night and the row says so; without it each such
night is a gap in that person's line (28 person-nights in the last 14 nights), and without the mark a second try would read as a first (sa, 10 Nov 2026, WP5 3/6).
tools/persona-search/again.py picks the persons and marks the rows; search-personas.yml runs the persona steps once more for them."""
import json
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'tools/persona-search'))
import again  # noqa: E402

WORKFLOW = (ROOT / '.github/workflows/search-personas.yml').read_text(encoding='utf-8')


def night(folder, rows):
    for row in rows:
        out = Path(folder) / f"search-personas-p{row['persona']}"
        out.mkdir(parents=True)
        (out / 'result.json').write_text(json.dumps(row))


class WhoRunsAgain(unittest.TestCase):
    def test_only_a_slow_or_busy_ai_runs_again_never_not_run_or_a_fault(self):
        with tempfile.TemporaryDirectory() as tmp:
            night(tmp, [{'persona': 1, 'local': 3},
                        {'persona': 2, 'not_measured': 'AI slow (a call took 25 s on average)'},
                        {'persona': 3, 'not_measured': 'AI queue full (waited 90 s)'},
                        {'persona': 4, 'not_run': 'subs: codex ran-out, claude failed', 'not_measured': 'not run: subs: codex ran-out, claude failed'},
                        {'persona': 5, 'code': 1, 'error': 'the judge wrote no verdicts (see judge.log)'},
                        {'persona': 6, 'not_measured': 'no trusted GitHub OIDC token for Codex'},
                        {'persona': 7, 'again': 1, 'not_measured': 'AI slow (a call took 30 s on average)'}])
            self.assertEqual(again.wanted(tmp), {2: 'AI slow (a call took 25 s on average)', 3: 'AI queue full (waited 90 s)'})
            listed = subprocess.run([sys.executable, str(ROOT / 'tools/persona-search/again.py'), 'list', tmp, f'{tmp}/again'], capture_output=True, text=True, check=True)
            self.assertEqual(listed.stdout.strip(), 'personas=[2, 3]')
            self.assertEqual(json.loads(Path(tmp, 'again/first-try.json').read_text()), {'2': 'AI slow (a call took 25 s on average)', '3': 'AI queue full (waited 90 s)'})

    def test_a_second_try_is_marked_with_its_first_try_and_a_missing_one_is_not(self):
        with tempfile.TemporaryDirectory() as tmp:
            night(tmp, [{'persona': 2, 'local': 4}, {'persona': 3, 'not_measured': 'AI queue full (waited 90 s)'}])
            again.second(Path(tmp, 'search-personas-p2'))   # p2's second try wrote its row; p3's second try left the first row (no `again`)
            Path(tmp, 'first-try.json').write_text(json.dumps({'2': 'AI slow (a call took 25 s on average)', '3': 'AI queue full (waited 90 s)'}))
            self.assertEqual(again.mark(tmp, Path(tmp, 'first-try.json')), [2])
            rows = {n: row for n, (_, row) in again.results(tmp).items()}
            self.assertEqual(rows[2], {'persona': 2, 'local': 4, 'again': 1, 'first_try': 'AI slow (a call took 25 s on average)'})
            self.assertNotIn('again', rows[3])
            self.assertEqual(again.mark(tmp, Path(tmp, 'none.json')), [], 'no list (first pass skipped): nothing marked')
            again.second(Path(tmp, 'no-such-press'))   # a second try that wrote no row: nothing to mark, no crash (Gitar on #3716)


class TheNightRunsThem(unittest.TestCase):
    def job(self, name):
        found = re.search(rf'^  {re.escape(name)}:\n(.*?)(?=^  [a-z][\w-]*:\n|\Z)', WORKFLOW, re.M | re.S)
        self.assertIsNotNone(found, name)
        return found.group(1)

    def test_the_second_try_runs_the_persona_steps_alone_after_the_first_pass(self):
        self.assertIn('    steps: &persona-steps', self.job('persona'))
        second = self.job('again')
        self.assertIn('    steps: *persona-steps', second)
        self.assertIn('persona: ${{ fromJSON(needs.again-list.outputs.personas) }}', second)
        self.assertIn('max-parallel: 1', second)
        self.assertIn('needs.again-list.outputs.personas != \'[]\'', second)
        self.assertIn('again.py list results again', self.job('again-list'))

    def test_the_second_try_replaces_the_files_and_is_marked_before_the_compare(self):
        persona = self.job('persona')
        self.assertIn('overwrite: true', persona)
        self.assertIn("if: always() && github.job == 'again' && hashFiles('out/result.json') != ''", persona)
        self.assertIn('run: python3 tools/persona-search/again.py second out', persona)
        compare = self.job('compare')
        self.assertRegex(compare, r'needs: \[room, turn, persona, again, reference\]')
        self.assertLess(compare.index('again.py mark results again/first-try.json'), compare.index('gate.py compare'))
        self.assertRegex(self.job('reference'), r'needs: \[room, turn, persona, again\]')


if __name__ == '__main__':
    unittest.main()
