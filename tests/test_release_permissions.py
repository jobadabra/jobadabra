"""The screenshot review runs in one place (.github/actions/e2e-review), used by every e2e lane. (Until 2 Nov 2026 this file also
checked that release jobs could write issues, for the pinned Release channels issue; that issue is gone.)"""
import re
import unittest
from pathlib import Path

WORKFLOWS = Path(__file__).resolve().parents[1] / '.github' / 'workflows'


def permissions(block):
    """{scope: level} of the first `permissions:` mapping in `block` (indented lines under it)."""
    match = re.search(r'^( *)permissions:[ \t]*\n((?:\1  +[\w-]+: *[\w-]+.*\n)+)', block, re.M)
    return dict(re.findall(r'^ +([\w-]+): *([\w-]+)', match.group(2), re.M)) if match else None


def jobs(text):
    """(name, text) of each job: the two-space keys under `jobs:`."""
    body = text.split('\njobs:\n', 1)[1]
    parts = re.split(r'^  ([\w-]+):[ \t]*(?:#.*)?\n', body, flags=re.M)
    return list(zip(parts[1::2], parts[2::2]))


class ReleaseJobsMayWriteIssues(unittest.TestCase):
    def test_every_job_that_runs_a_release_script_has_issues_write(self):
        # Since 26 Oct 2026 the review runs in one place, .github/actions/e2e-review (all of a lane's pages in one batch), used by every lane.
        action = (WORKFLOWS.parent / 'actions' / 'e2e-review' / 'action.yml').read_text()
        self.assertIn('node review-ui.mjs', action)
        self.assertIn('--job e2e-screenshot-review', action, 'the screenshot review reports its cost')
        users = [f'{path.name}:{name}' for path in sorted(WORKFLOWS.glob('*.yml')) if '\njobs:\n' in path.read_text()
                 for name, job in jobs(path.read_text()) if 'uses: ./.github/actions/e2e-review' in job]
        self.assertGreaterEqual(len(users), 2, users)   # e2e.yml and e2e-windows.yml (1 Nov 2026: the beta's release lanes no longer review)
