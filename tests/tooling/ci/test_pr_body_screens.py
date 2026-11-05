"""tools/pr-body.sh and the screens of a PR: images are required when a page changed visibly, and a change that draws nothing says so instead of shooting an unrelated page.
Why (5 Nov 2026, owner: "the screenshots on the PRs in jobadabra-web has nothing to do with the changes"; jobadabra-web#417 changed an admin file for a Test that the app draws, and
session ri: "the PR body checker refuses any change under admin/ without before/after images, so a reader-only PR can't pass"). Temporary repo, no network, no app data."""
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
IMPACT = ''.join(f'| {a} | — None | x |\n' for a in ('Real users', 'Form filling', 'Admin data accuracy', 'Offline replays', 'Tests & harness', 'Development speed', 'Cost'))
BODY = ('🟢 A Test answers in ten seconds\n\n**Why:** owner, 5 Nov 2026\n\n**Unblocks:** the app\n\n' + IMPACT +
        '\n| What | Before | After |\n|---|---|---|\n| time | 10 min | 10 s |\n\n{screens}\n')


@unittest.skipUnless(shutil.which('git') and shutil.which('bash'), 'needs git and bash')
class ScreensRule(unittest.TestCase):
    def check(self, changed, screens):
        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp, True)
        (tmp / 'tools').mkdir()
        for name in ('pr-body.sh', 'pr-screens.py', 'pr-body-format.py', 'pr-title.sh'):
            shutil.copy(ROOT / 'tools' / name, tmp / 'tools' / name)
        run = lambda *a: subprocess.run(a, cwd=tmp, check=True, capture_output=True, text=True)
        run('git', 'init', '-q', '-b', 'main')
        run('git', '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'base')
        for path in changed:
            (tmp / path).parent.mkdir(parents=True, exist_ok=True)
            (tmp / path).write_text('x\n')
        run('git', 'add', '-A')
        run('git', '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'change')
        (tmp / 'body.md').write_text(BODY.format(screens=screens))
        return subprocess.run(['bash', 'tools/pr-body.sh', 'HEAD~1', '--body=body.md'], cwd=tmp, capture_output=True, text=True)

    def test_a_reader_only_admin_change_may_say_no_visible_change(self):
        result = self.check(['admin/hosted-reader.js'], 'No visible change: a reader of hosted_runs, no card or text moves.')
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_no_visible_change_needs_a_reason(self):
        self.assertEqual(self.check(['admin/hosted-reader.js'], 'No visible change: x').returncode, 2)

    def test_no_screenshots_is_still_refused_for_a_site_page(self):
        result = self.check(['admin/hosted-reader.js'], 'No screenshots: a reader, nothing on screen changes.')
        self.assertEqual(result.returncode, 2)
        self.assertIn('No visible change', result.stderr)

    def test_a_page_change_without_either_is_refused(self):
        self.assertEqual(self.check(['web/public/index.html'], '').returncode, 2)


if __name__ == '__main__':
    unittest.main()
