"""Guard: release — the guard of press-tapes-auto.yml decides alone whether an automatic re-record starts, so its three verdicts are played with a fake `gh`.

Why (12 Nov 2026, run 43112178073 after #3840): the guard waited 22 min on a running all-18 Search check, stood down, recorded nobody and the run ended GREEN, so the gap
stayed for good. Now: a held broker is waited for (up to 5 h) and a run that ends still held fails (RED); an older run stands down when a newer one is pending; a free broker goes.
"""
import json
import os
import re
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
WORKFLOW = (ROOT / '.github' / 'workflows' / 'press-tapes-auto.yml').read_text()

FAKE_GH = '''#!/bin/sh
# The runs gh lists are FAKE_RUNS (JSON); the workflow's own --jq filter is run on them by the real jq, so a wrong filter shows.
jq_expr=""
while [ $# -gt 0 ]; do [ "$1" = "--jq" ] && jq_expr="$2"; args="$args $1"; shift; done
case "$args" in
  *"--jq .created_at"*) echo 2026-11-11T22:29:23Z ;;
  *"--workflow press-tapes-auto.yml --status pending"*) [ -n "$FAKE_RUNS" ] && printf '%s' "$FAKE_RUNS" | jq -r "$jq_expr" ;;
  *"--workflow search-personas.yml --status in_progress"*) [ -n "$FAKE_HELD" ] && echo "$FAKE_HELD" ;;
esac
exit 0
'''
FAKE_DATE = '''#!/bin/sh
case "$*" in *%H*) echo "${FAKE_HH:-12}" ;; *%M*) echo "${FAKE_MM:-00}" ;; esac
'''
FAKE_CURL = '''#!/bin/sh
echo '{"queue": {"active": 0, "waiting": {"pr": 0, "scheduled": 0, "bench": 0}}}'
'''


def guard_script():
    """The guard job's own `run:` script, with the 2-minute pause and the 150 looks shortened so a test takes a moment."""
    job = WORKFLOW[WORKFLOW.index('\n  guard:'):WORKFLOW.index('\n  record:')]
    body = job[job.index('        run: |\n') + len('        run: |\n'):]
    script = '\n'.join(line[10:] for line in body.splitlines())
    script = script.replace('sleep 120', 'sleep 0')
    return re.sub(r'seq 1 150', 'seq 1 3', script)


def play(held='', newer='', hh='12', mm='00', title='Press tapes auto · the daily re-record'):
    """Run the guard with a fake gh/curl; returns (exit code, GITHUB_OUTPUT text, GITHUB_STEP_SUMMARY text)."""
    with tempfile.TemporaryDirectory() as tmp:
        for name, text in (('gh', FAKE_GH), ('curl', FAKE_CURL), ('date', FAKE_DATE)):
            path = Path(tmp, name)
            path.write_text(text)
            path.chmod(0o755)
        out, summary = Path(tmp, 'out'), Path(tmp, 'summary')
        out.write_text('')
        summary.write_text('')
        env = {**os.environ, 'PATH': f'{tmp}:{os.environ["PATH"]}', 'REPO': 'x/y', 'GH_TOKEN': 't', 'GITHUB_RUN_ID': '1',
               'GITHUB_OUTPUT': str(out), 'GITHUB_STEP_SUMMARY': str(summary), 'FAKE_HELD': held, 'FAKE_RUNS': json.dumps([{'createdAt': '2026-11-12T01:00:00Z', 'url': newer, 'displayTitle': title}]) if newer else '', 'FAKE_HH': hh, 'FAKE_MM': mm}
        done = subprocess.run(['bash', '-c', guard_script()], env=env, capture_output=True, text=True, timeout=60)
        return done.returncode, out.read_text(), summary.read_text(), done.stdout + done.stderr


class AutoGuard(unittest.TestCase):
    def test_a_broker_held_to_the_end_fails_the_run_instead_of_ending_green(self):
        code, out, summary, _ = play(held='https://github.com/x/y/actions/runs/9')
        self.assertEqual(code, 1, 'a stand-down that is green hides a gap that never closes (run 43112178073)')
        self.assertIn('go=false', out)
        self.assertIn('Not recorded', summary)

    def test_an_older_run_stands_down_when_a_newer_one_is_pending(self):
        code, out, summary, _ = play(newer='https://github.com/x/y/actions/runs/10')
        self.assertEqual(code, 0)
        self.assertIn('go=false', out)
        self.assertIn('newer automatic run', summary)

    def test_only_a_daily_or_by_hand_run_makes_an_older_guard_stand_down(self):
        # Gitar on #3947: a look, and the run a look queued (it applies the line of 12 and the 6 h), record nothing the older run's catch-all would not: standing down for them loses the day's re-record
        for title, stands_down in (('Press tapes auto · the daily re-record', True), ('Press tapes auto · the hourly look', False), ('Press tapes auto · queued by the hourly look', False)):
            code, out, summary, _ = play(newer='https://github.com/x/y/actions/runs/10', title=title)
            self.assertEqual(code, 0, title)
            self.assertEqual('go=false' in out and 'newer automatic run' in summary, stands_down, title)
            self.assertEqual('go=true' in out, not stands_down, title)

    def test_a_free_broker_goes_and_takes_three_at_once(self):
        code, out, _, _ = play(hh='12')
        self.assertEqual(code, 0)
        self.assertIn('go=true', out)
        self.assertIn('parallel=3', out)

    def test_the_hour_before_the_night_run_and_ten_minutes_after_hold_the_broker_too(self):
        for hh, mm in (('23', '00'), ('23', '59'), ('00', '09')):
            code, out, summary, _ = play(hh=hh, mm=mm)
            self.assertEqual(code, 1, f'{hh}:{mm} UTC is the night Search check hour: a recording begun then would run beside it')
            self.assertIn('Not recorded', summary)
        for hh, mm in (('22', '59'), ('00', '10'), ('12', '00')):
            code, out, _, _ = play(hh=hh, mm=mm)
            self.assertEqual((code, 'go=true' in out), (0, True), f'{hh}:{mm} UTC is free')

    def test_the_wait_is_hours_not_minutes(self):
        job = WORKFLOW[WORKFLOW.index('\n  guard:'):WORKFLOW.index('\n  record:')]
        self.assertIn('seq 1 150', job)
        self.assertIn('sleep 120', job)
        self.assertRegex(job, r'timeout-minutes: (3\d\d)')


if __name__ == '__main__':
    unittest.main()
