"""Guard: release — READY (tools/ship-watch.sh) and the PR list read the "Claude: …" label, so it must be a pure function of the newest Claude review and the head: "approved" only for the head that review looked at,
never from GitHub's review state (an Approve posted by Actions is a COMMENT), never stuck on a state only a running job knows (13 Nov 2026, cr 2a; the Gitar label needed 10 fixes for that). Runs tools/claude-label.mjs under node with a fake gh."""
import json
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
TOOL = (ROOT / 'tools' / 'claude-label.mjs').as_posix()
REVIEW = (ROOT / 'tools' / 'claude-review.mjs').as_posix()
A, B = 'a' * 40, 'b' * 40


def node(expr, tool=TOOL):
    code = f"import('{tool}').then(m => console.log(JSON.stringify({expr})))"
    return json.loads(subprocess.run(['node', '-e', code], capture_output=True, text=True, check=True, timeout=30).stdout.strip().splitlines()[-1])


@unittest.skipUnless(shutil.which('node'), 'needs node')
class ClaudeLabelTest(unittest.TestCase):
    def test_every_state_from_the_newest_review_and_the_head(self):
        cases = [([], A, 'Claude: not reviewed'),
                 ([{'sha': A, 'verdict': 'APPROVE'}], A, 'Claude: approved'),
                 ([{'sha': A, 'verdict': 'REQUEST_CHANGES'}], A, 'Claude: changes requested'),
                 ([{'sha': A, 'verdict': 'APPROVE'}], B, 'Claude: approved · not re-reviewed'),
                 ([{'sha': A, 'verdict': 'REQUEST_CHANGES'}], B, 'Claude: changes requested · not re-reviewed'),
                 ([{'sha': A, 'verdict': 'REQUEST_CHANGES'}, {'sha': B, 'verdict': 'APPROVE'}], B, 'Claude: approved')]   # the newest review decides
        for reviews, head, label in cases:
            self.assertEqual(node(f"m.wantedLabel({json.dumps(reviews)}, '{head}')"), label, (reviews, head))

    def test_a_headline_that_is_not_an_approve_reads_as_changes_requested(self):
        """ourReviews fails closed: a truncated or edited body is never an approval."""
        for text, verdict in (('**Claude review: ✅ Approve** on x', 'APPROVE'), ('**Claude review: ⛔ Request changes** on x', 'REQUEST_CHANGES'), ('looks fine to me', 'REQUEST_CHANGES')):
            review = {'author': {'login': 'github-actions'}, 'submittedAt': '2026-11-13T10:00:00Z', 'body': f'{text}\n<!-- claude-review sha={A} -->'}
            got = node(f'm.ourReviews([{json.dumps(review)}])', REVIEW)
            self.assertEqual([r['verdict'] for r in got], [verdict], text)

    def test_the_label_is_set_alone_removing_the_other_claude_labels_and_created_once(self):
        calls = node("(() => { const seen = []; m.setLabel('o/r', 7, 'Claude: approved', ['Claude: not reviewed', 'bug'], (...a) => { seen.push(a.slice(0, 3).join(' ')); if (a[0] === 'pr' && a.includes('--add-label') && seen.filter(s => s.startsWith('pr edit')).length === 1) throw new Error(\"'Claude: approved' not found\"); }); return seen; })()")
        self.assertEqual(calls, ['pr edit 7', 'label create Claude: approved', 'pr edit 7', 'pr edit 7'])   # add (refused: no such label), create, add again, remove "not reviewed"; "bug" untouched

    def test_a_writer_that_read_before_the_review_landed_corrects_itself(self):
        """Gitar's finding on #4119: the review job and pr-labels both write the label; a stale read must converge on the newest review."""
        def pr(reviews, labels):
            nodes = [{'author': {'login': 'github-actions'}, 'submittedAt': '2026-11-13T10:00:00Z', 'body': f'**Claude review: ✅ Approve** on x\n<!-- claude-review sha={A} -->'} for _ in reviews]
            return {'data': {'repository': {'pullRequest': {'number': 7, 'state': 'OPEN', 'isDraft': False, 'title': 't', 'headRefOid': A, 'baseRefName': 'main', 'headRepository': {'nameWithOwner': 'o/r'},
                    'commits': {'nodes': []}, 'reviews': {'nodes': nodes}, 'comments': {'nodes': []}, 'labels': {'nodes': [{'name': n} for n in labels]}}}}}
        reads = [pr([], []), pr([1], ['Claude: not reviewed']), pr([1], ['Claude: approved'])]   # the review lands between the first and second read
        script = ("(() => { const reads = %s; const seen = []; const run = (...a) => { if (a[1] === 'graphql') return JSON.stringify(reads.shift()); seen.push(a.slice(0, 5).join(' ')); return ''; };"
                  " return [m.sync('o/r', 7, run), seen]; })()") % json.dumps(reads)
        wanted, seen = node(script)
        self.assertEqual(wanted, 'Claude: approved')
        self.assertEqual(seen, ['pr edit 7 --add-label Claude: not reviewed', 'pr edit 7 --add-label Claude: approved', 'pr edit 7 --remove-label Claude: not reviewed'])


if __name__ == '__main__':
    unittest.main()
