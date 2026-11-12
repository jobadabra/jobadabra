"""Guard: money — press-tapes-auto.yml spends Codex-plan calls only when its decision says the recordings are stale, so the owner's scenario is played through that decision.

Owner, 13 Nov 2026, asked via AskUserQuestion by mac-9a ("When the replay finds many empty"): "The daily replay re-records by itself when it sees several people with 0 jobs, then re-runs.
It only spends a run when the recordings are stale." 12 Nov: 22 search merges landed after the 16:20Z re-record and the replay read 0 jobs for 14 of 18 people until sa re-recorded by hand.
"""
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / 'tools' / 'press-yardstick' / 'rerecord_decision.py'
WORKFLOW = (ROOT / '.github' / 'workflows' / 'press-tapes-auto.yml').read_text()


def decide(personas, min_gaps=None):
    """Run the decision the workflow's `decide` job runs; returns (exit code, GITHUB_OUTPUT as a dict, GITHUB_STEP_SUMMARY text)."""
    with tempfile.TemporaryDirectory() as tmp:
        out, summary = Path(tmp, 'out'), Path(tmp, 'summary')
        out.write_text('')
        summary.write_text('')
        env = {**os.environ, 'PERSONAS': json.dumps(personas), 'GITHUB_OUTPUT': str(out), 'GITHUB_STEP_SUMMARY': str(summary)}
        env.pop('MIN_GAPS', None)
        if min_gaps is not None:
            env['MIN_GAPS'] = min_gaps
        done = subprocess.run([sys.executable, '-I', str(SCRIPT)], env=env, capture_output=True, text=True, timeout=30)
        return done.returncode, dict(line.split('=', 1) for line in out.read_text().splitlines()), summary.read_text()


def job(name):
    """The text of one job of the workflow (from its `  name:` line to the next job)."""
    start = WORKFLOW.index(f'\n  {name}:')
    nxt = re.search(r'\n  [a-z]+:\n', WORKFLOW[start + 1:])
    return WORKFLOW[start:start + 1 + nxt.start()] if nxt else WORKFLOW[start:]


class WhenTheReplayFindsManyEmpty(unittest.TestCase):
    def test_fourteen_of_eighteen_empty_records_once_and_replays_again(self):
        people = [3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 16, 17, 18]
        code, out, summary = decide(people, '12')
        self.assertEqual((code, out['record']), (0, 'true'))
        self.assertIn('14', summary)
        self.assertEqual(out['daily'], 'false', 'an hourly look is not the day\'s run: its table waits for a recording')
        # the chain: decide -> guard (waits for the broker) -> record (scheduled lane) -> band -> table (the replay again)
        self.assertIn("needs.decide.outputs.record == 'true'", job('guard'))
        self.assertRegex(job('record'), r'needs: \[[^\]]*guard')
        self.assertIn('lane: scheduled', job('record'))
        self.assertIn('needs.record.result', job('table'))
        self.assertIn('record', re.search(r'needs: \[[^\]]*\]', job('table')).group(0))
        self.assertIn('band', re.search(r'needs: \[[^\]]*\]', job('table')).group(0))

    def test_zero_or_one_empty_records_nothing_and_says_it_waits(self):
        for people in ([], [9]):
            code, out, summary = decide(people, '12')
            self.assertEqual((code, out['record'], out['daily']), (0, 'false', 'false'), f'{len(people)} gap(s) is below the line')
            self.assertIn(f'{len(people)} of 18', summary)
            self.assertIn('waits', summary)

    def test_the_line_is_inclusive(self):
        self.assertEqual(decide(list(range(1, 12)), '12')[1]['record'], 'false')
        self.assertEqual(decide(list(range(1, 13)), '12')[1]['record'], 'true')

    def test_the_daily_run_stays_the_catch_all(self):
        # started with no input (10:30, or by hand): any gap records, and its table runs even with nobody to record (#3939: the day's replay on main)
        self.assertEqual(decide([7])[1], {'record': 'true', 'daily': 'true'})
        code, out, _ = decide([])
        self.assertEqual((code, out), (0, {'record': 'false', 'daily': 'true'}))
        self.assertEqual(decide([7], '1')[1]['record'], 'true')

    def test_an_unreadable_line_fails_instead_of_spending(self):
        for bad in ('many', '0', '-3', '2.5'):
            self.assertEqual(decide([1, 2, 3], bad)[0], 1, bad)

    def test_a_second_trigger_while_one_is_pending_still_makes_one_record(self):
        self.assertRegex(WORKFLOW, r'concurrency:\n  group: press-tapes-auto\n  cancel-in-progress: false')   # one running + one pending: a newer start replaces the pending one, never a second recording
        self.assertNotIn('search-personas', re.search(r'concurrency:\n  group: [^\n]*', WORKFLOW).group(0))
        self.assertIn('newer automatic run', job('guard'))   # the older run stands down when a newer one is pending

    def test_the_scheduled_lane_only(self):
        self.assertIn('lane: scheduled', job('record'))
        self.assertNotIn('lane: by-hand', WORKFLOW)
        self.assertRegex(WORKFLOW, r'on:\n  workflow_dispatch:')


if __name__ == '__main__':
    unittest.main()
