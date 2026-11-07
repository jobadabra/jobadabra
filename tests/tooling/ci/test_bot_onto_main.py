"""Guard: data — without it the daily pool PR (and the sentry-fix, ui-fix, finder-review PRs) is refused by GitHub when main's workflow files changed after the run started (run 42372843705, 7 Nov 2026).

Plays that run: a depth-1 checkout of the run's SHA, main moves on and changes a workflow file, the bot commits one file; the branch to push must differ from main in that file only.
"""
import re
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
HELPER = ROOT / 'tools' / 'bot-onto-main.sh'
BOT_WORKFLOWS = ['record-sites', 'sentry-fix', 'ui-fix', 'finder-review']


def git(cwd, *args, check=True):
    return subprocess.run(['git', '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'protocol.file.allow=always', *args], cwd=cwd, capture_output=True, text=True, check=check)


class BotOntoMain(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name)
        self.origin, self.clone = base / 'origin', base / 'clone'
        self.origin.mkdir()
        git(self.origin, 'init', '-q', '-b', 'main')
        (self.origin / '.github' / 'workflows').mkdir(parents=True)
        (self.origin / '.github' / 'workflows' / 'page-cases.yml').write_text('name: v1\n')
        (self.origin / 'smoke-sites.json').write_text('[]\n')
        git(self.origin, 'add', '-A'); git(self.origin, 'commit', '-qm', 'run SHA')
        git(base, 'clone', '-q', '--depth=1', f'file://{self.origin}', 'clone')   # what actions/checkout does: one commit
        (self.origin / '.github' / 'workflows' / 'page-cases.yml').write_text('name: v2\n')
        git(self.origin, 'commit', '-qam', 'main changes a workflow after the run started')
        self.newest = git(self.origin, 'rev-parse', 'HEAD').stdout.strip()
        git(self.clone, 'checkout', '-q', '-b', 'discovery/x')
        (self.clone / 'smoke-sites.json').write_text('["a"]\n')
        git(self.clone, 'add', 'smoke-sites.json'); git(self.clone, 'commit', '-qm', 'the bot commit')

    def tearDown(self):
        self.tmp.cleanup()

    def changed_vs_main(self):
        git(self.clone, 'fetch', '-q', '--depth=1', 'origin', '+refs/heads/main:refs/remotes/origin/main')
        return git(self.clone, 'diff', '--name-only', 'origin/main', 'HEAD').stdout.split()

    def run_helper(self):
        return subprocess.run(['bash', str(HELPER)], cwd=self.clone, capture_output=True, text=True, env={'PATH': '/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin', 'HOME': self.tmp.name, 'GIT_AUTHOR_NAME': 't', 'GIT_AUTHOR_EMAIL': 't@t', 'GIT_COMMITTER_NAME': 't', 'GIT_COMMITTER_EMAIL': 't@t', 'GIT_CONFIG_COUNT': '1', 'GIT_CONFIG_KEY_0': 'protocol.file.allow', 'GIT_CONFIG_VALUE_0': 'always'})

    def test_the_failed_run_positive_control(self):
        self.assertIn('.github/workflows/page-cases.yml', self.changed_vs_main(), 'without the helper the branch differs from main in the workflow file: the refused push')

    def test_branch_differs_from_main_only_in_the_bot_file(self):
        done = self.run_helper()
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(self.changed_vs_main(), ['smoke-sites.json'])
        self.assertEqual(git(self.clone, 'rev-parse', 'HEAD~1').stdout.strip(), self.newest, 'one commit on main as it is now')
        self.assertEqual(git(self.clone, 'log', '--format=%s', '-1').stdout.strip(), 'the bot commit')

    def test_a_conflict_stops_red_and_pushes_nothing(self):
        (self.origin / 'smoke-sites.json').write_text('["b"]\n')
        git(self.origin, 'commit', '-qam', 'another pool PR merged')
        done = self.run_helper()
        self.assertNotEqual(done.returncode, 0)
        self.assertIn('conflicts with main', done.stderr)

    def test_every_bot_workflow_calls_it_between_commit_and_push(self):
        for name in BOT_WORKFLOWS:
            text = (ROOT / '.github' / 'workflows' / f'{name}.yml').read_text()
            order = [m.start() for m in (re.search(p, text) for p in (r'tools/bot-commit\.sh', r'tools/bot-onto-main\.sh', r'git push -q "https://x-access-token'))]
            self.assertEqual(order, sorted(order), f'{name}.yml: bot-commit, then bot-onto-main, then push')


if __name__ == '__main__':
    unittest.main()
