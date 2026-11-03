"""Every test file sits in a folder TESTS.md maps (type / intent / scope); a file anywhere else fails here with the row to move it to.

Guard: release — a test outside a mapped folder is either never run by CI or found by nobody (two such files ran nowhere on 3 Nov 2026).
Why (3 Nov 2026, owner: "our tests are being spread randomly across the codebase", "a clear folder structure with: unit tests, integrations tests, e2e tests...
guards", "easy to find each folder", "properly structured by type/intent/scope"; option "B: same names per home"): the folders are read from TESTS.md's table, so
the map people read and the rule this test keeps cannot drift. The flat files still at the top of tests/ and desktop/test/ are in test-folders-allowed.txt,
which only shrinks: each move PR deletes the lines of the files it moves.
"""
import re
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
MAP = ROOT / 'TESTS.md'
ALLOWED = Path(__file__).with_name('test-folders-allowed.txt')
TEST_FILE = re.compile(r'(^|/)test_[^/]*\.py$|\.test\.[cm]?[jt]s$')


def mapped_folders():
    """The folder patterns of TESTS.md's table (its first column), a <placeholder> standing for one folder name."""
    rows = re.findall(r'^\| `([^`]+/)` \|', MAP.read_text(), flags=re.M)
    return [re.compile('^' + re.sub(r'<[a-z]+>', '[^/]+', re.escape(row).replace(r'\<', '<').replace(r'\>', '>'))) for row in rows]


def test_files():
    listed = subprocess.run(['git', 'ls-files'], cwd=ROOT, capture_output=True, text=True, check=True).stdout.splitlines()
    return [f for f in listed if TEST_FILE.search(f) and 'node_modules/' not in f]


def allowed():
    return [line for line in ALLOWED.read_text().splitlines() if line and not line.startswith('#')]


class TestFoldersTest(unittest.TestCase):
    def test_the_map_names_the_folders(self):
        self.assertGreaterEqual(len(mapped_folders()), 8, 'TESTS.md lost its table of folders')

    def test_every_test_file_is_in_a_mapped_folder(self):
        folders, left = mapped_folders(), set(allowed())
        stray = [f for f in test_files() if f not in left and not any(p.match(f) for p in folders)]
        self.assertEqual(stray, [], 'put each in the TESTS.md row that fits it (type / intent / scope), e.g. tests/unit/ai/ or desktop/test/unit/renderer/')

    def test_the_allowlist_only_names_files_still_outside(self):
        folders, present = mapped_folders(), set(test_files())
        stale = [f for f in allowed() if f not in present or any(p.match(f) for p in folders)]
        self.assertEqual(stale, [], 'a moved or deleted file: remove its line from tests/guards/rules/test-folders-allowed.txt')


if __name__ == '__main__':
    unittest.main()
