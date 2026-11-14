"""Guard: release — a search PR whose pair never started must say so on a line the watchers wake on, and that line is not the run's `FAILED` ending (Gitar on #4125) (14 Nov 2026: #4091 and #4100 sat ~25 min with no pair while REST quota was 0; the only trace
was a plain step line). Plays tools/ship-search-hold.sh and tools/ship-pr.sh ship_pair_lines against a stub gh: quota out, one failed dispatch then success, and a clean dispatch."""
import importlib.util
import os
import re
import shutil
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
BODY = 'Moves: p1 right jobs 0 → pending (1 run a side, same minute, usual difference 2)\n'
GH = r'''#!/bin/bash
# a stub gh: `workflow run` fails the first $FAIL_FIRST times with $FAIL_TEXT; the counter is in $STUB/runs
d="$STUB"
case "$1 $2" in
  "pr view") printf '%s\n' '{"title":"[rb] DONT MERGE x","body":"'"$(cat "$d/body")"'","isDraft":true,"labels":[]}' ;;
  "run list") echo 0 ;;
  "workflow run") n=$(( $(cat "$d/runs" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$d/runs"
    if [ "$n" -le "${FAIL_FIRST:-0}" ]; then echo "${FAIL_TEXT:-HTTP 502}" >&2; exit 1; fi ;;
  "api rate_limit") case "$*" in *reset*) echo 1794610000 ;; *) cat "$d/core" ;; esac ;;
esac
exit 0
'''


@unittest.skipUnless(shutil.which('jq') and shutil.which('bash'), 'needs jq and bash')
class PairNotStartedTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        (self.tmp / 'bin').mkdir()
        gh = self.tmp / 'bin' / 'gh'
        gh.write_text(GH)
        gh.chmod(gh.stat().st_mode | stat.S_IEXEC)
        (self.tmp / 'body').write_text(BODY.replace('\n', ' ').replace('"', ''))   # one line: the stub embeds it in JSON

    def lines(self, core='5000', fail_first=0, fail_text='HTTP 502'):
        (self.tmp / 'core').write_text(core)
        (self.tmp / 'runs').unlink(missing_ok=True)
        env = {**os.environ, 'PATH': f'{self.tmp / "bin"}{os.pathsep}{os.environ["PATH"]}', 'STUB': str(self.tmp), 'FAIL_FIRST': str(fail_first), 'FAIL_TEXT': fail_text,
               'SHIP_PAIR_RETRY_S': '0', 'CODEX_THREAD_ID': '', 'CODEX_SESSION_ID': '', 'CMUX_SURFACE_ID': ''}
        code = f'. "{ROOT / "tools" / "pr-rest-lib.sh"}"; . "{ROOT / "tools" / "ship-pr.sh"}"; tools="{ROOT / "tools"}"; step() {{ echo "ship: [0s] $*"; }}; ship_pair_lines 9 o/r'
        done = subprocess.run(['bash', '-c', code], env=env, capture_output=True, text=True, timeout=60)
        runs = int((self.tmp / 'runs').read_text()) if (self.tmp / 'runs').exists() else 0
        return done.stdout.splitlines(), runs

    def test_quota_out_ends_as_a_pair_not_started_line_with_the_reset_time_and_the_command(self):
        lines, runs = self.lines(core='0', fail_first=9, fail_text='HTTP 403: API rate limit exceeded for user ID 1.')
        fail = [l for l in lines if l.startswith('ship: PAIR NOT STARTED')]
        self.assertEqual(runs, 2, 'tried twice, then stopped')
        self.assertEqual(len(fail), 1, lines)
        self.assertRegex(fail[0], r'^ship: PAIR NOT STARTED \(HTTP 403: API rate limit exceeded.*; REST quota 0 until \d\d:\d\d\); start it by hand: gh workflow run search-pair.yml -R o/r -f pr=9 -f people=')
        self.assertFalse([l for l in lines if l.startswith('PAIR NOT STARTED')], 'the hold script\'s own marker never reaches the log')
        self.assertFalse([l for l in lines if l.startswith('ship: FAILED')], 'a live held PR is never reported with the run\'s ending word')

    def test_a_bar_in_ghs_words_never_corrupts_the_command(self):
        """Gitar on #4125: `|` splits the reason from the command, so gh's own `|` must not move the split."""
        lines, _ = self.lines(core='4000', fail_first=9, fail_text='HTTP 502: a | b')
        line = [l for l in lines if l.startswith('ship: PAIR NOT STARTED')][0]
        self.assertIn('(HTTP 502: a / b); start it by hand: gh workflow run search-pair.yml -R o/r -f pr=9', line)

    def test_a_failure_with_quota_left_does_not_claim_the_quota_is_out(self):
        lines, _ = self.lines(core='4000', fail_first=9, fail_text='HTTP 500')
        fail = [l for l in lines if l.startswith('ship: PAIR NOT STARTED')]
        self.assertEqual(len(fail), 1, lines)
        self.assertNotIn('REST quota', fail[0])

    def test_one_failed_dispatch_is_retried_and_then_started(self):
        lines, runs = self.lines(fail_first=1)
        self.assertEqual(runs, 2)
        self.assertFalse([l for l in lines if 'FAILED' in l], lines)
        self.assertTrue([l for l in lines if 'started its before/after pair' in l], lines)

    def test_a_clean_dispatch_is_asked_once(self):
        lines, runs = self.lines()
        self.assertEqual(runs, 1)
        self.assertFalse([l for l in lines if 'FAILED' in l], lines)

    def test_the_line_wakes_the_session_and_ends_no_wait(self):
        spec = importlib.util.spec_from_file_location('claude_pr_events', ROOT / 'tools' / 'claude-pr-events.py')
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        lines, _ = self.lines(core='0', fail_first=9, fail_text='HTTP 403: API rate limit exceeded')
        self.assertTrue(any(re.match(mod.WAKE, l) for l in lines if l.startswith('ship: PAIR NOT STARTED')), lines)
        wait = (ROOT / 'tools' / 'ship-wait.sh').read_text()
        self.assertIn('PAIR NOT STARTED', re.search(r"^events='(.*)'$", wait, re.M).group(1), 'ship-wait.sh returns on it, like GITAR STALE')


if __name__ == '__main__':
    unittest.main()
