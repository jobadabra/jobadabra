"""Guard: a comment that is exactly "Gitar review" is a session's own request, never an owner comment (11 Nov 2026, #3785: the watcher announced its own request as `ship: COMMENT owner`
and READY waited for a push). Gitar reads the bare words, so the comment carries no Claude Code line and the classifier must know it. Runs tools/pr-comments-lib.sh's pc_items under bash."""
import json
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def classify(body, login='GarryOne'):
    view = {'url': 'u', 'comments': [{'id': 'C1', 'author': {'login': login}, 'body': body, 'createdAt': '2026-11-11T01:17:21Z'}], 'reviews': []}
    script = f'. "{ROOT / "tools" / "pr-comments-lib.sh"}"; pc_items \'{json.dumps(view)}\' \'[]\''
    out = subprocess.run(['bash', '-c', script], capture_output=True, text=True, check=True, timeout=30).stdout
    return out.split('\t')[1]


@unittest.skipUnless(shutil.which('jq') and shutil.which('bash'), 'needs jq and bash')
class GitarRequestIsOwnTest(unittest.TestCase):
    def test_the_bare_request_is_a_sessions_own_comment(self):
        self.assertEqual(classify('Gitar review'), 'self')
        self.assertEqual(classify('  Gitar review\n'), 'self')

    def test_a_real_owner_comment_stays_an_owner_comment(self):
        self.assertEqual(classify('Gitar review and fix the label too'), 'owner')
        self.assertEqual(classify('please look at this'), 'owner')

    def test_gitar_itself_stays_a_bot(self):
        self.assertEqual(classify('Gitar review', login='gitar-bot[bot]'), 'self')


if __name__ == '__main__':
    unittest.main()
