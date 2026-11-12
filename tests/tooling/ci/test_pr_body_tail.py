"""Guard: release (tools/pr-body-format.py, tools/pr-body.sh) — a PR description carries exactly ONE commit-message block, ONE Facts block and ONE "Generated with Claude Code" footer, however many times it is re-shipped; without this a PR body
grows a new tail on every ship (owner, 12 Nov 2026: "we get duplicated footnote on PR bodies"; #3893 had 5 commit blocks, 20+ other PRs a second footer).
Why (12 Nov 2026): tools/pr-body.sh always appends the footer, the Facts and the commits; a session's summary file that already held an old tail (a body fetched back with `gh pr view`, or its own footer line, which the attribution
reminder asks for) kept it, so the new tail stood beside the old ones. The format step now drops every generated tail from the summary first; the summary's own words stay."""
import importlib.util
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
FOOT = '🤖 Generated with [Claude Code](https://claude.com/claude-code)'
SUMMARY = '''🟢 The thing works for you

**Why:** the owner asked.
**Unblocks:** the next step.

| Area | Impact | How |
|---|---|---|
| 👤 Real users | 🟡 Medium | they get it |
| 📝 Form filling | — None | nothing |
| 📊 Admin data accuracy | — None | nothing |
| 🔁 Offline replays | — None | nothing |
| 🧪 Tests & harness | ⚪ Low | a guard |
| ⚡ Development speed | — None | nothing |
| 💰 Cost | — None | nothing |

- ✅ one change

| | Before | After |
|---|---|---|
| the thing | broken | works |
'''
OLD_TAIL = '''
---

### 🧾 Facts

| | |
|---|---|
| 🎯 Pool row | none x |

---

<details><summary>📄 The commit messages ({n})</summary>

#### old subject

old body

</details>

''' + FOOT + '\n'


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / file)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


class PrBodyTail(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.format = load('pr_body_format_tail', 'tools/pr-body-format.py')

    def test_a_clean_summary_is_unchanged(self):
        self.assertEqual(self.format.lay_out(SUMMARY, 'o/r'), self.format.lay_out(SUMMARY + '\n', 'o/r'))
        self.assertNotIn('Generated with', self.format.lay_out(SUMMARY, 'o/r'))

    def test_old_tails_inside_the_summary_are_dropped_the_summary_stays(self):
        clean = self.format.lay_out(SUMMARY, 'o/r')
        for tails in (1, 2, 4):
            old = SUMMARY + ''.join(OLD_TAIL.format(n=n) for n in range(2, 2 + tails))
            laid = self.format.lay_out(old, 'o/r')
            self.assertEqual(laid, clean, f'{tails} old tails')
            self.assertNotIn('The commit message', laid)
            self.assertNotIn('Facts', laid)

    def test_the_authors_own_footer_line_is_dropped_wherever_it_is(self):
        clean = self.format.lay_out(SUMMARY, 'o/r')
        self.assertEqual(self.format.lay_out(SUMMARY + '\n' + FOOT + '\n', 'o/r'), clean)
        self.assertEqual(self.format.lay_out(SUMMARY.replace('- ✅ one change', '- ✅ one change\n\n🤖 Generated with Claude Code'), 'o/r'), clean)

    def test_the_summary_may_talk_about_the_footer_in_a_sentence(self):
        text = SUMMARY.replace('- ✅ one change', '- ✅ the "🤖 Generated with Claude Code" line is added once, by the tool')
        self.assertIn('is added once, by the tool', self.format.lay_out(text, 'o/r'))


class PrBodyScript(unittest.TestCase):
    """The real tools/pr-body.sh in a scratch repo: re-shipping with the body it printed last time still gives one of each."""

    def test_a_reshipped_body_has_one_commit_block_one_facts_block_one_footer(self):
        with tempfile.TemporaryDirectory() as repo:
            git = lambda *a: subprocess.run(['git', '-c', 'user.name=t', '-c', 'user.email=t@t', *a], cwd=repo, check=True, capture_output=True, text=True).stdout
            git('init', '-q', '-b', 'main')
            Path(repo, 'a').write_text('a')
            git('add', '-A'); git('commit', '-qm', 'base')
            Path(repo, 'a').write_text('b')
            git('commit', '-qam', 'Change a\n\nPool-row: none no form path')
            summary = Path(repo, 'summary.md')
            summary.write_text(SUMMARY)
            run = lambda: subprocess.run(['bash', str(ROOT / 'tools/pr-body.sh'), 'HEAD~1', f'--body={summary}'], cwd=repo, check=True, capture_output=True, text=True).stdout
            first = run()
            for body in (first, run()):
                self.assertEqual(body.count('The commit message'), 1, body)
                self.assertEqual(body.count('Generated with'), 1, body)
                self.assertEqual(body.count('### 🧾 Facts'), 1, body)
            for _ in range(3):   # a session that feeds the printed body back as its next --body file
                summary.write_text(first + '\n' + FOOT + '\n')
                again = run()
                self.assertEqual(again.count('The commit message'), 1, again)
                self.assertEqual(again.count('Generated with'), 1, again)
                self.assertEqual(again.count('### 🧾 Facts'), 1, again)
            self.assertEqual(again, first, 'the same commits, the same body')


if __name__ == '__main__':
    unittest.main()
