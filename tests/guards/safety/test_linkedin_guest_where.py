"""Guard: safety — LinkedIn's public job search is read only from a person's own computer: without this guard a workflow, a tool or the cloud runner could set the flag and
read LinkedIn from shared server addresses, which the owner refused (13 Nov 2026, asked via AskUserQuestion: "On each person's Mac (Recommended)"; Always on only as an
owner-approved, capped trial: spec docs/superpowers/specs/2026-11-13-linkedin-guest-search-design.md, Caps).
Only the files below may name JOBADABRA_LINKEDIN_GUEST in code; tests, docs and specs may name it freely. The Always on trial (4/4) adds its one gated file here, with the owner's words."""
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
FLAG = 'JOBADABRA_LINKEDIN_GUEST'
ALLOWED = {
    'desktop/lib/linkedin-guest-on.js',   # the one setter: an installed build, the signed-in switch off, not paused
    'src/features.py',                    # the feature's row (its needs)
    'src/sources/linkedin_guest.py',      # the reader's own docstring
    'src/sources/reader_rows.py',         # the row's gate docstring
    # The Always on trial (owner, 13 Nov 2026, asked via AskUserQuestion: "Both ways"): both cloud ways set it only beside the site's turn address; the reader refuses a cloud run
    # without one (src/sources/linkedin_guest.py on(), tests/unit/sources/test_linkedin_turn.py), and the site gives turns to the owner's install only.
    'src/hosted_run.py',                  # our servers
    '.github/workflows/daily.yml',        # the person's own GitHub repo (it calls this workflow)
}
DOCS = ('docs/', 'tests/', 'desktop/test/', 'desktop/integration/', 'desktop/e2e/')


class LinkedinGuestWhereTest(unittest.TestCase):
    def test_only_the_desktop_app_sets_the_flag(self):
        listed = subprocess.run(['git', 'ls-files'], cwd=ROOT, capture_output=True, text=True, check=True).stdout.split('\n')
        named = []
        for name in listed:
            if not name or name.startswith(DOCS) or name.endswith(('.md', '.png', '.jpg', '.html')):
                continue
            try:
                text = (ROOT / name).read_text(encoding='utf-8')
            except (OSError, UnicodeDecodeError):
                continue
            if FLAG in text:
                named.append(name)
        self.assertIn('desktop/lib/linkedin-guest-on.js', named, 'positive control: the setter itself is found')
        self.assertEqual(sorted(set(named) - ALLOWED), [], 'a file outside the desktop app names the LinkedIn guest flag: CI, tools and the cloud never read LinkedIn')


if __name__ == '__main__':
    unittest.main()
