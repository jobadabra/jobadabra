"""Only a desktop-v* release is ever stable/Latest (17 Oct 2026: a PR-screenshot release became Latest and the Download link pointed at it)."""
import importlib.util
import json
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'tools'))


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'tools' / f'{name}.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


guard, labels, promote = load('release_guard'), load('sync_release_labels'), load('canary_promote')


def rel(tag, **kw):
    return {'tagName': tag, 'name': tag, 'isPrerelease': False, 'isLatest': False, 'isDraft': False, 'createdAt': '2026-10-17T10:00:00Z', **kw}


# pr-assets stole Latest from 0.7.16; 0.7.17 is a build.
STOLEN = [rel('pr-assets-prefs-clean-values', isLatest=True), rel('desktop-v0.7.17', isPrerelease=True), rel('desktop-v0.7.16'), rel('desktop-v0.7.15')]


class GuardTests(unittest.TestCase):
    def test_a_non_desktop_latest_is_repointed_to_the_newest_stable_desktop_release(self):
        found = guard.plan(STOLEN)
        self.assertEqual((found['latest'], found['repoint']), ('pr-assets-prefs-clean-values', 'desktop-v0.7.16'))
        self.assertEqual(found['demote'], ['pr-assets-prefs-clean-values'])

    def test_a_desktop_latest_is_left_alone(self):
        found = guard.plan([rel('desktop-v0.7.16', isLatest=True), rel('desktop-v0.7.15'), rel('pr-assets-x', isPrerelease=True)])
        self.assertEqual((found['repoint'], found['demote']), (None, []))

    def test_versions_sort_as_numbers(self):
        self.assertEqual(guard.plan([rel('x', isLatest=True), rel('desktop-v0.7.9'), rel('desktop-v0.7.10')])['repoint'], 'desktop-v0.7.10')

    def test_the_labeller_ignores_a_non_desktop_latest(self):
        self.assertNotEqual(labels.state_of(STOLEN[0], False), 'stable')
        self.assertEqual(labels.state_of(rel('desktop-v0.7.16', isLatest=True), False), 'stable')
        self.assertEqual([r['tagName'] for r in guard.desktop_only(STOLEN)], ['desktop-v0.7.17', 'desktop-v0.7.16', 'desktop-v0.7.15'])

    def test_a_non_desktop_latest_is_never_the_stable_the_canary_is_measured_from(self):
        stable, newer = promote._newer_than_stable(STOLEN)
        self.assertIsNone(stable)
        self.assertEqual([r['tagName'] for r in newer], ['desktop-v0.7.17'])
        stable, _ = promote._newer_than_stable([rel('desktop-v0.7.16', isLatest=True)] + STOLEN[1:])
        self.assertEqual(stable['tagName'], 'desktop-v0.7.16')


class OnlyDesktopReleasesTests(unittest.TestCase):
    """24 Oct 2026, owner: "it should be only desktop app releases" (7 pre-release "PR assets" rows sat in the list)."""
    LIST = [rel('desktop-v0.7.16', isLatest=True), rel('pr-assets-x', isPrerelease=True), rel('notes-2026', isPrerelease=False)]

    def test_the_guard_names_every_release_that_is_not_a_desktop_build_even_a_pre_release(self):
        self.assertEqual(guard.plan(self.LIST)['strangers'], ['pr-assets-x', 'notes-2026'])
        self.assertEqual(guard.plan([rel('desktop-v0.7.16', isLatest=True)])['strangers'], [])

    def test_the_guard_alerts_on_telegram_naming_them_and_deletes_nothing(self):
        calls, told = [], []
        guard._gh = lambda *a: calls.append(a) or json.dumps(self.LIST)
        guard._tell = told.append
        guard.main([])
        self.assertIn('pr-assets-x', told[0])
        self.assertFalse([c for c in calls if 'delete' in c])

    def test_tell_goes_through_the_switchboard_first_and_the_old_bot_only_when_it_cannot_deliver(self):
        import io
        import os
        import urllib.error
        seen = []
        def site(kind):
            def urlopen(request, data=None, timeout=None):
                url = request if isinstance(request, str) else request.full_url
                seen.append((url, getattr(request, 'headers', {}), json.loads(request.data) if getattr(request, 'data', None) and 'ops/notify' in url else None))
                if 'ops/notify' in url and kind == 'down':
                    raise OSError('down')
                if 'ops/notify' in url and kind == '503':
                    raise urllib.error.HTTPError(url, 503, 'channel-not-connected', {}, io.BytesIO(b'{"ok":false}'))
                class Reply:
                    status = 200
                    def __enter__(self): return self
                    def __exit__(self, *a): return False
                    def read(self):
                        if 'api.telegram.org' in url: return b'{"ok":true}'
                        return {'sent': b'{"ok":true,"sent":true}', 'held': b'{"ok":true,"sent":false,"why":"off"}', 'list': b'[1]', 'text': b'"x"', 'html': b'<html>maintenance</html>'}[kind]
                return Reply()
            return urlopen
        real, saved = guard.urllib.request.urlopen, dict(os.environ)
        try:
            os.environ.update({'SELFHEAL_PUBLISH_KEY': 'k', 'TELEGRAM_BOT_TOKEN': 't', 'TELEGRAM_CHAT_ID': 'c'})
            for kind, old_bot in (('sent', False), ('held', False), ('down', True), ('503', True), ('list', True), ('text', True), ('html', True)):
                seen.clear()
                guard.urllib.request.urlopen = site(kind)
                guard._tell('Latest is wrong')   # must never raise
                with self.subTest(switchboard=kind):
                    self.assertEqual(any('api.telegram.org' in url for url, *_ in seen), old_bot)
                    posts = [body for url, _, body in seen if body]
                    self.assertEqual(posts[0]['event'], 'release-guard')
                    self.assertEqual(posts[0].get('level'), 'problem')
                    self.assertEqual([p.get('fallback') for p in posts[1:]], [True] if old_bot else [], 'the fallback is reported once, after the old bot sent')
            self.assertEqual({k.lower(): v for k, v in seen[0][1].items()}.get('user-agent'), 'jobadabra-ci')
        finally:
            guard.urllib.request.urlopen = real
            os.environ.clear(); os.environ.update(saved)

    def test_the_labeller_never_edits_a_non_desktop_release(self):
        calls = []
        def fake(*a):
            calls.append(a)
            return json.dumps(self.LIST) if a[:2] == ('release', 'list') else 'https://github.com/x/y/issues/7' if a[:2] == ('issue', 'create') else '{"id": "n"}' if a[:2] == ('issue', 'view') else '[]'
        labels._gh = fake
        labels.main(['x'])
        edited = [c for c in calls if c[:2] == ('release', 'edit')]
        self.assertTrue(all(c[2].startswith('desktop-v') for c in edited), edited)


class NoOtherReleasesTests(unittest.TestCase):
    """Class: no tool, skill, doc or workflow creates a release except the desktop build (desktop.yml) and the one helper (always pre-release, never Latest)."""
    ALLOWED = {'.github/workflows/desktop.yml', 'tools/gh-release-create.sh', 'tests/tooling/release/test_release_guard.py'}

    def test_gh_release_create_only_in_the_build_and_the_helper(self):
        offenders = []
        for folder in ['tools', '.github', '.claude/skills', 'docs', 'desktop/scripts', 'desktop/e2e', 'src']:
            for path in (ROOT / folder).rglob('*'):
                if not path.is_file() or 'node_modules' in path.parts or path.suffix in {'.png', '.jpg', '.zip', '.json', '.pyc'}:
                    continue
                name = str(path.relative_to(ROOT))
                if name in self.ALLOWED:
                    continue
                for number, line in enumerate(path.read_text(errors='ignore').splitlines(), 1):
                    if re.search(r'gh release create|releases\.create|createRelease|release create', line) and not line.lstrip().startswith(('#', '//')):
                        offenders.append(f'{name}:{number}')
        self.assertEqual(offenders, [], 'use tools/gh-release-create.sh (pre-release, never Latest); PR images: tools/pr-assets.mjs')

    def test_the_helper_always_passes_prerelease_and_not_latest(self):
        text = (ROOT / 'tools/gh-release-create.sh').read_text()
        self.assertIn('--prerelease --latest=false', text)

    def test_the_guard_runs_on_a_schedule(self):
        text = (ROOT / '.github/workflows/release-guard.yml').read_text()
        self.assertIn('schedule:', text)
        self.assertIn('tools/release_guard.py', text)


if __name__ == '__main__':
    unittest.main()
