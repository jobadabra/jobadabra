"""Guard: the gray "Gitar: reviewing" label means Gitar has a check on the head; no check = Gitar's last verdict "· not re-reviewed", or orange "Gitar: not started" when it never gave one (11 Nov 2026, owner: "the gh labels are not representing
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
    return json.loads(subprocess.run(['node', '-e', code], capture_output=True, text=True, check=True, timeout=30).stdout.strip().splitlines()[-1])   # the answer is the last line: syncOnce logs its own


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

    def test_the_last_verdict_stays_visible_after_a_push_until_the_new_push_is_judged(self):
        """13 Nov 2026, owner ("Last verdict + not re-reviewed"), after web #635 (red) and #4026 (approved with suggestions read "not started"): one rule for every verdict, one loop."""
        head = "headTime: '2026-11-13T18:31:11Z', verdictTime: '2026-11-13T18:29:06Z'"
        for kind, name in [('changes', 'Gitar: changes requested'), ('suggestions', 'Gitar: approved with suggestions'), ('approved', 'Gitar: approved')]:
            with self.subTest(kind=kind):
                self.assertEqual(node(f"m.wantedLabels({{verdict: null, staleKind: '{kind}', gitarOnHead: false, {head}}})"), [f'{name} \u00b7 not re-reviewed'])
                self.assertEqual(node(f"m.wantedLabels({{verdict: null, staleKind: '{kind}', gitarOnHead: true, {head}}})"), ['Gitar: reviewing'], 'a review under way is what the label says')
                self.assertEqual(node(f"m.wantedLabels({{verdict: '{name}', staleKind: null, gitarOnHead: true, {head}}})"), [name], 'a reviewed head reads the plain verdict')
        self.assertEqual(node(f"m.wantedLabels({{verdict: null, staleKind: null, gitarOnHead: false, {head}}})"), ['Gitar: not started'], 'no verdict on any push')

    def test_each_not_re_reviewed_label_is_its_verdicts_name_with_a_lighter_shade_of_its_colour(self):
        by = {name: (color, description) for name, color, description in node("m.ALL.map(l => [l.name, l.color, l.description])")}
        luminance = lambda hex_: sum(int(hex_[i:i + 2], 16) for i in (0, 2, 4))
        for plain in ('Gitar: changes requested', 'Gitar: approved with suggestions', 'Gitar: approved'):
            old = by[plain + ' \u00b7 not re-reviewed']
            self.assertGreater(luminance(old[0]), luminance(by[plain][0]), 'lighter than the verdict it keeps')
            self.assertIn('earlier push', old[1])

    def test_a_label_set_swaps_the_plain_verdict_for_its_not_re_reviewed_label(self):
        """setLabels removes the label the PR holds and adds the wanted one: approved -> approved · not re-reviewed after a push."""
        edits = node("(() => { const edits = []; m.setLabels('o/r', 7, ['Gitar: approved \\u00b7 not re-reviewed'], ['Gitar: approved'], (...a) => { edits.push(a.slice(0, 5).join(' ')); return ''; }); return edits; })()")
        self.assertEqual(edits, ['pr edit 7 --remove-label Gitar: approved', 'pr edit 7 --add-label Gitar: approved \u00b7 not re-reviewed'])


# 13 Nov 2026, owner: "the PR got approved by gitar, but PR lable never changed" (jobadabra-benchmarks #38; jobadabra #4000 the same day). Gitar approved by only EDITING its comment, which starts no
# event; the one event that came with it was its check ending 1 s later, and no workflow listened. Plays #38: asked at 17:36, comment first written 17:38 ("changes requested"), edited to "Approved" 17:41:27.
VERDICT = '<details><summary><b>Code Review</b> <kbd>%s</kbd></summary>x</details>'
HEAD_SHA = 'H1'


def fake_gh(comment_body, labels):
    """A gh that answers #38's GraphQL read and the commit's PR list from memory, keeps the labels in `state` and records each label edit in `edits`."""
    return """(() => {
  const state = {labels: %s}, edits = [];
  const run = (...a) => {
    if (a[1] === 'graphql') return JSON.stringify({data: {repository: {pullRequest: {state: 'OPEN', headRefOid: 'H1', baseRefName: 'main',
      comments: {pageInfo: {hasPreviousPage: false}, nodes: [
        {author: {login: 'GarryOne'}, body: 'Gitar review', createdAt: '2026-11-13T17:36:00Z', updatedAt: '2026-11-13T17:36:00Z'},
        {author: {login: 'gitar-bot'}, body: %s, createdAt: '2026-11-13T17:38:00Z', updatedAt: '2026-11-13T17:41:27Z'}]},
      labels: {nodes: state.labels.map(name => ({name}))}, timelineItems: {nodes: []},
      commits: {nodes: [{commit: {committedDate: '2026-11-13T17:30:00Z', parents: {nodes: [{oid: 'P'}]}, checkSuites: {nodes: [{createdAt: '2026-11-13T17:31:00Z', app: {slug: 'gitar-bot'}, checkRuns: {totalCount: 1}}]}}}]}}}}});
    if (a[1] === 'repos/o/r/commits/H1/pulls?per_page=100') return JSON.stringify([{number: 38, state: 'open', head: {sha: 'H1'}}, {number: 7, state: 'open', head: {sha: 'OTHER'}}, {number: 6, state: 'closed', head: {sha: 'H1'}}]);
    if (a[0] === 'pr' && a[1] === 'edit') { const flag = a[3], name = a[4]; edits.push(flag + ' ' + name); state.labels = flag === '--add-label' ? [...state.labels, name] : state.labels.filter(l => l !== name); return ''; }
    throw new Error('unexpected ' + a.join(' '));
  };
  return {run, edits, state};
})()""" % (json.dumps(labels), json.dumps(comment_body))


@unittest.skipUnless(shutil.which('node'), 'needs node')
class CheckEndedRelabelsTest(unittest.TestCase):
    def after_check(self, body, labels):
        """Gitar's check ended on H1: -> {prs, edits, labels} after `syncHead`."""
        return node(f"(() => {{ const g = {fake_gh(body, labels)}; const prs = m.syncHead('o/r', '{HEAD_SHA}', g.run); return {{prs, edits: g.edits, labels: g.state.labels}}; }})()")

    def test_a_verdict_that_only_edited_the_comment_relabels_on_the_check_ending(self):
        got = self.after_check(VERDICT % '✅ Approved', ['Gitar: reviewing'])
        self.assertEqual(got['prs'], [38], 'only the OPEN PR whose head is the checked commit')
        self.assertEqual(got['labels'], ['Gitar: approved'], got)

    def test_the_check_ending_before_any_verdict_keeps_reviewing(self):
        got = self.after_check('Gitar is reviewing this PR', ['Gitar: reviewing'])
        self.assertEqual((got['labels'], got['edits']), (['Gitar: reviewing'], []), 'no write when the label already matches')

    def test_every_repo_calls_the_one_workflow_and_listens_to_gitars_check(self):
        """Guard: release — 2 escapes in 1 day (#4000, benchmarks #38) of a copy that lacked the trigger: the callers are the same file, and the shared workflow starts on Gitar's check only."""
        own = (ROOT / '.github' / 'workflows' / 'pr-labels.yml').read_text()
        self.assertEqual(own, (ROOT / 'templates' / 'org-repo' / 'pr-labels.yml').read_text(), 'jobadabra\'s caller is the org template')
        self.assertIn('uses: jobadabra/jobadabra/.github/workflows/pr-labels-shared.yml@main', own)
        self.assertRegex(own, r'check_run:\n    types: \[created, completed\]')
        shared = (ROOT / '.github' / 'workflows' / 'pr-labels-shared.yml').read_text()
        self.assertIn("github.event_name == 'check_run' && contains(github.event.check_run.app.slug, 'gitar')", shared)
        self.assertIn('node tools/gitar-label.mjs head "$SHA"', shared)


# 13 Nov 2026, coordinator (gl2): a verdict must not pass a head Gitar never reviewed. Real instance: #4020's fix push at 19:00 had no Gitar check run; the session's thread replies made Gitar EDIT its
# old dashboard comment (still "Changes requested", 0 closed), so updated_at was newer than the head, the label (and ship-watch's peek) read it as the head's verdict and nobody asked for a review.
def stale_edit_gh(verdict, ran_on_head):
    """A gh for one open PR: head committed 19:00:00, pushed 19:00:05; Gitar's comment written 18:40, EDITED 19:02 for a thread reply; Gitar's suite on the head has `ran_on_head` check runs."""
    return """(() => {
  const run = (...a) => { if (a[1] === 'graphql') return JSON.stringify({data: {repository: {pullRequest: {state: 'OPEN', headRefOid: 'H2', baseRefName: 'main',
    comments: {pageInfo: {hasPreviousPage: false}, nodes: [{author: {login: 'gitar-bot'}, body: %s, createdAt: '2026-11-13T18:40:00Z', updatedAt: '2026-11-13T19:02:00Z'}]},
    labels: {nodes: []}, timelineItems: {nodes: []},
    commits: {nodes: [{commit: {committedDate: '2026-11-13T19:00:00Z', parents: {nodes: [{oid: 'P'}]}, checkSuites: {nodes: [{createdAt: '2026-11-13T19:00:05Z', app: {slug: 'gitar-bot'}, checkRuns: {totalCount: %d}}]}}}]}}}}});
    throw new Error('unexpected ' + a.join(' ')); };
  return run;
})()""" % (json.dumps(VERDICT % verdict), ran_on_head)


@unittest.skipUnless(shutil.which('node'), 'needs node')
class StaleVerdictEditTest(unittest.TestCase):
    def labels(self, verdict, ran_on_head):
        return node(f"m.wantedFor('o/r', 7, {stale_edit_gh(verdict, ran_on_head)}).wanted")

    def test_an_approval_edited_for_a_thread_reply_does_not_pass_a_head_gitar_never_ran_on(self):
        self.assertEqual(self.labels('✅ Approved', 0), ['Gitar: approved \u00b7 not re-reviewed'])

    def test_a_red_verdict_edited_for_a_thread_reply_reads_not_re_reviewed(self):
        self.assertEqual(self.labels('⚠️ Changes requested', 0), ['Gitar: changes requested · not re-reviewed'])

    def test_the_same_edit_counts_when_gitars_check_ran_on_the_head(self):
        """Positive control: with a Gitar run on the head, an edit after the push is the verdict of that run (#38)."""
        self.assertEqual(self.labels('✅ Approved', 1), ['Gitar: approved'])


if __name__ == '__main__':
    unittest.main()


# 12 Nov 2026, owner, asked via AskUserQuestion: "Keep the verdict (Recommended)": #3886 was approved at 13:05:50 on 0eb842f (pushed 13:01), then took in main at 13:10:27
# with its own diff unchanged; the label read "Gitar: not started" and Gitar refused the ask for 30 min. A merge of main that leaves the own diff byte-identical keeps the verdict.
FAKE = """((answers) => (...args) => { const a = answers[args[1]]; if (a === undefined) throw new Error('unexpected ' + args[1]); return JSON.stringify(a); })(%s)"""
OWN = [{'filename': 'src/scout_boards.py', 'status': 'modified', 'patch': '@@ -1 +1 @@\n-a\n+b'}]


def answers(after_files=OWN, theirs_status='behind'):
    return {
        'repos/o/r/compare/main...P2': {'status': theirs_status},
        'repos/o/r/compare/P2...P1': {'files': OWN},
        'repos/o/r/compare/P2...M': {'files': after_files},
        'repos/o/r/commits/P1': {'parents': [{'sha': 'P0'}], 'commit': {'committer': {'date': '2026-11-12T13:01:21Z'}}},
        'repos/o/r/commits/P1/check-suites': {'check_suites': [{'created_at': '2026-11-12T13:01:30Z'}]},
    }


@unittest.skipUnless(shutil.which('node'), 'needs node')
class MainOnlyMergeKeepsTheVerdictTest(unittest.TestCase):
    def own(self, ans, parents=('P1', 'P2')):
        return node(f"m.ownHeadTime('o/r', {{sha: 'M', parents: {json.dumps(list(parents))}}}, 'main', {FAKE % json.dumps(ans)})")

    def test_the_3886_merge_of_main_keeps_the_approval(self):
        own = self.own(answers())
        self.assertEqual(own, {'sha': 'P1', 'time': '2026-11-12T13:01:30Z'})
        body = '<summary><b>Code Review</b> <kbd>✅ Approved</kbd>'
        verdict = node(f"m.wantedLabel({json.dumps(body)}, '2026-11-12T13:05:50Z', {json.dumps(own['time'])}, true)")   # Gitar ran on P1, the commit the approval belongs to
        self.assertEqual(node(f"m.wantedLabels({{verdict: {json.dumps(verdict)}, verdictTime: '2026-11-12T13:05:50Z', headTime: {json.dumps(own['time'])}, gitarOnHead: false}})"), ['Gitar: approved'])

    def wanted_after_merge(self, runs_on_own_commit):
        """#3886 end to end through wantedFor: approved 13:05:50 on P1 (pushed 13:01), main merged in at 13:10 (head M, no Gitar run); `runs_on_own_commit` Gitar runs on P1."""
        ans = answers()
        ans['graphql'] = {'data': {'repository': {'pullRequest': {'state': 'OPEN', 'headRefOid': 'M', 'baseRefName': 'main',
            'comments': {'pageInfo': {'hasPreviousPage': False}, 'nodes': [{'author': {'login': 'gitar-bot'}, 'body': VERDICT % '✅ Approved', 'createdAt': '2026-11-12T13:05:50Z', 'updatedAt': '2026-11-12T13:05:50Z'}]},
            'labels': {'nodes': []}, 'timelineItems': {'nodes': []},
            'commits': {'nodes': [{'commit': {'committedDate': '2026-11-12T13:10:27Z', 'parents': {'nodes': [{'oid': 'P1'}, {'oid': 'P2'}]},
                'checkSuites': {'nodes': [{'createdAt': '2026-11-12T13:10:30Z', 'app': {'slug': 'gitar-bot'}, 'checkRuns': {'totalCount': 0}}]}}}]}}}}}
        ans['repos/o/r/commits/P1/check-suites?per_page=100'] = {'check_suites': [{'app': {'slug': 'gitar-bot'}, 'latest_check_runs_count': runs_on_own_commit}]}
        return node(f"m.wantedFor('o/r', 7, {FAKE % json.dumps(ans)}).wanted")

    def test_a_merge_of_main_keeps_the_verdict_only_when_gitar_ran_on_the_commit_before_it(self):
        self.assertEqual(self.wanted_after_merge(1), ['Gitar: approved'])
        self.assertEqual(self.wanted_after_merge(0), ['Gitar: approved \u00b7 not re-reviewed'], 'an approval nobody ran Gitar for is not kept')

    def test_a_merge_that_changes_the_own_diff_needs_a_new_review(self):
        changed = [{**OWN[0], 'patch': '@@ -1 +1 @@\n-a\n+c'}]
        self.assertIsNone(self.own(answers(after_files=changed)))
        self.assertIsNone(self.own(answers(after_files=OWN + [{'filename': 'x.py', 'status': 'added', 'patch': '+x'}])))

    def test_a_merge_of_a_branch_that_is_not_the_base_needs_a_new_review(self):
        self.assertIsNone(self.own(answers(theirs_status='diverged')))

    def test_an_ordinary_push_is_its_own_head(self):
        self.assertIsNone(self.own({}, parents=('P1',)))

    def test_same_own_change_compares_files_status_and_patch(self):
        self.assertTrue(node(f"m.sameOwnChange({json.dumps(OWN)}, {json.dumps(OWN)})"))
        self.assertFalse(node(f"m.sameOwnChange({json.dumps(OWN)}, [])"))
        self.assertFalse(node(f"m.sameOwnChange({json.dumps(OWN)}, {json.dumps([{**OWN[0], 'status': 'renamed'}])})"))
        moved = [{**OWN[0], 'patch': '@@ -2,3 +2,3 @@ def f():\n x\n-a\n+b'}]   # #3886: main added a line above, the hunk moved, context differs; the own lines did not
        self.assertTrue(node(f"m.sameOwnChange({json.dumps(OWN)}, {json.dumps(moved)})"))
