"""Internal CI and release workflows message "Jobadabra · CI alerts", never the product bot that sends the owner's job digest.

17 Oct 2026: the monthly PR-check scorecard (and release-guard) posted through secrets.TELEGRAM_BOT_TOKEN, the bot of the user's own pipeline;
the owner: "this is product internal. Shouldn't come here." Pipeline · workflows (daily, mail, scout) keep the product bot: they are the user's own.
Every other workflow is internal, whatever its name (5 Nov 2026: the PR checks were renamed by layer, "Unit", "Guard", "AI fixer", and fell out of a "CI ·"/"Release ·" list).
"""
import pathlib
import re
import unittest

WORKFLOWS = pathlib.Path(__file__).resolve().parents[3] / '.github' / 'workflows'
PRODUCT_BOT = re.compile(r'secrets\.TELEGRAM_(BOT_TOKEN|CHAT_ID)\b')
OLD_BOT = re.compile(r'secrets\.(CI_ALERTS_TELEGRAM_BOT_TOKEN|BUILDLOG_TELEGRAM_TOKEN)\b|api\.telegram\.org')
SENDER = re.compile(r'node\s+(desktop/e2e/(ci-alert|credit-alert|release-alert|release-failed-alert|tell-owner|search-alert|refill-auto)\.mjs|tools/msix-store-watch\.mjs\s+(tell|broken)|tools/feedback-released\.mjs|tools/fixer/follow\.mjs)|python3?\s+tools/release_guard\.py|uses: \./\.github/actions/ai-skipped-alert')
KEY = re.compile(r'SELFHEAL_PUBLISH_KEY|switchboard-key')


def code(text):
    """The text without comment lines or trailing comments (a comment that names a sender is not a sender)."""
    return '\n'.join(re.sub(r'\s+#.*$', '', line) for line in text.split('\n') if not line.lstrip().startswith('#'))


def workflow_steps(text):
    """-> [(label, scope, step)]: every step with the env that reaches it (the workflow's and its job's), comments removed."""
    text = code(text)
    head, _, jobs = text.partition('\njobs:')
    out = []
    for block in re.split(r'(?m)\n(?=  [A-Za-z0-9_-]+:\s*$)', jobs)[1:]:
        job = block.split('\n', 1)[0].strip().rstrip(':')
        pre, _, steps = block.partition('\n    steps:')
        for index, step in enumerate(re.split(r'\n(?=      - )', steps)[1:], 1):
            label = re.search(r'name:\s*(.+)', step)
            out.append((f'{job} step {index}' + (f' ({label.group(1).strip()[:50]})' if label else ''), head + pre, step))
    return out


class TelegramBotTest(unittest.TestCase):
    def test_ci_and_release_workflows_never_read_the_product_bot(self):
        internal = []
        for path in sorted(WORKFLOWS.glob('*.yml')):
            text = path.read_text()
            name = re.search(r'^name:\s*(.+)$', text, re.M)
            if name and not name.group(1).strip().strip('\'"').startswith('Pipeline ·'):
                internal.append(path.name)
                self.assertIsNone(PRODUCT_BOT.search(text), f'{path.name} posts through the product bot: use secrets.CI_ALERTS_TELEGRAM_BOT_TOKEN / CI_ALERTS_TELEGRAM_CHAT_ID')
        self.assertIn('pr-check-scorecard.yml', internal)
        self.assertIn('release-guard.yml', internal)
        self.assertIn('ai-fixer.yml', internal)


    def test_every_caller_of_the_ai_skipped_alert_passes_the_switchboard_key(self):
        """Guard: release - an AI-skipped alert whose caller leaves out the key bypasses the owner's Notifications switch (nt 3/4e, 5 Nov 2026)."""
        callers = [path.name for path in sorted(WORKFLOWS.glob('*.yml')) if 'uses: ./.github/actions/ai-skipped-alert' in path.read_text()]
        self.assertGreaterEqual(len(callers), 6, f'positive control: {callers}')
        # finder-review.yml applies Codex's edits to desktop/e2e/lib in its `review` job: the site's key stays out of THAT job's alert; its alert is a job of its own with a clean checkout (12 Nov 2026)
        review = (WORKFLOWS / 'finder-review.yml').read_text()
        self.assertNotIn('ai-skipped-alert', review.split('\n  tell:')[0], 'the alert must not run in the job that applies Codex edits')
        self.assertIn('edit-codex.mjs', review.split('\n  tell:')[0])
        for name in callers:
            text = (WORKFLOWS / name).read_text()
            block = text[text.index('uses: ./.github/actions/ai-skipped-alert'):]
            block = block[:block.index('github-token:')]
            with self.subTest(workflow=name):
                self.assertIn('switchboard-key: ${{ secrets.SELFHEAL_PUBLISH_KEY }}', block)

    def test_no_step_hands_an_old_bot_to_a_sender_without_the_switchboard_key(self):
        """Guard: release - a step that can post with an old CI bot but has no SELFHEAL_PUBLISH_KEY / switchboard-key in its scope bypasses the owner's Notifications switch.

        Why (12 Nov 2026, owner: "Still getting on old telegram bots: CI Alerts, Build Log ..."): two escapes the same day: lab board-discovery.yml (ai-skipped-alert with bot-token only) and
        web daily-digest (Build Log bot only). Scope = the workflow's env + the job's env + the step; comments are not code. Pipeline · workflows (the person's own product bot) are out.
        """
        sending = 0
        for path in sorted(WORKFLOWS.glob('*.yml')):
            text = path.read_text()
            name = re.search(r'^name:\s*(.+)$', text, re.M)
            if not name or name.group(1).strip().strip('\'"').startswith('Pipeline ·'):
                continue
            for where, scope, step in workflow_steps(text):
                if not (OLD_BOT.search(step) or SENDER.search(step)):
                    continue
                sending += 1
                with self.subTest(workflow=path.name, step=where):
                    self.assertRegex(scope + step, KEY, f'{path.name}: {where} can send with an old bot but has no switchboard key in its step, job or workflow env')
        self.assertGreaterEqual(sending, 25, f'positive control: {sending} sending steps found')


if __name__ == '__main__':
    unittest.main()
