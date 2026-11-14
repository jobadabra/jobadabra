"""Guard: release — the PR watchers go blind (no READY, no RED, no MERGED) the hour REST core is out of quota, unless pr_view and pr_checks keep reading over GraphQL (10 Nov 2026: 30 min blind at
00:31Z while GraphQL had 4,860 left), and the fallback must not call a PR READY where the REST path would not (owner, 10 Nov 2026: "REST first, GraphQL fallback").
Sources the real tools/pr-rest-lib.sh against the fake gh of tests/fake_gh_rest.py (files, no network): the same PR and checks are read once over REST and once with REST refused and core at 0;
the two answers must be the same JSON. Any other failure (core still has quota) must not touch GraphQL."""
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
SHA, MAIN = 'abc1234', 'main567'


def rest_name(path):
    return re.sub(r'[^A-Za-z0-9]', '_', path)


def job(run, job_id):
    return f'https://github.com/o/r/actions/runs/{run}/job/{job_id}'


@unittest.skipUnless(shutil.which('jq') and shutil.which('bash'), 'needs jq and bash')
class PrGraphqlFallbackTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        (self.tmp / 'bin').mkdir()
        (self.tmp / 'rest').mkdir()
        gh = self.tmp / 'bin' / 'gh'
        gh.write_text(f'#!/bin/sh\nexec "{sys.executable}" "{ROOT / "tests" / "fake_gh_rest.py"}" "$@"\n')
        gh.chmod(gh.stat().st_mode | stat.S_IEXEC)
        self.gql_log = self.tmp / 'gh-graphql.log'

    def rest(self, path, body):
        (self.tmp / 'rest' / rest_name(path)).write_text(json.dumps(body))

    def graphql(self, kind, data):
        (self.tmp / f'graphql_{kind}.json').write_text(json.dumps({'data': data}))

    def read(self, call, rest_out):
        """Runs `call` (a pr_view / pr_checks line) with REST fine, or refused with core at 0. -> (exit code, stdout)."""
        for name in ('refuse_rest', 'rate_core'):
            (self.tmp / name).unlink(missing_ok=True)
        (self.tmp / 'calls').write_text('')
        if rest_out is not None:
            (self.tmp / 'refuse_rest').write_text('')
            (self.tmp / 'rate_core').write_text(str(rest_out))
        env = {**os.environ, 'GH_REST_LOG': 'off', 'PATH': f'{self.tmp / "bin"}{os.pathsep}{os.environ["PATH"]}', 'FAKE_GH_DIR': str(self.tmp), 'PR_REST_CACHE': str(self.tmp / ('cache-out' if rest_out is not None else 'cache')),
               'GH_GRAPHQL_LOG': str(self.gql_log), 'CODEX_THREAD_ID': '', 'CODEX_SESSION_ID': '', 'CMUX_SURFACE_ID': ''}
        done = subprocess.run(['bash', '-c', f'. "{ROOT / "tools" / "pr-rest-lib.sh"}" && {call}'], env=env, capture_output=True, text=True, timeout=60)
        return done.returncode, done.stdout

    def graphql_calls(self):
        return [line for line in (self.tmp / 'calls').read_text().splitlines() if line.startswith('GRAPHQL ')]

    # --- pr_view ---
    def seed_pr(self):
        pr = {'number': 7, 'html_url': 'https://github.com/o/r/pull/7', 'title': 'Do it', 'head': {'sha': SHA, 'ref': 'feature'}, 'draft': False, 'state': 'closed', 'merged_at': '2026-11-10T00:00:00Z',
              'merge_commit_sha': 'm1', 'mergeable': None, 'mergeable_state': 'clean', 'labels': [{'name': 'Gitar: approved'}]}
        self.rest('repos/o/r/pulls/7', pr)
        self.rest('repos/o/r/issues/7/comments?per_page=100', [{'node_id': 'IC_1', 'user': {'login': 'gitar-bot[bot]', 'type': 'Bot'}, 'body': 'ok', 'html_url': 'https://github.com/o/r/pull/7#c1', 'created_at': '2026-11-10T00:01:00Z'}])
        self.rest('repos/o/r/pulls/7/reviews?per_page=100', [{'node_id': 'PRR_1', 'user': None, 'body': 'hm', 'state': 'COMMENTED', 'submitted_at': '2026-11-10T00:02:00Z'},
                                                                       {'node_id': 'PRR_2', 'user': {'login': 'GarryOne', 'type': 'User'}, 'body': 'ok', 'state': 'APPROVED', 'submitted_at': '2026-11-10T00:03:00Z'}])
        self.rest('repos/o/r/pulls/7/commits?per_page=100', [{'commit': {'author': {'date': '2026-11-09T10:00:00Z'}, 'committer': {'date': '2026-11-09T10:01:00Z'}}}])
        (self.tmp / 'graphql_view.json').write_text(json.dumps({'data': {'repository': {'pullRequest': {
            'number': 7, 'url': 'https://github.com/o/r/pull/7', 'title': 'Do it', 'headRefOid': SHA, 'headRefName': 'feature', 'isDraft': False, 'state': 'MERGED', 'mergeable': 'UNKNOWN',
            'mergeStateStatus': 'CLEAN', 'mergeCommit': {'oid': 'm1'}, 'labels': {'nodes': [{'name': 'Gitar: approved'}]},
            'comments': {'nodes': [{'id': 'IC_1', 'author': {'__typename': 'Bot', 'login': 'gitar-bot'}, 'body': 'ok', 'url': 'https://github.com/o/r/pull/7#c1', 'createdAt': '2026-11-10T00:01:00Z'}]},
            'reviews': {'nodes': [{'id': 'PRR_1', 'author': None, 'body': 'hm', 'state': 'COMMENTED', 'submittedAt': '2026-11-10T00:02:00Z'},
                                  {'id': 'PRR_2', 'author': {'__typename': 'User', 'login': 'GarryOne'}, 'body': 'ok', 'state': 'APPROVED', 'submittedAt': '2026-11-10T00:03:00Z'}]},
            'commits': {'nodes': [{'commit': {'authoredDate': '2026-11-09T10:00:00Z', 'committedDate': '2026-11-09T10:01:00Z'}}]}}}}}))

    def test_view_over_graphql_is_the_same_json_as_over_rest(self):
        self.seed_pr()
        for flag in ('full', ''):
            code, via_rest = self.read(f'pr_view o/r 7 {flag}', None)
            self.assertEqual(code, 0)
            self.assertEqual(self.graphql_calls(), [], 'normal days use no GraphQL')
            code, via_graphql = self.read(f'pr_view o/r 7 {flag}', 0)
            self.assertEqual(code, 0, via_graphql)
            self.assertEqual(json.loads(via_graphql), json.loads(via_rest), flag or 'light')
            if flag:   # Gitar, 10 Nov 2026: GraphQL names a bot without "[bot]"; pr-comments-lib tells bots by that suffix
                self.assertEqual(json.loads(via_graphql)['comments'][0]['author']['login'], 'gitar-bot[bot]')
            self.assertEqual(self.graphql_calls(), ['GRAPHQL view fallback: REST out'])

    def test_a_failed_read_with_quota_left_fails_as_today_and_never_asks_graphql(self):
        self.seed_pr()
        for left in (4999, 'unreadable'):
            code, out = self.read('pr_view o/r 7 full', left)
            self.assertEqual((code, out), (1, ''), left)
            self.assertEqual(self.graphql_calls(), [], left)
        code, out = self.read('pr_view o/r 999', None)   # a PR REST does not know (404) is not "out of quota"
        self.assertEqual((code, out), (1, ''))
        self.assertEqual(self.graphql_calls(), [])

    def test_the_fallback_call_is_logged_by_the_gh_shim_with_its_reason(self):
        self.seed_pr()
        self.read('pr_view o/r 7', None)
        self.assertFalse(self.gql_log.exists(), 'a REST read is not a GraphQL line')
        self.read('pr_view o/r 7', 0)
        lines = self.gql_log.read_text().splitlines()
        self.assertEqual(len(lines), 1, lines)
        fields = lines[0].split('\t')
        self.assertEqual((fields[4], fields[5]), ('api graphql', 'fallback: REST out'), lines)

    # --- pr_checks ---
    def seed_checks(self):
        """A head with: a cancelled older run and a green newer run of "python", a manual workflow_dispatch run of "record" (failed), Gitar (not Actions), a running "e2e", and three statuses:
        the PR verdict written by main's workflow_run reporter (kept), a status of the dispatch run (dropped, #2618) and a third-party one (kept)."""
        runs = {100: ('pull_request', SHA), 101: ('pull_request', SHA), 102: ('workflow_dispatch', SHA), 103: ('pull_request', SHA), 200: ('workflow_run', MAIN)}
        for run, (event, head) in runs.items():
            self.rest(f'repos/o/r/actions/runs/{run}', {'id': run, 'head_sha': head, 'event': event})
        rows = [(10, 'python', 'completed', 'cancelled', job(100, 10)), (20, 'python', 'completed', 'success', job(101, 20)), (30, 'record', 'completed', 'failure', job(102, 30)),
                (40, 'Gitar', 'completed', 'success', 'https://github.com/o/r/runs/40'), (50, 'e2e', 'in_progress', None, job(103, 50))]
        self.rest(f'repos/o/r/commits/{SHA}/check-runs?per_page=100', {'check_runs': [{'id': i, 'name': n, 'status': s, 'conclusion': c, 'html_url': u, 'head_sha': SHA} for i, n, s, c, u in rows]})
        verdict, manual, third = 'https://github.com/o/r/actions/runs/200', 'https://github.com/o/r/actions/runs/102', 'https://ci.example/build/1'
        self.rest(f'repos/o/r/commits/{SHA}/status', {'sha': SHA, 'statuses': [{'context': 'All checks passed', 'state': 'success', 'target_url': verdict},
                                                                              {'context': 'manual', 'state': 'failure', 'target_url': manual}, {'context': 'ext', 'state': 'pending', 'target_url': third}]})
        suites = [{'workflowRun': {'databaseId': run, 'event': runs[run][0]}, 'checkRuns': {'nodes': [{'databaseId': i, 'name': n, 'status': s.upper(), 'conclusion': c and c.upper(), 'permalink': u}]}}
                  for (i, n, s, c, u), run in ((rows[0], 100), (rows[1], 101), (rows[2], 102), (rows[4], 103))]
        suites.append({'workflowRun': None, 'checkRuns': {'nodes': [{'databaseId': 40, 'name': 'Gitar', 'status': 'COMPLETED', 'conclusion': 'SUCCESS', 'permalink': rows[3][4]}]}})
        self.statuses = [{'context': 'All checks passed', 'state': 'SUCCESS', 'targetUrl': verdict}, {'context': 'manual', 'state': 'FAILURE', 'targetUrl': manual}, {'context': 'ext', 'state': 'PENDING', 'targetUrl': third}]
        self.suites = suites
        self.write_checks()
        self.graphql('runs', {'r200': {'event': 'workflow_run', 'checkSuite': {'commit': {'oid': MAIN}}}, 'r102': {'event': 'workflow_dispatch', 'checkSuite': {'commit': {'oid': SHA}}}})

    def write_checks(self):
        self.graphql('checks', {'repository': {'object': {'oid': SHA, 'checkSuites': {'nodes': self.suites}, 'status': {'contexts': self.statuses}}}})

    def by_name(self, out):
        return {row['name']: row for row in json.loads(out)}

    def test_checks_over_graphql_are_the_same_rows_as_over_rest(self):
        self.seed_checks()
        code, via_rest = self.read(f'pr_checks o/r {SHA}', None)
        self.assertEqual(code, 0, via_rest)
        code, via_graphql = self.read(f'pr_checks o/r {SHA}', 0)
        self.assertEqual(code, 0, via_graphql)
        key = lambda row: row['name']
        self.assertEqual(sorted(json.loads(via_graphql), key=key), sorted(json.loads(via_rest), key=key))
        rows = self.by_name(via_graphql)
        self.assertEqual(rows['python']['bucket'], 'pass', 'the newest run of a name wins over its cancelled twin')
        self.assertNotIn('record', rows, 'a workflow_dispatch suite is not a PR check (#2618)')
        self.assertNotIn('manual', rows, 'nor is the status of that run')
        self.assertEqual((rows['All checks passed']['bucket'], rows['Gitar']['bucket'], rows['e2e']['bucket'], rows['ext']['bucket']), ('pass', 'pass', 'pending', 'pending'))
        self.assertEqual(self.graphql_calls(), ['GRAPHQL checks fallback: REST out', 'GRAPHQL runs fallback: REST out'])

    def test_a_cancelled_twin_alone_stays_cancel_and_never_reads_green(self):
        self.seed_checks()
        self.suites = [s for s in self.suites if s['checkRuns']['nodes'][0]['databaseId'] != 20]
        self.write_checks()
        code, out = self.read(f'pr_checks o/r {SHA}', 0)
        self.assertEqual((code, self.by_name(out)['python']['bucket']), (0, 'cancel'))

    def test_a_status_whose_run_cannot_be_found_leaves_the_read_pending(self):
        self.seed_checks()
        self.graphql('runs', {'r200': None, 'r102': {'event': 'workflow_dispatch', 'checkSuite': {'commit': {'oid': SHA}}}})
        self.assertEqual(self.read(f'pr_checks o/r {SHA}', 0), (1, ''))

    def test_an_actions_check_without_its_workflow_run_leaves_the_read_pending(self):
        self.seed_checks()
        self.suites.append({'workflowRun': None, 'checkRuns': {'nodes': [{'databaseId': 60, 'name': 'orphan', 'status': 'COMPLETED', 'conclusion': 'SUCCESS', 'permalink': job(104, 60)}]}})
        self.write_checks()
        self.assertEqual(self.read(f'pr_checks o/r {SHA}', 0), (1, ''))

    def test_checks_with_quota_left_fail_as_today_and_never_ask_graphql(self):
        self.seed_checks()
        self.assertEqual(self.read(f'pr_checks o/r {SHA}', 4000), (1, ''))
        self.assertEqual(self.graphql_calls(), [])


if __name__ == '__main__':
    unittest.main()
