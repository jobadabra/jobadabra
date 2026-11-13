"""Guard: release — an unreadable "which PR does this branch have" lookup must never read as "none": ship.sh would push and try to create a second PR (422) with no watcher, so the PR goes unwatched and
its reds and comments are missed (13 Nov 2026: bl on #4022 and gq on #4031, both with REST core at 0; impact medium). tools/pr-rest-lib.sh pr_of_head and tools/ship-pr.sh ship_pr_lookup run against the
fake gh of tests/fake_gh_rest.py (files, no network): REST fine, REST refused with core at 0 (GraphQL answers), REST refused with quota left (any other failure)."""
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
HEAD_PATH = 'repos/o/r/pulls?state=open&head=o:topic&per_page=1'


@unittest.skipUnless(shutil.which('jq') and shutil.which('bash'), 'needs jq and bash')
class PrOfHeadUnknownTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        (self.tmp / 'bin').mkdir()
        (self.tmp / 'rest').mkdir()
        gh = self.tmp / 'bin' / 'gh'
        gh.write_text(f'#!/bin/sh\nexec "{sys.executable}" "{ROOT / "tests" / "fake_gh_rest.py"}" "$@"\n')
        gh.chmod(gh.stat().st_mode | stat.S_IEXEC)

    def set_rest(self, path, body):
        (self.tmp / 'rest' / re.sub(r'[^A-Za-z0-9]', '_', path)).write_text(json.dumps(body))

    def out(self, core=None, graphql=None):
        """REST refused with `core` left (None: REST fine); `graphql` is the body the fake answers for the head lookup."""
        for name in ('refuse_rest', 'rate_core', 'graphql_ofhead.json', 'calls'):
            (self.tmp / name).unlink(missing_ok=True)
        if core is not None:
            (self.tmp / 'refuse_rest').write_text('')
            (self.tmp / 'rate_core').write_text(str(core))
        if graphql is not None:
            (self.tmp / 'graphql_ofhead.json').write_text(json.dumps(graphql))
        (self.tmp / 'rate_reset').write_text('1794610000')

    def run_shell(self, code):
        env = {**os.environ, 'PATH': f'{self.tmp / "bin"}{os.pathsep}{os.environ["PATH"]}', 'FAKE_GH_DIR': str(self.tmp), 'PR_REST_CACHE': str(self.tmp / 'cache'),
               'CODEX_THREAD_ID': '', 'CODEX_SESSION_ID': '', 'CMUX_SURFACE_ID': ''}
        return subprocess.run(['bash', '-c', f'. "{ROOT / "tools" / "pr-rest-lib.sh"}"; . "{ROOT / "tools" / "ship-pr.sh"}"; {code}'], env=env, capture_output=True, text=True, timeout=60)

    def calls(self):
        f = self.tmp / 'calls'
        return f.read_text().splitlines() if f.exists() else []

    def test_a_branch_with_a_pr_gives_its_number_and_one_without_gives_nothing_and_exit_0(self):
        self.out()
        self.set_rest(HEAD_PATH, [{'number': 7}])
        done = self.run_shell('pr_of_head o/r topic')
        self.assertEqual((done.returncode, done.stdout.strip()), (0, '7'))
        self.set_rest(HEAD_PATH, [])
        done = self.run_shell('pr_of_head o/r topic')
        self.assertEqual((done.returncode, done.stdout.strip()), (0, ''), 'a readable empty list is "no PR"')

    def test_a_refused_read_with_quota_left_is_unknown_not_none(self):
        self.out(core=4000)
        done = self.run_shell('pr_of_head o/r topic')
        self.assertEqual((done.returncode, done.stdout), (1, ''), 'before: exit 0 and no output, read as "no open PR"')
        self.assertFalse([c for c in self.calls() if c.startswith('GRAPHQL')], 'a failure that is not "REST out" never touches GraphQL')

    def test_rest_out_reads_the_lookup_over_graphql(self):
        self.out(core=0, graphql={'data': {'repository': {'pullRequests': {'pageInfo': {'hasNextPage': False}, 'nodes': [{'number': 9, 'headRepositoryOwner': {'login': 'fork'}}, {'number': 7, 'headRepositoryOwner': {'login': 'o'}}]}}}})
        done = self.run_shell('pr_of_head o/r topic')
        self.assertEqual((done.returncode, done.stdout.strip()), (0, '7'), 'only the PR whose head is in the repo owner counts')
        self.assertIn('GRAPHQL ofhead fallback: REST out', self.calls())
        self.out(core=0, graphql={'data': {'repository': {'pullRequests': {'pageInfo': {'hasNextPage': False}, 'nodes': []}}}})
        done = self.run_shell('pr_of_head o/r topic')
        self.assertEqual((done.returncode, done.stdout.strip()), (0, ''), 'GraphQL says there is none')

    def test_rest_out_with_more_graphql_pages_and_no_match_of_ours_is_unknown_not_none(self):
        """13 Nov 2026, Gitar on #4093: the branch name matches any fork's branch, so a full page without our PR may hide it."""
        forks = [{'number': n, 'headRepositoryOwner': {'login': 'fork'}} for n in range(1, 4)]
        self.out(core=0, graphql={'data': {'repository': {'pullRequests': {'pageInfo': {'hasNextPage': True}, 'nodes': forks}}}})
        done = self.run_shell('pr_of_head o/r topic')
        self.assertEqual((done.returncode, done.stdout), (1, ''))
        self.out(core=0, graphql={'data': {'repository': {'pullRequests': {'pageInfo': {'hasNextPage': True}, 'nodes': forks + [{'number': 7, 'headRepositoryOwner': {'login': 'o'}}]}}}})
        done = self.run_shell('pr_of_head o/r topic')
        self.assertEqual((done.returncode, done.stdout.strip()), (0, '7'), 'a match of ours is a match, whatever follows')

    def test_rest_out_and_graphql_unreadable_is_unknown(self):
        self.out(core=0)
        done = self.run_shell('pr_of_head o/r topic')
        self.assertEqual((done.returncode, done.stdout), (1, ''))

    def test_ship_stops_before_pushing_or_creating_a_pr_when_the_lookup_is_unknown(self):
        self.out(core=0)
        done = self.run_shell('n=""; branch=topic; ship_pr_lookup o/r topic; echo "went on: n=[$n]"')
        self.assertEqual(done.returncode, 1, done.stdout)
        self.assertNotIn('went on', done.stdout)
        self.assertRegex(done.stderr, r'ship: FAILED GitHub could not say whether topic already has an open pull request \(REST quota 0 until \d\d:\d\d')
        self.assertIn('nothing was pushed and no pull request was created', done.stderr)
        self.assertFalse([c for c in self.calls() if 'POST' in c], 'no create call')

    def test_ship_goes_on_with_no_pr_when_the_lookup_says_none_and_reuses_the_one_it_finds(self):
        self.out()
        self.set_rest(HEAD_PATH, [])
        done = self.run_shell('n=x; ship_pr_lookup o/r topic; echo "n=[$n]"')
        self.assertEqual((done.returncode, done.stdout.strip()), (0, 'n=[]'))
        self.set_rest(HEAD_PATH, [{'number': 7}])
        done = self.run_shell('n=""; ship_pr_lookup o/r topic; echo "n=[$n]"')
        self.assertEqual((done.returncode, done.stdout.strip()), (0, 'n=[7]'))


if __name__ == '__main__':
    unittest.main()
