"""Guard: money — the Claude PR reviewer spends the owner's Claude plan, so one head is reviewed once, a day has a cap, and only the owner, a member or a dispatcher can ask for a review by hand; without
this a green-status loop or a stranger's "@claude review" drains the plan (owner, 13 Nov 2026: "Trial Claude on jobadabra", then "replace Gitar with Claude Code review"). Also pins what the posted review says
(APPROVE only with no high/medium finding, the full head sha in its marker, at most 5 findings) because READY and the label read it. Runs tools/claude-review.mjs under node; no network."""
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
TOOL = (ROOT / 'tools' / 'claude-review.mjs').as_posix()
HEAD = 'a' * 40
PR = "{state:'OPEN', isDraft:false, title:'A change', head:'%s', headRepo:'o/r', status:'SUCCESS'}" % HEAD


def node(expr):
    code = f"import('{TOOL}').then(m => console.log(JSON.stringify({expr})))"
    return json.loads(subprocess.run(['node', '-e', code], capture_output=True, text=True, check=True, timeout=30).stdout.strip().splitlines()[-1])


def go(pr=PR, **kw):
    """decide() for the PR object `pr` with the keyword arguments `kw` given as a JS object body; -> its {go, reason}."""
    extra = ', '.join(f'{k}: {v}' for k, v in kw.items())
    return node(f"m.decide({{pr: {pr}, repo: 'o/r'{', ' + extra if extra else ''}}})")


@unittest.skipUnless(shutil.which('node'), 'needs node')
class ClaudeReviewTest(unittest.TestCase):
    def test_a_green_head_is_reviewed_once_and_the_cap_stops_the_plan_draining(self):
        self.assertEqual(go()['go'], True)
        self.assertEqual(go(reviews=f"[{{sha: '{HEAD}'}}]")['reason'], 'this head is already reviewed')
        self.assertEqual(go(today='60', cap='60')['reason'], 'cap')
        self.assertEqual(go(manual='true', today='60', cap='60')['go'], False, 'the owner\'s ask is under the cap too')
        self.assertEqual(go(PR.replace("status:'SUCCESS'", "status:'PENDING'"))['go'], True, 'a head is reviewed in parallel with CI: its checks do not matter (owner, 14 Nov 2026: "On every push, in parallel with CI")')
        self.assertEqual(go(wantedSha="'" + 'b' * 40 + "'")['reason'], 'the head moved since this was started')

    def test_a_fork_and_a_closed_pr_never_meet_the_token_even_when_asked(self):
        for manual in ('false', 'true'):
            self.assertEqual(go(PR.replace("headRepo:'o/r'", "headRepo:'x/r'"), manual=manual)['go'], False, 'a fork')
            self.assertEqual(go(PR.replace("'OPEN'", "'MERGED'"), manual=manual)['go'], False, 'a closed PR')

    def test_an_ask_by_hand_runs_on_a_draft_or_held_pr_a_green_head_does_not(self):
        held = PR.replace('isDraft:false', 'isDraft:true').replace("'A change'", "'DONT MERGE a change'")
        self.assertEqual(go(held)['go'], False)
        self.assertEqual(go(held, manual='true')['go'], True)

    def test_only_the_owner_a_member_or_a_dispatcher_can_ask(self):
        for asked_by in ('', 'NONE', 'CONTRIBUTOR', 'READ'):
            env = {**os.environ, 'MODE': 'manual', 'ASKED_BY': asked_by, 'PR': '7', 'GITHUB_REPOSITORY': 'o/r'}
            said = subprocess.run(['node', TOOL, 'gate'], capture_output=True, text=True, env=env, timeout=30).stdout
            self.assertIn('claude-review: go=false', said, asked_by)

    def test_the_review_says_approve_only_without_a_high_or_medium_finding(self):
        low, medium = {'severity': 'low', 'path': 'a.py', 'line': 3, 'title': 't', 'body': 'b'}, {'severity': 'medium', 'path': 'a.py', 'line': 4, 'title': 'u', 'body': 'b'}
        self.assertEqual(node(f"m.reviewPayload({{summary: 's', findings: [{json.dumps(low)}]}}, '{HEAD}').event"), 'APPROVE')
        self.assertEqual(node(f"m.reviewPayload({{summary: 's', findings: [{json.dumps(low)}, {json.dumps(medium)}]}}, '{HEAD}').event"), 'REQUEST_CHANGES')
        body = node(f"m.reviewPayload({{summary: 's', findings: []}}, '{HEAD}').body")
        self.assertIn(f'<!-- claude-review sha={HEAD} ', body)
        self.assertIn('✅ Approve', body)
        many = [dict(low, line=n) for n in range(1, 9)]
        self.assertEqual(node(f"m.reviewPayload({{summary: 's', findings: {json.dumps(many)}}}, '{HEAD}').comments.length"), 5)

    def test_an_approve_the_repository_refuses_is_posted_as_a_comment_then_without_inline_lines(self):
        calls = node("(() => { const seen = []; m.submitReview({event: 'APPROVE', comments: [{path: 'a', line: 1}]}, p => { seen.push([p.event, p.comments.length]); if (seen.length < 3) throw new Error('refused'); }); return seen; })()")
        self.assertEqual(calls, [['APPROVE', 1], ['COMMENT', 1], ['COMMENT', 0]])

    def test_only_our_reviews_of_today_count_toward_the_cap(self):
        mark = f'<!-- claude-review sha={HEAD} -->'
        nodes = [{'author': {'login': 'github-actions'}, 'submittedAt': '2026-11-13T10:00:00Z', 'body': mark},
                 {'author': {'login': 'github-actions'}, 'submittedAt': '2026-11-12T10:00:00Z', 'body': mark},
                 {'author': {'login': 'someone'}, 'submittedAt': '2026-11-13T11:00:00Z', 'body': mark},
                 {'author': {'login': 'github-actions'}, 'submittedAt': '2026-11-13T12:00:00Z', 'body': 'no marker'}]
        now = 'Date.parse("2026-11-13T15:00:00Z")'
        self.assertEqual(node(f"m.reviewsToday([{{reviews: {{nodes: {json.dumps(nodes)}}}}}], {now})"), 1)

    def test_the_action_accepts_the_bot_that_pr_verdict_dispatches_as(self):
        """Run 43525125910 (13 Nov 2026): the green-head review is started by pr-verdict.yml, actor github-actions; without allowed_bots the action failed "Workflow initiated by non-human actor"."""
        text = (ROOT / '.github' / 'workflows' / 'claude-review-shared.yml').read_text(encoding='utf-8')
        self.assertRegex(text, r'(?m)^\s+allowed_bots: github-actions\s*$')
        self.assertNotIn("allowed_bots: '*'", text)

    def test_a_plan_limit_is_a_skipped_review_not_a_red_job_and_any_other_failure_stays_red(self):
        """13 Nov 2026 (owner's Telegram: 90% of CI's Claude week used): when the plan is out the review job ends green with one clear line; a real error still fails the job. Only the run's LAST result message
        decides (Gitar's finding on #4119): a transcript that merely mentions a quota or a 429 must not turn a real failure into a skip."""
        with tempfile.TemporaryDirectory() as tmp:
            def failed(messages):
                file = Path(tmp) / 'execution.json'
                file.write_text(json.dumps(messages), encoding='utf-8')
                env = {**os.environ, 'PR': '7', 'EXECUTION_FILE': str(file), 'GITHUB_STEP_SUMMARY': str(Path(tmp) / 'summary.md'), 'GITHUB_REPOSITORY': ''}
                return subprocess.run(['node', TOOL, 'failed'], capture_output=True, text=True, env=env, timeout=30)
            soft = failed([{'type': 'result', 'is_error': True, 'result': 'Claude AI usage limit reached|1700000000'}])
            self.assertEqual(soft.returncode, 0)
            self.assertIn('plan limit is reached', soft.stdout)
            talks_about_quotas = {'type': 'user', 'message': {'content': 'the diff adds a quota check and retries on 429 too many requests, rate limit reached'}}
            self.assertNotEqual(failed([talks_about_quotas, {'type': 'result', 'is_error': True, 'result': 'Unsupported event type: push'}]).returncode, 0)
            self.assertNotEqual(failed([talks_about_quotas]).returncode, 0, 'no error result at all is not a plan limit')

    def test_a_skipped_review_leaves_one_note_on_the_pr_per_head(self):
        """Gitar's finding on #4119: nothing on the PR said why READY never came. The note carries a marker, so a second skip of the same head posts nothing."""
        pr = lambda comments: {'data': {'repository': {'pullRequest': {'number': 7, 'state': 'OPEN', 'isDraft': False, 'title': 't', 'headRefOid': HEAD, 'baseRefName': 'main', 'headRepository': {'nameWithOwner': 'o/r'},
              'commits': {'nodes': []}, 'reviews': {'nodes': []}, 'comments': {'nodes': [{'body': c} for c in comments]}, 'labels': {'nodes': []}}}}}
        with tempfile.TemporaryDirectory() as tmp:
            file = Path(tmp) / 'execution.json'
            file.write_text(json.dumps([{'type': 'result', 'is_error': True, 'result': 'usage limit reached'}]), encoding='utf-8')
            env = json.dumps({'PR': '7', 'HEAD': HEAD, 'GITHUB_REPOSITORY': 'o/r', 'EXECUTION_FILE': str(file), 'GITHUB_STEP_SUMMARY': str(Path(tmp) / 's.md')})
            def notes(existing):
                answer = json.dumps(json.dumps(pr(existing)))
                return node(f"(() => {{ const seen = []; const run = (...a) => {{ seen.push(a[0] + ' ' + a[1]); return a[1] === 'graphql' ? {answer} : ''; }}; m.failed({env}, run); return seen.filter(x => x.startsWith('pr comment')).length; }})()")
            self.assertEqual(notes([]), 1)
            self.assertEqual(notes([f'Claude review skipped\n<!-- claude-review-skipped sha={HEAD} -->']), 0)

    def test_a_push_is_reviewed_on_the_diff_since_the_last_reviewed_head_only_when_it_is_an_ancestor(self):
        self.assertEqual(node("m.diffBase('abc', 'ahead')"), 'abc')
        self.assertEqual(node("m.diffBase('abc', 'diverged')"), '')
        self.assertEqual(node("m.diffBase('', 'ahead')"), '')

    def test_the_prompt_carries_the_repositorys_own_rules_read_at_run_time(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / 'b-rule.md').write_text('RULE B text', encoding='utf-8')
            (Path(tmp) / 'a-rule.md').write_text('RULE A text', encoding='utf-8')
            (Path(tmp) / 'notes.txt').write_text('not a rule', encoding='utf-8')
            rules = node(f"m.rulesFrom({json.dumps(tmp)})")
            self.assertTrue(rules.index('RULE A text') < rules.index('RULE B text'))
            self.assertNotIn('not a rule', rules)
            self.assertEqual(node("m.rulesFrom('/no/such/folder')"), '')
        template = (ROOT / 'tools' / 'claude-review-prompt.md').read_text(encoding='utf-8')
        self.assertIn('{{rules}}', template)
        prompt = node(f"m.promptFor({{number: '7', head: '{HEAD}', base: 'main', from: '', prior: [], rules: 'RULE A text'}}, {json.dumps(template)})")
        self.assertIn('RULE A text', prompt)
        self.assertNotIn('{{', prompt)

    def test_every_read_of_the_reviews_asks_for_the_newest_ones(self):
        """Gitar's findings on #4131: READY and the label pick the newest Claude review, so a read of the reviews must be a window of the NEWEST (`last`), never the oldest (`first`)."""
        review_query = (ROOT / 'tools' / 'claude-review.mjs').read_text(encoding='utf-8')
        self.assertIn('reviews(last: 100) { nodes { author { login } submittedAt body } }', review_query)
        graphql_view = (ROOT / 'tools' / 'pr-rest-lib.sh').read_text(encoding='utf-8')
        self.assertIn('reviews(last:100)@include(if:$full)', graphql_view)
        self.assertNotIn('reviews(first:', graphql_view)

    def test_the_comment_ask_is_at_claude_review_and_nothing_looser(self):
        """Gitar's finding on the cr 3b PR: a loose "contains review" spent the plan on "@claude please don't review"; the owner's "@claude  review" (two spaces, #4144) must start one. Runs the plan job's step script."""
        text = (ROOT / '.github' / 'workflows' / 'claude-review.yml').read_text(encoding='utf-8')
        block = text.split('        run: |\n', 1)[1].split('\n\n  review:', 1)[0]   # the plan job's one step; no YAML parser on every machine
        step = '\n'.join(line[10:] for line in block.split('\n'))
        def asks(body):
            with tempfile.TemporaryDirectory() as tmp:
                out = Path(tmp) / 'out'
                out.write_text('')
                env = {**os.environ, 'INPUT_PRS': '', 'COMMENT_PR': '7', 'COMMENT_BODY': body, 'GITHUB_OUTPUT': str(out)}
                subprocess.run(['bash', '-c', step], env=env, capture_output=True, text=True, timeout=30, check=True)
                return 'go=true' in out.read_text()
        for yes in ('@claude review', '@claude  review', '@claude, review', '@claude: review', '@claude\treview', '@Claude Review please', '@claude review\nmore text'):
            self.assertTrue(asks(yes), yes)
        for no in ("@claude please don't review", '@claudette review', '@claude-bot review', '@claude reviewing', 'thanks, @claude review', '@claude', 'review @claude', '@claude;review', '@claude,review'):
            self.assertFalse(asks(no), no)

    def test_every_push_starts_the_review_by_one_trigger_and_the_green_hand_over_is_gone(self):
        """Owner, 14 Nov 2026 ("On every push, in parallel with CI"): a pull_request_target push of a non-draft PR dispatches this workflow with the head's sha, once; pr-verdict no longer dispatches it after green (one trigger)."""
        caller = (ROOT / '.github' / 'workflows' / 'claude-review.yml').read_text(encoding='utf-8')
        self.assertIn('types: [opened, synchronize, reopened, ready_for_review]', caller)
        self.assertIn("if: github.event_name == 'pull_request_target' && !github.event.pull_request.draft", caller)
        self.assertIn('gh workflow run claude-review.yml -R "$GITHUB_REPOSITORY" -f prs="$PR" -f sha="$HEAD"', caller)
        verdict = (ROOT / '.github' / 'workflows' / 'pr-verdict.yml').read_text(encoding='utf-8')
        self.assertNotIn('claude-review.yml', verdict, 'one trigger: the after-green dispatch is gone')
        self.assertNotIn('hand_over_green', (ROOT / 'tools' / 'pr-verdict.py').read_text(encoding='utf-8'))


if __name__ == '__main__':
    unittest.main()
