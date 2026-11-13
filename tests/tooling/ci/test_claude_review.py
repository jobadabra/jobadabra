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
        self.assertEqual(go(PR.replace("status:'SUCCESS'", "status:'PENDING'"))['go'], False, 'a head whose checks are not green is not reviewed')
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


if __name__ == '__main__':
    unittest.main()
