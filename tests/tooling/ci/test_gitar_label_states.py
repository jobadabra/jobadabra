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

    def test_a_current_verdict_wins_over_the_check_state(self):
        self.assertEqual(node("m.wantedLabels({verdict: 'Gitar: approved', gitarOnHead: false, headTime: '2026-11-11T00:00:00Z'})"), ['Gitar: approved'])

    def test_the_graphql_read_finds_gitar_among_the_heads_check_suites(self):
        data = {'repository': {'pullRequest': {'state': 'OPEN', 'comments': {'pageInfo': {'hasPreviousPage': False}, 'nodes': []}, 'labels': {'nodes': []}, 'timelineItems': {'nodes': []},
                'commits': {'nodes': [{'commit': {'committedDate': '2026-11-11T00:00:00Z', 'checkSuites': {'nodes': [{'createdAt': '2026-11-11T00:00:01Z', 'app': {'slug': 'github-actions'}}]}}}]}}}}
        self.assertFalse(node(f"m.fromGraphql({json.dumps(data)}).gitarOnHead"))
        data['repository']['pullRequest']['commits']['nodes'][0]['commit']['checkSuites']['nodes'].append({'createdAt': '2026-11-11T00:01:00Z', 'app': {'slug': 'gitar'}})
        self.assertTrue(node(f"m.fromGraphql({json.dumps(data)}).gitarOnHead"))


if __name__ == '__main__':
    unittest.main()
