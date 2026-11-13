"""Guard: data — a profile whose role is not a family in draws.json carries its own role text, and building its CV must not touch the seeded draws (which would move the night people).
Why (13 Nov 2026, sa for the owner: 7 more Trello profiles, music / financial analyst / IT project manager are no family): draws.json stays as it is; a row brings duty, education and tools."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'tools' / 'persona-search'))
import draw  # noqa: E402
import profiles  # noqa: E402


class OwnRoleText(unittest.TestCase):
    def cv_of(self, pid):
        with tempfile.TemporaryDirectory() as out:
            profiles.cv(pid, out)
            return (Path(out) / 'draw' / 'cv.md').read_text(encoding='utf-8')

    def test_a_role_that_is_no_family_builds_from_its_own_text(self):
        text = self.cv_of('d02')
        self.assertIn('Berlin, Germany', text)
        self.assertIn('Ableton Live', text, "the row's own tools are in the CV")
        self.assertIn('Audio and Media Producer', text)

    def test_every_profile_builds_and_names_its_own_city(self):
        for p in profiles.PROFILES:
            self.assertIn(f"{p['city']}, {p['country']}", self.cv_of(p['id']), p['id'])

    def test_a_row_without_text_for_an_unknown_family_says_so(self):
        saved = profiles.PROFILES[:]
        profiles.PROFILES.append({'id': 'x01', 'family': 'nobody', 'title': 'T', 'city': 'C', 'country': 'Y', 'language': 'L', 'eures': 0})
        try:
            with self.assertRaisesRegex(ValueError, 'not in draws.json'):
                self.cv_of('x01')
        finally:
            profiles.PROFILES[:] = saved

    def test_the_new_rows_are_not_measured_never_a_pass(self):
        rows = [p for p in profiles.PROFILES if p['id'].startswith('d')]
        self.assertTrue(rows)
        self.assertTrue(all(profiles.target(99, p['eures']) == 'not measured' for p in rows))

    def test_a_profile_without_its_own_text_builds_the_cv_it_always_had(self):
        # Why (Gitar on #4010): the first version overrode the family's title for every row, which changed the CVs of b01-c20; expected = the family's own template, built here the old way.
        for p in profiles.PROFILES:
            if any(k in p for k in ('duty', 'education', 'tools')):
                continue
            family = next(f for f in draw.DATA['families'] if f['id'] == p['family'])
            expected = '\n'.join(draw.cv(family, {k: p[k] for k in ('city', 'country', 'language')}, 'Alex Example')) + '\n'
            self.assertEqual(self.cv_of(p['id']), expected, p['id'])


if __name__ == '__main__':
    unittest.main()
