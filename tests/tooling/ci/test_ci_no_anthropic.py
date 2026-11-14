"""No CI workflow or composite action calls the Anthropic API: every CI AI call goes through the Codex broker (owner, 28 Oct 2026: "use/switch to Codex subscription for anything CI related";
31 Oct 2026: four "AI credit is 0 anthropic" alerts from one UI-verdict run, "Why Anthropic is reached? We should use fully the Codex").

A workflow may not use claude-code-action, pass an Anthropic key (ANTHROPIC_API_KEY, anthropic_api_key, any secret with ANTHROPIC in its name) or name `anthropic` at all, comments aside.
The ALLOWED table below is what is not moved, per file and per word. It may only shrink: a word that is no longer in its file fails the test until its entry is deleted,
and a new word anywhere fails it at once. One category is left: the user pipelines (the user's own key in the user's own repo, not a CI call of ours)."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
WORD = re.compile(r'[\w.@/-]*anthropic[\w.@/-]*', re.I)

# User pipelines (user's own key): daily.yml, mail.yml and scout.yml are `workflow_call` pipelines the product's users run in THEIR repo with THEIR key (Always on, hosted or personal); the owner's own copy is
# GarryOne/jobadabra-personal-always-on. They are not CI calls of ours: no key of ours reaches them. They stay on the user's key by design (coordinator, 31 Oct 2026).
USER_PIPELINES = {
    '.github/workflows/daily.yml': {'ANTHROPIC_API_KEY', 'secrets.ANTHROPIC_API_KEY'},
    '.github/workflows/mail.yml': {'ANTHROPIC_API_KEY', 'secrets.ANTHROPIC_API_KEY'},
    '.github/workflows/scout.yml': {'ANTHROPIC_API_KEY', 'secrets.ANTHROPIC_API_KEY'},
}

# The e2e lane's entries (the review action, record-sites, watch-live) went on 5 Nov 2026 (plan "CI and e2e take no AI API keys", 4/5; owner, 3 Nov 2026: "We should not use API Keys at all anymore. Everything should be around the ai-broker."): the table holds the user pipelines only.
E2E_LANE = {}
# The Claude PR reviewer (owner, 13 Nov 2026, asked via AskUserQuestion: "Trial Claude on jobadabra (Recommended)", then "We should replace Gitar with something" / "With Claude Code review"): ONE reusable workflow runs
# anthropics/claude-code-action on the owner's Claude PLAN token (CLAUDE_CODE_OAUTH_TOKEN, never an API key), read-only tools, Sonnet, a daily cap. It overrides the 28 Oct / 3 Nov "CI AI goes through the broker" rule for this one file;
# a second file naming the action still fails here. The action is pinned to its release commit.
CLAUDE_REVIEW = {'.github/workflows/claude-review-shared.yml': {'anthropics/claude-code-action@f3b070c88125d33dbae5653df5f143101d4ea9dc'}, '.github/workflows/claude-replay.yml': {'anthropics/claude-code-action@f3b070c88125d33dbae5653df5f143101d4ea9dc'}}
ALLOWED = {**USER_PIPELINES, **E2E_LANE, **CLAUDE_REVIEW}

# Allowed by name anywhere, not on the shrinking list (coordinator, 31 Oct 2026): the Admin key only READS what Anthropic billed (daily.yml here; ai-cost-billed.yml moved to jobadabra-web, rs 6a/6); it makes no model call and spends nothing.
# The guard bans keys that buy model calls.
COST_READERS = {'ANTHROPIC_ADMIN_KEY', 'secrets.ANTHROPIC_ADMIN_KEY'}


def words(text):
    """-> the set of words naming Anthropic in a YAML file, comments left out (a `#` at the start of a line or after a space)."""
    code = '\n'.join(re.sub(r'(^|\s)#.*$', '', line) for line in text.splitlines())
    return set(WORD.findall(code)) - COST_READERS


def found(root=ROOT):
    files = sorted((root / '.github' / 'workflows').glob('*.yml')) + sorted((root / '.github' / 'actions').glob('*/action.yml'))
    return {path.relative_to(root).as_posix(): words(path.read_text(encoding='utf-8')) for path in files}


class NoAnthropicInCI(unittest.TestCase):
    def test_no_workflow_names_anthropic_beyond_the_allowlist(self):
        extra = {file: sorted(w - ALLOWED.get(file, set())) for file, w in found().items() if w - ALLOWED.get(file, set())}
        self.assertEqual(extra, {}, 'CI AI goes through the Codex broker (desktop/e2e/lib/broker-client.mjs): no Anthropic key, no claude-code-action')

    def test_the_allowlist_only_shrinks(self):
        seen = found()
        stale = {file: sorted(words - seen.get(file, set())) for file, words in ALLOWED.items() if words - seen.get(file, set())}
        self.assertEqual(stale, {}, 'these words left their files: delete them from ALLOWED so the list shrinks')

    def test_the_moved_workflows_use_the_broker(self):
        moved = {'ui-verdict': r'node desktop/e2e/judge-codex\.mjs', 'ui-findings': r'node desktop/e2e/judge-codex\.mjs', 'ui-fix': r'node desktop/e2e/edit-codex\.mjs',
                 'finder-review': r'node desktop/e2e/edit-codex\.mjs', 'judge-exam': r'node desktop/e2e/judge-codex\.mjs'}
        for name, script in moved.items():
            text = (ROOT / '.github' / 'workflows' / f'{name}.yml').read_text(encoding='utf-8')
            self.assertIn('id-token: write', text, f'{name}: the broker knows a run by its OIDC token')
            self.assertRegex(text, script, name)
            self.assertIn('ai-skipped-alert', text, f'{name}: a refused call tells the owner once')

    def test_user_pipelines_are_reusable_workflows_not_ci_jobs(self):
        for file in USER_PIPELINES:
            text = (ROOT / file).read_text(encoding='utf-8')
            self.assertRegex(text, r'(?m)^\s+workflow_call:', f'{file}: runs in the user\'s repo with the user\'s key, called by their workflow')
            self.assertNotRegex(text, r'(?m)^\s+(schedule|push|pull_request):', f'{file}: nothing of ours starts it')

    def test_the_guard_sees_a_planted_key(self):
        self.assertEqual(words('env:\n  K: ${{ secrets.NEW_ANTHROPIC_KEY }}  # fine\n# anthropic in a comment\n'), {'secrets.NEW_ANTHROPIC_KEY'})
        self.assertEqual(words('uses: anthropics/claude-code-action@v1\n'), {'anthropics/claude-code-action@v1'})


if __name__ == '__main__':
    unittest.main()
