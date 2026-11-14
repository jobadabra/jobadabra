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
        fake.write_text('#!/bin/sh\nsleep "${FAKE_SLEEP:-0}"\nprintf "%s" "$FAKE_OUT"\nexit "${FAKE_RC:-0}"\n')
        fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
        self.log = self.tmp / 'rest.log'

    def gh(self, *args, out='', rc=0, sleep=0, timeout=60):
        env = {**os.environ, 'PATH': f'{ROOT / "tools" / "bin"}{os.pathsep}{self.tmp / "real"}{os.pathsep}{os.environ["PATH"]}', 'GH_REST_LOG': str(self.log),
               'GH_GRAPHQL_LOG': 'off', 'FAKE_OUT': out, 'FAKE_RC': str(rc), 'FAKE_SLEEP': str(sleep), 'JOBADABRA_SESSION': 'sess-x'}
        return subprocess.run(['gh', *args], env=env, capture_output=True, timeout=timeout)  # bytes: \r\n must survive

    def rows(self):
        return [line.split('\t') for line in self.log.read_text().splitlines()] if self.log.exists() else []

    def test_a_conditional_read_passes_through_unchanged_and_is_logged_as_304(self):
        out = 'HTTP/2.0 304 Not Modified\r\nEtag: "x"\r\n\r\n'
        done = self.gh('api', '-i', '-H', 'If-None-Match: "x"', 'repos/jobadabra/jobadabra/commits/' + 'a' * 40 + '/status?per_page=1', out=out, rc=1)
        self.assertEqual((done.returncode, done.stdout), (1, out.encode()), 'before the shim held the output: same bytes, same exit code')
        row = self.rows()[-1]  # the provisional line comes first, the result last
        self.assertEqual((row[1], row[4], row[5]), ('sess-x', 'api repos/o/r/commits/S/status', '304'))
        self.assertTrue(row[6], 'a held call carries its call id')

    def test_a_200_and_a_call_without_headers_are_spent_and_a_graphql_call_is_not_logged_here(self):
        self.gh('api', '-i', 'repos/o/r/pulls/7', out='HTTP/2.0 200 OK\r\n\r\n{}')
        self.gh('api', 'repos/o/r/pulls/7/comments', '--jq', '.[0]', out='[]')
        self.gh('api', 'graphql', '-f', 'query=x', out='{}')
        self.assertEqual([(r[4], r[5]) for r in self.rows()], [('api repos/o/r/pulls/N', '?'), ('api repos/o/r/pulls/N', '200'), ('api repos/o/r/pulls/N/comments', '-')])

    def test_off_logs_nothing_and_the_report_counts_a_304_as_free(self):
        self.gh('api', '-i', 'repos/o/r/pulls/7', out='HTTP/2.0 304 Not Modified\r\n\r\n', rc=1)
        self.gh('api', '-i', 'repos/o/r/pulls/8', out='HTTP/2.0 200 OK\r\n\r\n{}')
        env = {**os.environ, 'GH_REST_LOG': str(self.log)}
        report = subprocess.run(['bash', str(ROOT / 'tools' / 'gh-rest-report.sh'), '1'], env=env, capture_output=True, text=True, timeout=60).stdout
        self.assertRegex(report, r'1 REST calls spent since .* = 1/h \(\+ 1 free 304 reads, 0 still running\)')
        env['GH_REST_LOG'] = 'off'
        self.log.unlink()
        env2 = {**os.environ, 'PATH': f'{ROOT / "tools" / "bin"}{os.pathsep}{self.tmp / "real"}{os.pathsep}{os.environ["PATH"]}', 'GH_REST_LOG': 'off', 'GH_GRAPHQL_LOG': 'off', 'FAKE_OUT': 'x'}
        subprocess.run(['gh', 'api', 'repos/o/r'], env=env2, capture_output=True, timeout=60)
        self.assertFalse(self.log.exists())

    def report(self, *args, pending_s=0):
        return subprocess.run(['bash', str(ROOT / 'tools' / 'gh-rest-report.sh'), *args], env={**os.environ, 'GH_REST_LOG': str(self.log), 'PENDING_S': str(pending_s)}, capture_output=True, text=True, timeout=60)

    def test_a_held_call_killed_before_gh_returns_is_still_counted_and_a_call_without_a_status_line_logs_a_dash(self):
        """Gitar on #4151: the line was written only after gh returned, so a timed-out call (the slow ones) was missing; an empty status broke the format."""
        with self.assertRaises(subprocess.TimeoutExpired):
            self.gh('api', '-i', 'repos/o/r/pulls/7', out='HTTP/2.0 200 OK\r\n', sleep=5, timeout=1)
        self.assertEqual([(r[4], r[5]) for r in self.rows()], [('api repos/o/r/pulls/N', '?')])
        self.assertRegex(self.report('1').stdout, r'1 REST calls spent')
        self.gh('api', '-i', 'repos/o/r/pulls/8', out='partial', rc=4)
        self.assertEqual(self.rows()[-1][5], '-')

    def test_a_returned_held_call_counts_once_not_twice(self):
        self.gh('api', '-i', 'repos/o/r/pulls/7', out='HTTP/2.0 200 OK\r\n\r\n{}')
        self.assertEqual(len(self.rows()), 2, 'a provisional line, then the result with the same call id')
        self.assertRegex(self.report('1').stdout, r'1 REST calls spent')

    def test_the_report_refuses_hours_that_are_not_a_whole_number(self):
        self.gh('api', 'repos/o/r/pulls/7', out='{}')
        for bad in ('abc', '0.5', '0'):
            done = self.report(bad)
            self.assertEqual(done.returncode, 2, bad)
            self.assertIn('whole number', done.stderr)

    def test_a_call_still_running_is_shown_apart_and_not_charged_until_it_is_old(self):
        """Gitar on #4155: a "?" line of a call in flight right now is not spent yet; one that never returned is."""
        with self.assertRaises(subprocess.TimeoutExpired):
            self.gh('api', '-i', 'repos/o/r/pulls/7', out='x', sleep=5, timeout=1)
        self.assertRegex(self.report('1', pending_s=3600).stdout, r'0 REST calls spent .*\(\+ 0 free 304 reads, 1 still running\)')
        self.assertRegex(self.report('1', pending_s=0).stdout, r'1 REST calls spent .*\(\+ 0 free 304 reads, 0 still running\)')

    def test_a_paginated_read_is_not_held_so_it_still_streams(self):
        self.gh('api', '-i', '--paginate', 'repos/o/r/pulls', out='HTTP/2.0 200 OK\r\n')
        self.assertEqual([(r[4], r[5], len(r)) for r in self.rows()], [('api repos/o/r/pulls', '-', 6)])


if __name__ == '__main__':
    unittest.main()
