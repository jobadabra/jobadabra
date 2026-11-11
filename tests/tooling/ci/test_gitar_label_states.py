"""Guard: the gray "Gitar: reviewing" label means Gitar has a check on the head; no check = orange "Gitar: not started" (11 Nov 2026, owner: "the gh labels are not representing
the Gitar review state"; #3779, #3781, #3780 read "reviewing" for 7+ min while Gitar had not started). Runs tools/gitar-label.mjs's pure functions under node."""
import json
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def node(expr):
    code = f"import('{(ROOT / 'tools' / 'gitar-label.mjs').as_posix()}').then(m => console.log(JSON.stringify({expr})))"
    return json.loads(subprocess.run(['node', '-e', code], capture_output=True, text=True, check=True, timeout=30).stdout)


@unittest.skipUnless(shutil.which('node'), 'needs node')
class GitarLabelStatesTest(unittest.TestCase):
    def test_no_verdict_and_no_gitar_check_is_not_started(self):
        self.assertEqual(node("m.wantedLabels({verdict: null, gitarOnHead: false, headTime: '2026-11-11T00:00:00Z'})"), ['Gitar: not started'])

    def test_no_verdict_with_a_gitar_check_is_reviewing(self):
        self.assertEqual(node("m.wantedLabels({verdict: null, gitarOnHead: true, headTime: '2026-11-11T00:00:00Z'})"), ['Gitar: reviewing'])

    def test_a_stale_verdict_still_shows_beside_the_pending_label(self):
        base = "headTime: '2026-11-11T00:00:00Z', latest: 'Gitar: approved with suggestions'"
        self.assertEqual(node("m.wantedLabels({verdict: null, gitarOnHead: true, " + base + "})"), ['Gitar: approved with suggestions', 'Gitar: reviewing'])
        self.assertEqual(node("m.wantedLabels({verdict: null, gitarOnHead: false, " + base + "})"), ['Gitar: approved with suggestions', 'Gitar: not started'])

    def test_a_current_verdict_wins_over_the_check_state(self):
        self.assertEqual(node("m.wantedLabels({verdict: 'Gitar: approved', gitarOnHead: false, headTime: '2026-11-11T00:00:00Z'})"), ['Gitar: approved'])

    def test_an_empty_gitar_suite_is_not_a_gitar_run(self):
        """GitHub queues an empty suite for every installed app on a push (#3723, 11 Nov 2026: a queued Gitar suite beside claude and sentry, no Gitar run): only a run counts."""
        suite = {'createdAt': '2026-11-11T01:19:27Z', 'app': {'slug': 'gitar-bot'}, 'checkRuns': {'totalCount': 0}}
        data = {'repository': {'pullRequest': {'state': 'OPEN', 'comments': {'pageInfo': {'hasPreviousPage': False}, 'nodes': []}, 'labels': {'nodes': []}, 'timelineItems': {'nodes': []},
                'commits': {'nodes': [{'commit': {'committedDate': '2026-11-11T01:18:49Z', 'checkSuites': {'nodes': [suite]}}}]}}}}
        self.assertFalse(node(f"m.fromGraphql({json.dumps(data)}).gitarOnHead"))
        suite['checkRuns']['totalCount'] = 1
        self.assertTrue(node(f"m.fromGraphql({json.dumps(data)}).gitarOnHead"))

    def test_the_graphql_read_finds_gitar_among_the_heads_check_suites(self):
        data = {'repository': {'pullRequest': {'state': 'OPEN', 'comments': {'pageInfo': {'hasPreviousPage': False}, 'nodes': []}, 'labels': {'nodes': []}, 'timelineItems': {'nodes': []},
                'commits': {'nodes': [{'commit': {'committedDate': '2026-11-11T00:00:00Z', 'checkSuites': {'nodes': [{'createdAt': '2026-11-11T00:00:01Z', 'app': {'slug': 'github-actions'}, 'checkRuns': {'totalCount': 3}}]}}}]}}}}
        self.assertFalse(node(f"m.fromGraphql({json.dumps(data)}).gitarOnHead"))
        data['repository']['pullRequest']['commits']['nodes'][0]['commit']['checkSuites']['nodes'].append({'createdAt': '2026-11-11T00:01:00Z', 'app': {'slug': 'gitar'}, 'checkRuns': {'totalCount': 1}})
        self.assertTrue(node(f"m.fromGraphql({json.dumps(data)}).gitarOnHead"))

    def test_a_null_check_suite_or_label_event_does_not_crash_the_read(self):
        # 11 Nov 2026, #3817 run 43026926353: GitHub answered a null check suite and the label run crashed ("reading 'createdAt'"); the owner saw the PR red.
        data = {'repository': {'pullRequest': {'state': 'OPEN', 'comments': {'pageInfo': {'hasPreviousPage': False}, 'nodes': []}, 'labels': {'nodes': [{'name': 'Working on PR comments'}]},
                'timelineItems': {'nodes': [None, {'createdAt': '2026-11-11T00:02:00Z', 'label': {'name': 'Working on PR comments'}}]},
                'commits': {'nodes': [{'commit': {'committedDate': '2026-11-11T00:00:00Z', 'checkSuites': {'nodes': [None, {'createdAt': '2026-11-11T00:00:01Z', 'app': {'slug': 'gitar'}, 'checkRuns': {'totalCount': 1}}]}}}]}}}}
        read = node(f"m.fromGraphql({json.dumps(data)})")
        self.assertEqual(read['headTime'], '2026-11-11T00:00:01Z')
        self.assertTrue(read['gitarOnHead'])
        self.assertEqual(read['workingSince'], '2026-11-11T00:02:00Z')

    def test_a_stale_approval_keeps_the_working_mark_set_after_the_push(self):
        """Gitar #3790: an approval older than the head can never be newer than a "working" mark set after that head, so the mark stays (and clears once the approval is current)."""
        stale = "workingSince: '2026-11-11T02:00:00Z', headTime: '2026-11-11T01:00:00Z', verdictTime: '2026-11-11T00:30:00Z'"
        self.assertEqual(node("m.wantedLabels({verdict: null, latest: 'Gitar: approved', gitarOnHead: true, " + stale + "})"),
                         ['Gitar: approved', 'Gitar: reviewing', 'Working on PR comments'])
        current = "workingSince: '2026-11-11T02:00:00Z', headTime: '2026-11-11T01:00:00Z', verdictTime: '2026-11-11T02:30:00Z'"
        self.assertEqual(node("m.wantedLabels({verdict: 'Gitar: approved', " + current + "})"), ['Gitar: approved'])

    def test_the_rest_read_is_by_suite_app_slug_only(self):
        """Gitar #3790: a suite of another app is not Gitar (even one named "gitar-label"), an empty Gitar suite is not a run, a Gitar suite with a run is."""
        def read(suites):
            fake = json.dumps({'check_suites': suites})
            return node(f"m.gitarOnHead('o/r', 'abc', () => {json.dumps(fake)})")
        self.assertFalse(read([{'app': {'slug': 'github-actions', 'name': 'gitar-label'}, 'latest_check_runs_count': 4}]))
        self.assertFalse(read([{'app': {'slug': 'gitar-bot'}, 'latest_check_runs_count': 0}]))
        self.assertTrue(read([{'app': {'slug': 'github-actions'}, 'latest_check_runs_count': 90}, {'app': {'slug': 'gitar-bot'}, 'latest_check_runs_count': 1}]))


if __name__ == '__main__':
    unittest.main()
