"""Guard: money — press-tapes-auto.yml spends Codex-plan calls only when its decision says the recordings are stale, so the owner's scenario is played through that decision.

Owner, 13 Nov 2026, asked via AskUserQuestion by mac-9a ("When the replay finds many empty"): "The daily replay re-records by itself when it sees several people with 0 jobs, then re-runs.
It only spends a run when the recordings are stale." 12 Nov: 22 search merges landed after the 16:20Z re-record and the replay read 0 jobs for 14 of 18 people until sa re-recorded by hand.
"""
import importlib.util
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / 'tools' / 'press-yardstick' / 'rerecord_decision.py'
WORKFLOW = (ROOT / '.github' / 'workflows' / 'press-tapes-auto.yml').read_text()
_spec = importlib.util.spec_from_file_location('rerecord_decision', SCRIPT)
rerecord = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(rerecord)
NOW = datetime(2026, 11, 13, 14, 30, tzinfo=timezone.utc)
STALE = [3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 16, 17, 18]   # 14 of 18, the 12 Nov incident


def decide(personas, min_gaps=None, last_record=''):
    """Run the decision the workflow's `decide` job runs; returns (exit code, GITHUB_OUTPUT as a dict, GITHUB_STEP_SUMMARY text)."""
    with tempfile.TemporaryDirectory() as tmp:
        out, summary = Path(tmp, 'out'), Path(tmp, 'summary')
        out.write_text('')
        summary.write_text('')
        env = {**os.environ, 'PERSONAS': json.dumps(personas), 'GITHUB_OUTPUT': str(out), 'GITHUB_STEP_SUMMARY': str(summary)}
        env.pop('MIN_GAPS', None)
        env['LAST_RECORD'] = last_record   # the ISO time the last auto re-record started, '' = none found (the workflow reads it from its past runs)
        env['NOW'] = NOW.isoformat()
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

    def test_at_most_one_hourly_re_record_every_six_hours(self):
        # owner, 13 Nov 2026, asked via AskUserQuestion by mac-9a: "At most one every 6 h"
        two_hours_ago = (NOW - timedelta(hours=2)).isoformat()
        code, out, summary = decide(STALE, '12', two_hours_ago)
        self.assertEqual((code, out['record']), (0, 'false'), '14 stale but the last re-record started 2 h ago')
        self.assertIn('next allowed at 18:30', summary)   # 12:30 + 6 h
        self.assertIn('14 of 18', summary)
        code, out, summary = decide(STALE, '12', (NOW - timedelta(hours=7)).isoformat())
        self.assertEqual((code, out['record']), (0, 'true'), '14 stale, the last one 7 h ago')
        self.assertEqual(decide(STALE, '12', (NOW - timedelta(hours=6)).isoformat())[1]['record'], 'true', '6 h exactly is allowed')
        self.assertEqual(decide(STALE, '12', (NOW - timedelta(hours=5, minutes=59)).isoformat())[1]['record'], 'false')
        self.assertEqual(decide(STALE, '12', '')[1]['record'], 'true', 'no re-record found in the past runs: nothing to wait for')

    def test_the_daily_run_does_not_wait_for_the_six_hours_and_starts_the_clock(self):
        recent = (NOW - timedelta(hours=1)).isoformat()
        self.assertEqual(decide([7], '', recent)[1], {'record': 'true', 'daily': 'true'}, 'the 10:30 catch-all keeps its rule: any gap records')
        self.assertEqual(decide([7], '1', recent)[1]['record'], 'true')
        # its recording is a re-record like any other: the hourly look after it reads its start (see test_the_last_start_is_read_from_the_workflows_past_runs)

    def test_the_last_start_is_read_from_the_workflows_past_runs(self):
        """last_record_start() lists this workflow's runs newest first, skips this run, and takes the earliest started job of the record job that did not skip."""
        fake = {
            'runs': [{'databaseId': 5, 'createdAt': '2026-11-13T14:30:00Z'}, {'databaseId': 4, 'createdAt': '2026-11-13T13:30:00Z'}, {'databaseId': 3, 'createdAt': '2026-11-13T12:30:00Z'}],
            'jobs': {'4': [{'name': 'Re-record the people with a gap', 'conclusion': 'skipped', 'started_at': '2026-11-13T13:40:00Z'}],
                     '3': [{'name': 'Re-record the people with a gap / Tape 6', 'conclusion': 'success', 'started_at': '2026-11-13T12:50:00Z'},
                           {'name': 'Re-record the people with a gap / The batch fits the by-hand lane\'s day', 'conclusion': 'success', 'started_at': '2026-11-13T12:41:00Z'},
                           {'name': 'The 18-person table', 'conclusion': 'success', 'started_at': '2026-11-13T16:00:00Z'}]}}

        def gh(*args):
            if args[0] == 'run':
                return json.dumps(fake['runs'])
            return '\n'.join(json.dumps(job) for job in fake['jobs'].get(args[1].split('/')[-2], []))
        self.assertEqual(rerecord.last_record_start('x/y', '5', gh), datetime(2026, 11, 13, 12, 41, tzinfo=timezone.utc))
        self.assertIsNone(rerecord.last_record_start('x/y', '5', lambda *a: '[]' if a[0] == 'run' else ''))

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

    def test_decide_reads_the_past_runs_with_the_token_it_is_given(self):
        step = job('decide')
        for needed in ('actions: read', 'GH_TOKEN: ${{ github.token }}', 'REPO: ${{ github.repository }}'):
            self.assertIn(needed, step)

    def test_the_scheduled_lane_only(self):
        self.assertIn('lane: scheduled', job('record'))
        self.assertNotIn('lane: by-hand', WORKFLOW)
        self.assertRegex(WORKFLOW, r'on:\n  workflow_dispatch:')


if __name__ == '__main__':
    unittest.main()
