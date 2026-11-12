"""Guard: the gray "Gitar: reviewing" label means Gitar has a check on the head; no check = orange "Gitar: not started" (11 Nov 2026, owner: "the gh labels are not representing
the Gitar review state"; #3779, #3781, #3780 read "reviewing" for 7+ min while Gitar had not started), and one label per push: an ask reads "reviewing" at once (12 Nov 2026, owner:
"One label per push"). Runs tools/gitar-label.mjs's pure functions under node."""
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

    def test_a_verdict_older_than_the_head_is_dropped(self):
        """12 Nov 2026, owner chose "One label per push": #3870 and #3859 showed "not started" beside the old push's verdict; the PR holds one label, about the newest push."""
        self.assertEqual(node("m.wantedLabels({verdict: null, gitarOnHead: true, headTime: '2026-11-11T00:00:00Z'})"), ['Gitar: reviewing'])
        self.assertEqual(node("m.wantedLabels({verdict: null, gitarOnHead: false, headTime: '2026-11-11T00:00:00Z'})"), ['Gitar: not started'])

    def test_an_ask_after_the_push_reads_reviewing_until_the_verdict(self):
        """#3870, 12 Nov 2026: "Gitar review" at 03:32, Gitar's check started 03:32:38, comment 03:33:27; the label said "not started" the whole time."""
        head, ask, now = "headTime: '2026-11-12T03:30:00Z'", "asked: '2026-11-12T03:32:00Z'", "now: Date.parse('2026-11-12T03:33:00Z')"
        self.assertEqual(node(f"m.wantedLabels({{verdict: null, gitarOnHead: false, {head}, {ask}, {now}}})"), ['Gitar: reviewing'])
        stale = "verdict: null, verdictTime: '2026-11-12T03:00:00Z'"
        self.assertEqual(node(f"m.wantedLabels({{{stale}, gitarOnHead: false, {head}, {ask}, {now}}})"), ['Gitar: reviewing'])
        done = "verdict: 'Gitar: changes requested', verdictTime: '2026-11-12T03:33:27Z'"
        self.assertEqual(node(f"m.wantedLabels({{{done}, gitarOnHead: true, {head}, {ask}, now: Date.parse('2026-11-12T03:34:00Z')}})"), ['Gitar: changes requested'])

    def test_a_re_ask_on_the_same_head_reads_reviewing_until_gitar_answers_it(self):
        base = "verdict: 'Gitar: approved with suggestions', verdictTime: '2026-11-12T03:10:00Z', headTime: '2026-11-12T03:00:00Z', gitarOnHead: true, asked: '2026-11-12T03:20:00Z'"
        self.assertEqual(node(f"m.wantedLabels({{{base}, now: Date.parse('2026-11-12T03:21:00Z')}})"), ['Gitar: reviewing'])
        self.assertEqual(node(f"m.wantedLabels({{{base}, now: Date.parse('2026-11-12T03:40:00Z')}})"), ['Gitar: approved with suggestions'], 'an ask unanswered for 15 min no longer holds the label')

    def test_an_ask_older_than_the_push_or_lost_is_not_reviewing(self):
        old = "verdict: null, gitarOnHead: false, headTime: '2026-11-12T03:30:00Z', asked: '2026-11-12T03:00:00Z', now: Date.parse('2026-11-12T03:31:00Z')"
        self.assertEqual(node(f"m.wantedLabels({{{old}}})"), ['Gitar: not started'])
        lost = "verdict: null, gitarOnHead: false, headTime: '2026-11-12T03:30:00Z', asked: '2026-11-12T03:31:00Z', now: Date.parse('2026-11-12T03:47:00Z')"
        self.assertEqual(node(f"m.wantedLabels({{{lost}}})"), ['Gitar: not started'])

    def test_the_ask_is_read_from_the_comments_and_a_refusal_cancels_it(self):
        ask = {'login': 'GarryOne', 'body': 'Gitar review', 'createdAt': '2026-11-12T03:32:00Z'}
        other = {'login': 'GarryOne', 'body': 'Thanks, fixed in abc', 'createdAt': '2026-11-12T03:40:00Z'}
        own = {'login': 'gitar-bot', 'body': 'Gitar review summary', 'createdAt': '2026-11-12T03:41:00Z'}
        self.assertEqual(node(f"m.askedAt({json.dumps([ask, other, own])})"), '2026-11-12T03:32:00Z')
        refusal = {'login': 'gitar-bot', 'body': "You've sent several Gitar comments in a short window. Please wait about 40 minutes and comment again.", 'createdAt': '2026-11-12T03:32:05Z'}
        self.assertIsNone(node(f"m.askedAt({json.dumps([ask, refusal])})"))
        self.assertIsNone(node("m.askedAt([])"))

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

    def test_a_null_node_in_any_list_does_not_crash_the_read(self):
        # 11 Nov 2026, #3817 run 43026926353: GitHub answered a null check suite and the label run crashed ("reading 'createdAt'"); the owner saw the PR red.
        data = {'repository': {'pullRequest': {'state': 'OPEN', 'comments': {'pageInfo': {'hasPreviousPage': False}, 'nodes': [None]}, 'labels': {'nodes': [None, {'name': 'Working on PR comments'}]},
                'timelineItems': {'nodes': [None, {'createdAt': '2026-11-11T00:02:00Z', 'label': {'name': 'Working on PR comments'}}]},
                'commits': {'nodes': [{'commit': {'committedDate': '2026-11-11T00:00:00Z', 'checkSuites': {'nodes': [None, {'createdAt': '2026-11-11T00:00:01Z', 'app': {'slug': 'gitar'}, 'checkRuns': {'totalCount': 1}}]}}}]}}}}
        read = node(f"m.fromGraphql({json.dumps(data)})")
        self.assertEqual(read['headTime'], '2026-11-11T00:00:01Z')
        self.assertTrue(read['gitarOnHead'])
        self.assertEqual(read['workingSince'], '2026-11-11T00:02:00Z')

    def test_a_stale_approval_keeps_the_working_mark_set_after_the_push(self):
        """Gitar #3790: an approval older than the head can never be newer than a "working" mark set after that head, so the mark stays (and clears once the approval is current)."""
        stale = "workingSince: '2026-11-11T02:00:00Z', headTime: '2026-11-11T01:00:00Z', verdictTime: '2026-11-11T00:30:00Z'"
        self.assertEqual(node("m.wantedLabels({verdict: null, gitarOnHead: true, " + stale + "})"), ['Gitar: reviewing', 'Working on PR comments'])
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
