"""Guard: release — the gh shim (tools/bin/gh) logs REST calls so a quota outage names its caller (14 Nov 2026, rb: three outages, ~5,750 calls/h on a 5,000/h token, no log), and it
changes nothing for the caller: `gh api -i` is run with its output held to read the status, so its stdout and exit code must pass through byte for byte (tools/pr-rest-lib.sh pr_get parses
that output; a 304 makes gh exit 1). A fake `gh` stands in for the real one (files, no network)."""
import os
import shutil
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


@unittest.skipUnless(shutil.which('bash') and shutil.which('awk'), 'needs bash and awk')
class GhRestLogTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        (self.tmp / 'real').mkdir()
        fake = self.tmp / 'real' / 'gh'
        fake.write_text('#!/bin/sh\nprintf "%s" "$FAKE_OUT"\nexit "${FAKE_RC:-0}"\n')
        fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
        self.log = self.tmp / 'rest.log'

    def gh(self, *args, out='', rc=0):
        env = {**os.environ, 'PATH': f'{ROOT / "tools" / "bin"}{os.pathsep}{self.tmp / "real"}{os.pathsep}{os.environ["PATH"]}', 'GH_REST_LOG': str(self.log),
               'GH_GRAPHQL_LOG': 'off', 'FAKE_OUT': out, 'FAKE_RC': str(rc), 'JOBADABRA_SESSION': 'sess-x'}
        return subprocess.run(['gh', *args], env=env, capture_output=True, timeout=60)  # bytes: \r\n must survive

    def rows(self):
        return [line.split('\t') for line in self.log.read_text().splitlines()] if self.log.exists() else []

    def test_a_conditional_read_passes_through_unchanged_and_is_logged_as_304(self):
        out = 'HTTP/2.0 304 Not Modified\r\nEtag: "x"\r\n\r\n'
        done = self.gh('api', '-i', '-H', 'If-None-Match: "x"', 'repos/jobadabra/jobadabra/commits/' + 'a' * 40 + '/status?per_page=1', out=out, rc=1)
        self.assertEqual((done.returncode, done.stdout), (1, out.encode()), 'before the shim held the output: same bytes, same exit code')
        (row,) = self.rows()
        self.assertEqual((row[1], row[4], row[5]), ('sess-x', 'api repos/o/r/commits/S/status', '304'))

    def test_a_200_and_a_call_without_headers_are_spent_and_a_graphql_call_is_not_logged_here(self):
        self.gh('api', '-i', 'repos/o/r/pulls/7', out='HTTP/2.0 200 OK\r\n\r\n{}')
        self.gh('api', 'repos/o/r/pulls/7/comments', '--jq', '.[0]', out='[]')
        self.gh('api', 'graphql', '-f', 'query=x', out='{}')
        self.assertEqual([(r[4], r[5]) for r in self.rows()], [('api repos/o/r/pulls/N', '200'), ('api repos/o/r/pulls/N/comments', '-')])

    def test_off_logs_nothing_and_the_report_counts_a_304_as_free(self):
        self.gh('api', '-i', 'repos/o/r/pulls/7', out='HTTP/2.0 304 Not Modified\r\n\r\n', rc=1)
        self.gh('api', '-i', 'repos/o/r/pulls/8', out='HTTP/2.0 200 OK\r\n\r\n{}')
        env = {**os.environ, 'GH_REST_LOG': str(self.log)}
        report = subprocess.run(['bash', str(ROOT / 'tools' / 'gh-rest-report.sh'), '1'], env=env, capture_output=True, text=True, timeout=60).stdout
        self.assertRegex(report, r'1 REST calls spent since .* = 1/h \(\+ 1 free 304 reads\)')
        env['GH_REST_LOG'] = 'off'
        self.log.unlink()
        env2 = {**os.environ, 'PATH': f'{ROOT / "tools" / "bin"}{os.pathsep}{self.tmp / "real"}{os.pathsep}{os.environ["PATH"]}', 'GH_REST_LOG': 'off', 'GH_GRAPHQL_LOG': 'off', 'FAKE_OUT': 'x'}
        subprocess.run(['gh', 'api', 'repos/o/r'], env=env2, capture_output=True, timeout=60)
        self.assertFalse(self.log.exists())


if __name__ == '__main__':
    unittest.main()
