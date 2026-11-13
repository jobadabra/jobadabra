"""Guard: the Gitar label reads ONE signal, Gitar's check run on the head commit (13 Nov 2026, owner, asked via AskUserQuestion: "Simplify to one signal (Recommended)"; the symptom of
benchmarks #38 came back on #4031: "reviewing" beside ✅ Approved). Run in progress = "Gitar: reviewing"; run completed = the verdict Gitar wrote after the run started; no run = Gitar's last verdict
"· not re-reviewed", or "not started" when it never gave one. Runs tools/gitar-label.mjs under node with a fake gh."""
import json
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def node(expr):
    code = f"import('{(ROOT / 'tools' / 'gitar-label.mjs').as_posix()}').then(m => console.log(JSON.stringify({expr})))"
    return json.loads(subprocess.run(['node', '-e', code], capture_output=True, text=True, check=True, timeout=30).stdout.strip().splitlines()[-1])   # the answer is the last line: syncOnce logs its own


VERDICT = '<details><summary><b>Code Review</b> <kbd>%s</kbd></summary>x</details>'
APPROVED, SUGGESTIONS, CHANGES = '✅ Approved', '👍 Approved with suggestions', '⚠️ Changes requested'
PLAIN = {'changes': 'Gitar: changes requested', 'suggestions': 'Gitar: approved with suggestions', 'approved': 'Gitar: approved'}
BODY = {'changes': CHANGES, 'suggestions': SUGGESTIONS, 'approved': APPROVED}
OLD = ' · not re-reviewed'


def run(status='COMPLETED', started='2026-11-13T20:40:09Z'):
    return {'status': status, 'startedAt': started}


def answering(answers):
    """A gh that answers each call by its second word (`api <path>`) from `answers`, and fails on any other call."""
    return "((answers) => (...args) => { const a = answers[args[1]]; if (a === undefined) throw new Error('unexpected ' + args.join(' ')); return JSON.stringify(a); })(%s)" % json.dumps(answers)


def pr_data(runs, body=None, updated='2026-11-13T20:41:19Z', parents=('P1',), labels=(), committed='2026-11-13T20:25:18Z', sha='M'):
    """GraphQL's answer for one open PR whose head holds Gitar's `runs` (checkRuns nodes) and Gitar's dashboard comment `body` (written 20:01:59, last edited `updated`)."""
    comments = [{'author': {'login': 'gitar-bot'}, 'body': body, 'createdAt': '2026-11-13T20:01:59Z', 'updatedAt': updated}] if body else []
    return {'data': {'repository': {'pullRequest': {'state': 'OPEN', 'headRefOid': sha, 'baseRefName': 'main',
            'comments': {'pageInfo': {'hasPreviousPage': False}, 'nodes': comments}, 'labels': {'nodes': [{'name': n} for n in labels]}, 'timelineItems': {'nodes': []},
            'commits': {'nodes': [{'commit': {'committedDate': committed, 'parents': {'nodes': [{'oid': p} for p in parents]},
                'checkSuites': {'nodes': [{'createdAt': '2026-11-13T20:25:58Z', 'app': {'slug': 'gitar-bot'}, 'checkRuns': {'totalCount': len(runs), 'nodes': runs}}]}}}]}}}}}


def wanted(runs, verdict=None, extra=None, **kw):
    """The labels the PR should hold, through wantedFor with a fake gh; `verdict` is the text of Gitar's Code Review line, `extra` more answers by path."""
    gh = answering({'graphql': pr_data(runs, VERDICT % verdict if verdict else None, **kw), **(extra or {})})
    return node(f"m.wantedFor('o/r', 7, {gh}).wanted")


@unittest.skipUnless(shutil.which('node'), 'needs node')
class OneSignalTest(unittest.TestCase):
    def test_4031_a_merge_head_with_a_completed_run_reads_the_verdict_written_after_it_started(self):
        """The recorded read of #4031, 13 Nov 2026: head b0b94450 is a merge of main (2 parents); Gitar's run on it started 20:40:09 and completed 20:41:21; the verdict "Approved with suggestions" was
        written 20:41:19. The label stayed "reviewing" for 7+ minutes: main's merge-walk looked for a run on the commit BEFORE the merge, found none and dropped the verdict, while the head's run said "ran". Here the fake gh answers only the one GraphQL read and throws on any other call, so this also proves the label no longer walks back through the merge."""
        self.assertEqual(wanted([run()], SUGGESTIONS, parents=('P1', 'P2')), ['Gitar: approved with suggestions'])   # `answering` fails on any call but graphql: a REST merge-walk read would throw here

    def test_every_state_of_the_label_from_the_heads_run_alone(self):
        for kind in PLAIN:
            plain, old = PLAIN[kind], PLAIN[kind] + OLD
            with self.subTest(kind=kind):
                self.assertEqual(wanted([run('IN_PROGRESS')], BODY[kind]), ['Gitar: reviewing'], 'a run in progress, whatever the older verdict says')
                self.assertEqual(wanted([run()], BODY[kind]), [plain], 'completed, verdict written after the run started')
                self.assertEqual(wanted([], BODY[kind]), [old], 'no run on the head: the last verdict, marked old')
                self.assertEqual(wanted([run()], BODY[kind], updated='2026-11-13T20:30:00Z'), [old], "a verdict written before the run started is not that run's")
                self.assertEqual(wanted([run(started='2026-11-13T20:10:00Z'), run('IN_PROGRESS', '2026-11-13T20:50:00Z')], BODY[kind]), ['Gitar: reviewing'], 'a re-ask on the same head: its run is the signal')
                self.assertEqual(wanted([run(started='2026-11-13T20:10:00Z'), run(started='2026-11-13T20:40:09Z')], BODY[kind]), [plain], 'the newest run decides')
        stale_queued = [run(status='QUEUED', started='2026-11-13T20:10:00Z'), run(started='2026-11-13T20:40:09Z')]   # Gitar's finding on #4084: an older unfinished run must not pin "reviewing"
        self.assertEqual(wanted(stale_queued, SUGGESTIONS), [PLAIN['suggestions']], 'only the newest run says running')
        self.assertEqual(wanted([run(started='2026-11-13T20:10:00Z'), run(status='IN_PROGRESS', started='2026-11-13T20:40:09Z')], SUGGESTIONS), ['Gitar: reviewing'], 'a newer run in progress is reviewing')
        self.assertEqual(wanted([]), ['Gitar: not started'], 'never reviewed')
        self.assertEqual(wanted([run()]), ['Gitar: not started'], 'a run that left no verdict, and no earlier verdict')

    def test_an_edit_for_a_thread_reply_counts_only_with_a_run_on_the_head(self):
        """#4020, 13 Nov 2026: the fix push had no Gitar run; thread replies made Gitar EDIT its old comment, so its edit time was newer than the head. With no run it reads "not re-reviewed"."""
        late = {'updated': '2026-11-13T19:02:00Z', 'committed': '2026-11-13T19:00:00Z'}
        self.assertEqual(wanted([], CHANGES, **late), [PLAIN['changes'] + OLD])
        self.assertEqual(wanted([], APPROVED, **late), [PLAIN['approved'] + OLD])
        self.assertEqual(wanted([run(started='2026-11-13T19:00:10Z')], APPROVED, **late), ['Gitar: approved'], 'positive control: with a run on the head the same edit is its verdict')
        # Gitar on #4048: an edit long AFTER the run completed (a finding closed by a thread reply on the same head) is still Gitar's verdict on a head it ran on: shown plain, a documented choice, not a gap.
        self.assertEqual(wanted([run(started='2026-11-13T20:40:09Z')], APPROVED, updated='2026-11-13T22:00:00Z'), ['Gitar: approved'])
        self.assertEqual(wanted([run(started='2026-11-13T20:40:09Z')], CHANGES, updated='2026-11-13T22:00:00Z'), ['Gitar: changes requested'])

    def test_a_null_node_in_any_list_does_not_crash_the_read(self):
        # 11 Nov 2026, #3817 run 43026926353: GitHub answered a null check suite and the label run crashed ("reading 'createdAt'"); the owner saw the PR red.
        data = {'repository': {'pullRequest': {'state': 'OPEN', 'headRefOid': 'M', 'comments': {'pageInfo': {'hasPreviousPage': False}, 'nodes': [None]}, 'labels': {'nodes': [None, {'name': 'Working on PR comments'}]},
                'timelineItems': {'nodes': [None, {'createdAt': '2026-11-11T00:02:00Z', 'label': {'name': 'Working on PR comments'}}]},
                'commits': {'nodes': [{'commit': {'committedDate': '2026-11-11T00:00:00Z', 'checkSuites': {'nodes': [None, {'createdAt': '2026-11-11T00:00:01Z', 'app': {'slug': 'gitar'},
                                                                                                                            'checkRuns': {'nodes': [None, run('IN_PROGRESS', '2026-11-11T00:00:05Z')]}}]}}}]}}}}
        read = node(f"m.fromGraphql({json.dumps(data)})")
        self.assertEqual(read['headTime'], '2026-11-11T00:00:01Z')
        self.assertEqual(read['run'], {'running': True, 'startedAt': '2026-11-11T00:00:05Z'})
        self.assertEqual(read['workingSince'], '2026-11-11T00:02:00Z')

    def test_only_a_gitar_suite_with_a_run_counts(self):
        """Gitar #3790: a suite of another app is not Gitar (even a check named "gitar-label"); an empty Gitar suite, queued on every push (#3723, 11 Nov 2026), is no run; Gitar's run is found among the other suites."""
        suite = lambda slug, runs: {'createdAt': '2026-11-11T00:00:01Z', 'app': {'slug': slug}, 'checkRuns': {'nodes': runs}}

        def read(suites):
            data = {'repository': {'pullRequest': {'state': 'OPEN', 'headRefOid': 'M', 'comments': {'pageInfo': {'hasPreviousPage': False}, 'nodes': []}, 'labels': {'nodes': []}, 'timelineItems': {'nodes': []},
                    'commits': {'nodes': [{'commit': {'committedDate': '2026-11-11T00:00:00Z', 'checkSuites': {'nodes': suites}}}]}}}}
            return node(f"m.fromGraphql({json.dumps(data)}).run")
        self.assertIsNone(read([suite('github-actions', [run()])]))
        self.assertIsNone(read([suite('gitar-bot', [])]))
        self.assertEqual(read([suite('github-actions', [run()]), suite('gitar-bot', [run('COMPLETED', '2026-11-11T00:01:00Z')])]), {'running': False, 'startedAt': '2026-11-11T00:01:00Z'})

    def test_the_rest_read_finds_the_same_run(self):
        """The REST path (a thread too long for GraphQL): the head's suites, Gitar's by app slug, then that suite's runs; the same shape as the GraphQL read."""
        suites = {'check_suites': [{'id': 1, 'app': {'slug': 'github-actions'}, 'latest_check_runs_count': 90}, {'id': 2, 'app': {'slug': 'gitar-bot'}, 'latest_check_runs_count': 1}]}
        fake = {'repos/o/r/commits/abc/check-suites?per_page=100': suites, 'repos/o/r/check-suites/2/check-runs?per_page=100': {'check_runs': [{'status': 'in_progress', 'started_at': '2026-11-11T00:01:00Z'}]}}
        self.assertEqual(node(f"m.gitarRunOnHead('o/r', 'abc', {answering(fake)})"), {'running': True, 'startedAt': '2026-11-11T00:01:00Z'})
        fake['repos/o/r/commits/abc/check-suites?per_page=100'] = {'check_suites': [{'id': 2, 'app': {'slug': 'gitar-bot'}, 'latest_check_runs_count': 0}]}
        self.assertIsNone(node(f"m.gitarRunOnHead('o/r', 'abc', {answering(fake)})"))

    def test_the_working_mark_stays_until_gitar_approves_the_head(self):
        """Gitar #3790: a mark set after the head's push stays while the verdict is old or running; it clears once the head's own approval is newer than the mark."""
        stale = "workingSince: '2026-11-11T02:00:00Z', headTime: '2026-11-11T01:00:00Z', verdictTime: '2026-11-11T00:30:00Z'"
        self.assertEqual(node("m.wantedLabels({kind: 'approved', run: null, " + stale + "})"), ['Gitar: approved · not re-reviewed', 'Working on PR comments'])
        self.assertEqual(node("m.wantedLabels({kind: null, run: {running: true, startedAt: '2026-11-11T01:00:05Z'}, " + stale + "})"), ['Gitar: reviewing', 'Working on PR comments'])
        current = "workingSince: '2026-11-11T02:00:00Z', headTime: '2026-11-11T01:00:00Z', verdictTime: '2026-11-11T02:30:00Z', run: {running: false, startedAt: '2026-11-11T02:10:00Z'}"
        self.assertEqual(node("m.wantedLabels({kind: 'approved', " + current + "})"), ['Gitar: approved'])

    def test_each_not_re_reviewed_label_is_its_verdicts_name_with_a_lighter_shade_of_its_colour(self):
        by = {name: (color, description) for name, color, description in node("m.ALL.map(l => [l.name, l.color, l.description])")}
        luminance = lambda hex_: sum(int(hex_[i:i + 2], 16) for i in (0, 2, 4))
        for plain in PLAIN.values():
            old = by[plain + OLD]
            self.assertGreater(luminance(old[0]), luminance(by[plain][0]), 'lighter than the verdict it keeps')
            self.assertIn('earlier push', old[1])

    def test_a_label_set_swaps_the_plain_verdict_for_its_not_re_reviewed_label(self):
        """setLabels removes the label the PR holds and adds the wanted one: approved -> approved · not re-reviewed after a push."""
        edits = node("(() => { const edits = []; m.setLabels('o/r', 7, ['Gitar: approved \\u00b7 not re-reviewed'], ['Gitar: approved'], (...a) => { edits.push(a.slice(0, 5).join(' ')); return ''; }); return edits; })()")
        self.assertEqual(edits, ['pr edit 7 --remove-label Gitar: approved', 'pr edit 7 --add-label Gitar: approved · not re-reviewed'])


# 13 Nov 2026, owner: "the PR got approved by gitar, but PR lable never changed" (jobadabra-benchmarks #38; jobadabra #4000 the same day). Gitar approved by only EDITING its comment, which starts no
# event; the one event that came with it was its check ending 1 s later, and no workflow listened. Plays #38: asked at 17:36, comment first written 17:38, edited to "Approved" 17:41:27.
@unittest.skipUnless(shutil.which('node'), 'needs node')
class CheckEndedRelabelsTest(unittest.TestCase):
    def after_check(self, body, labels, status='COMPLETED'):
        """Gitar's check ran on H1 (`status`): -> {prs, edits, labels} after `syncHead`, with the PR holding `labels` and Gitar's comment reading `body`; label edits update what the next read sees."""
        base = answering({'graphql': pr_data([run(status, '2026-11-13T17:31:10Z')], body, updated='2026-11-13T17:41:27Z', labels=labels, sha='H1', committed='2026-11-13T17:30:00Z')})
        return node("""(() => { const state = {labels: %s}, edits = [], read = %s;
          const gh = (...a) => {
            if (a[1] === 'graphql') { const d = JSON.parse(read(...a)); d.data.repository.pullRequest.labels.nodes = state.labels.map(name => ({name})); return JSON.stringify(d); }
            if (a[1] === 'repos/o/r/commits/H1/pulls?per_page=100') return JSON.stringify([{number: 38, state: 'open', head: {sha: 'H1'}}, {number: 7, state: 'open', head: {sha: 'OTHER'}}, {number: 6, state: 'closed', head: {sha: 'H1'}}]);
            if (a[0] === 'pr' && a[1] === 'edit') { edits.push(a[3] + ' ' + a[4]); state.labels = a[3] === '--add-label' ? [...state.labels, a[4]] : state.labels.filter(l => l !== a[4]); return ''; }
            throw new Error('unexpected ' + a.join(' '));
          };
          const prs = m.syncHead('o/r', 'H1', gh); return {prs, edits, labels: state.labels}; })()""" % (json.dumps(labels), base))

    def test_a_verdict_that_only_edited_the_comment_relabels_on_the_check_ending(self):
        got = self.after_check(VERDICT % APPROVED, ['Gitar: reviewing'])
        self.assertEqual(got['prs'], [38], 'only the OPEN PR whose head is the checked commit')
        self.assertEqual(got['labels'], ['Gitar: approved'], got)

    def test_the_check_starting_before_any_verdict_reads_reviewing_and_writes_nothing_more(self):
        got = self.after_check('Gitar is reviewing this PR', ['Gitar: reviewing'], status='IN_PROGRESS')
        self.assertEqual((got['labels'], got['edits']), (['Gitar: reviewing'], []), 'no write when the label already matches')

    def test_every_repo_calls_the_one_workflow_and_listens_to_gitars_check(self):
        """Guard: release — 2 escapes in 1 day (#4000, benchmarks #38) of a copy that lacked the trigger: the callers are the same file, and the shared workflow starts on Gitar's check only."""
        own = (ROOT / '.github' / 'workflows' / 'pr-labels.yml').read_text()
        self.assertEqual(own, (ROOT / 'templates' / 'org-repo' / 'pr-labels.yml').read_text(), "jobadabra's caller is the org template")
        self.assertIn('uses: jobadabra/jobadabra/.github/workflows/pr-labels-shared.yml@main', own)
        self.assertRegex(own, r'check_run:\n    types: \[created, completed\]')
        shared = (ROOT / '.github' / 'workflows' / 'pr-labels-shared.yml').read_text()
        self.assertIn("github.event_name == 'check_run' && contains(github.event.check_run.app.slug, 'gitar')", shared)
        self.assertIn('node tools/gitar-label.mjs head "$SHA"', shared)


if __name__ == '__main__':
    unittest.main()
