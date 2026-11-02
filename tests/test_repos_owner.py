"""No tracked file names the personal account (GarryOne/<repo>) as a repo owner: the repos live in the org `jobadabra` (org move, 2 Nov 2026).

Why (2 Nov 2026, owner): GitHub's search and `issue list` / `pr list` do not follow a transfer, and neither does a POST (`gh workflow run -R`) or a workflow `uses:`.
A literal old owner therefore reads 0 rows without an error: the Telegram digest said "Nothing was merged on 1 Nov" with 265 merged
(`gh pr list --repo GarryOne/jobadabra --state merged --search "merged:>=2026-10-31"` -> 0, the same under jobadabra/jobadabra -> 265), and the Release channels job opened 14 copies of
its issue because its lookup found none. Code names the owner through one constant per language (desktop/lib/repos.js, src/repos.py, tools/repos.sh); this test keeps them equal and
keeps the old owner out of everything else. The person's login (`GarryOne` without a repo after it) is not a repo owner and is not matched.
Spec: docs/superpowers/specs/2026-11-01-github-org-move-design.md (6/7).
"""
import re
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# `GarryOne/<repo>`, also the escaped regex form `GarryOne\/<repo>`. The owner's own Always-on repo stays under the personal account (owner, 1 Nov 2026).
OLD = re.compile(r'GarryOne\\?/(?!jobadabra-personal-always-on)')

# Whole classes that name the old owner on purpose. A file is matched by prefix (dirs end in /) or exact path.
CLASSES = (
    ('docs/', 'dated specs and notes are history; the owner\'s docs'),
    ('desktop/e2e/recorded/', 'recorded evidence: the case text says where the page was seen, when it was written'),
)
TEST_PATH = re.compile(r'(^|/)(tests?|fixtures)/|\.test\.(js|mjs)$')   # test inputs: a fake name for a fake gh; a test that asserts a tool's output moves with the tool

# One entry per file, each with the reason it still names the old owner and what removes the entry.
ALLOWED = {
    'desktop/lib/repos.js': 'OLD_STARTER: the starter template still lives at GarryOne/job-pilotto-starter until its transfer (entry goes with it)',
    'tools/publish-starter.sh': 'the starter is published to GarryOne/job-pilotto-starter until its transfer (entry goes with it)',
    'tools/rename-map.json': 'the rename plan quotes the pattern it replaces; it is the list of old names, not a lookup',
}


def tracked():
    out = subprocess.run(['git', 'ls-files'], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    return [name for name in out.split('\n') if name]


def guarded(name):
    if name.endswith('.md') or name in ALLOWED or TEST_PATH.search(name):
        return False
    return not any(name.startswith(prefix) for prefix, _ in CLASSES)


def hits():
    found = []
    for name in tracked():
        if not guarded(name):
            continue
        try:
            text = (ROOT / name).read_text(encoding='utf-8')
        except (UnicodeDecodeError, OSError):
            continue
        found += [f'{name}:{n}' for n, line in enumerate(text.split('\n'), 1) if OLD.search(line)]
    return found


class ReposOwnerTests(unittest.TestCase):
    def test_no_code_names_the_personal_account_as_a_repo_owner(self):
        self.assertEqual(hits(), [], 'name the owner through desktop/lib/repos.js, src/repos.py or tools/repos.sh (or `github.repository` / vars.OWNER_OF_* in a workflow): '
                                     'the old owner only redirects a GET, and a search or a POST goes blind')

    def test_every_allowlist_entry_still_names_the_old_owner_and_says_why(self):
        for name, reason in ALLOWED.items():
            self.assertTrue(reason.strip(), name)
            text = (ROOT / name).read_text(encoding='utf-8')
            self.assertTrue(OLD.search(text), f'{name} no longer names GarryOne/: delete its entry')

    def test_the_constants_name_the_same_owner(self):
        read = lambda name: (ROOT / name).read_text(encoding='utf-8')
        found = {
            'desktop/lib/repos.js': re.search(r"export const OWNER = '([\w-]+)'", read('desktop/lib/repos.js')).group(1),
            'desktop/e2e/lib/repos.mjs': re.search(r"export const OWNER = '([\w-]+)'", read('desktop/e2e/lib/repos.mjs')).group(1),
            'src/repos.py': re.search(r"^OWNER = '([\w-]+)'", read('src/repos.py'), re.M).group(1),
            'tools/repos.sh': re.search(r'JOBADABRA_OWNER="\$\{JOBADABRA_OWNER:-([\w-]+)\}"', read('tools/repos.sh')).group(1),
        }
        self.assertEqual(set(found.values()), {'jobadabra'}, f'the org: change all four together {found}')

    def test_the_standalone_copies_pin_the_same_repo(self):
        # Fetched alone by a sparse checkout, these cannot import src/repos.py; they carry the repo name once, pinned here.
        import sys
        sys.path.insert(0, str(ROOT))
        from src.repos import PUBLIC_REPO
        for name in ('tools/main_e2e_state.py', 'tools/rerun_not_acquired.py'):
            self.assertIn(f"'{PUBLIC_REPO}'", (ROOT / name).read_text(encoding='utf-8'), name)


if __name__ == '__main__':
    unittest.main()
