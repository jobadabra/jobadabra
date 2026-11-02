"""tools/sync_release_labels.py: what each release is called."""
import importlib.util
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location('sync_release_labels', Path(__file__).resolve().parents[1] / 'tools' / 'sync_release_labels.py')
labels = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(labels)


def release(n, **kw):
    return {'name': f'0.5.{n} · 2 Oct', 'tagName': f'desktop-v0.5.{n}', 'isPrerelease': True, 'isLatest': False, **kw}


class TitleTests(unittest.TestCase):
    def test_each_state_gets_its_prefix(self):
        self.assertEqual(labels.desired_title(release(252, isPrerelease=False, isLatest=True), False), '✅ STABLE · 0.5.252 · 2 Oct')
        self.assertEqual(labels.desired_title(release(249, isPrerelease=False), False), '📦 Previous stable · 0.5.249 · 2 Oct')
        self.assertEqual(labels.desired_title(release(253), True), '🧪 BETA (release candidate) · 0.5.253 · 2 Oct')
        self.assertEqual(labels.desired_title(release(254), False), '🔨 Build · 0.5.254 · 2 Oct')

    def test_a_prefix_is_replaced_not_stacked_and_a_title_without_one_is_kept_whole(self):
        old = release(253, name='🔨 Build · 0.5.253 · 2 Oct')
        self.assertEqual(labels.desired_title(old, True), '🧪 BETA (release candidate) · 0.5.253 · 2 Oct')
        again = release(253, name=labels.desired_title(old, True))
        self.assertEqual(labels.desired_title(again, True), again['name'], 'idempotent: nothing to edit the second time')

    def test_the_latest_flag_wins_over_the_prerelease_flag(self):
        self.assertEqual(labels.state_of(release(1, isLatest=True), True), 'stable')


class ArgumentTests(unittest.TestCase):
    def test_an_unknown_flag_makes_no_github_call(self):
        calls = []
        real, labels._gh = labels._gh, lambda *args: calls.append(args) or '[]'
        try:
            self.assertEqual(labels.main(['sync_release_labels.py', '--help']), 2)
        finally:
            labels._gh = real
        self.assertEqual(calls, [], 'a --help must never reach GitHub')


if __name__ == '__main__':
    unittest.main()
