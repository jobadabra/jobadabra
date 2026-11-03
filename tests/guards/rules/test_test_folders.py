"""Every test file sits in a folder TESTS.md maps (type / intent / scope); a file anywhere else fails here with the row to move it to.

Guard: release — a test outside a mapped folder is either never run by CI or found by nobody (two such files ran nowhere on 3 Nov 2026).
Why (3 Nov 2026, owner: "our tests are being spread randomly across the codebase", "a clear folder structure with: unit tests, integrations tests, e2e tests...
guards", "easy to find each folder", "properly structured by type/intent/scope"; option "B: same names per home"): the folders are read from TESTS.md's table, so
the map people read and the rule this test keeps cannot drift. Why (3 Nov 2026, test folders 3/3): every file moved, so no allowlist is left.
"""
import re
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
MAP = ROOT / 'TESTS.md'
TEST_FILE = re.compile(r'(^|/)test_[^/]*\.py$|\.test\.[cm]?[jt]s$')


def mapped_folders():
    """The folder patterns of TESTS.md's table (its first column), a <placeholder> standing for one folder name."""
    rows = re.findall(r'^\| `([^`]+/)` \|', MAP.read_text(), flags=re.M)
    return [re.compile('^' + re.sub(r'<[a-z]+>', '[^/]+', re.escape(row).replace(r'\<', '<').replace(r'\>', '>'))) for row in rows]


def test_files():
    listed = subprocess.run(['git', 'ls-files'], cwd=ROOT, capture_output=True, text=True, check=True).stdout.splitlines()
    return [f for f in listed if TEST_FILE.search(f) and 'node_modules/' not in f]


class TestFoldersTest(unittest.TestCase):
    def test_the_map_names_the_folders(self):
        self.assertGreaterEqual(len(mapped_folders()), 8, 'TESTS.md lost its table of folders')

    def test_every_test_file_is_in_a_mapped_folder(self):
        folders = mapped_folders()
        stray = [f for f in test_files() if not any(p.match(f) for p in folders)]
        self.assertEqual(stray, [], 'put each in the TESTS.md row that fits it (type / intent / scope), e.g. tests/unit/ai/ or desktop/test/unit/renderer/')


if __name__ == '__main__':
    unittest.main()
