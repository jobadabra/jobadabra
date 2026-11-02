"""The org move, played with a fake `gh` that behaves like GitHub after a transfer (2 Nov 2026): a search, an issue/PR list and a workflow dispatch (POST) find the repo
only under its new owner `jobadabra`; under the old one a list answers `[]` and a dispatch is refused. Each tool asks for the repo the way it does in production.
Measured the same day: `gh pr list --repo GarryOne/jobadabra --state merged --search "merged:>=2026-10-31"` -> 0, under jobadabra/jobadabra -> 265.
The literal-owner guard is tests/test_repos_owner.py; this is the behaviour it protects."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
FAKE_GH = r'''#!/bin/bash
# Logs every call; knows jobadabra/* only. A list under any other owner is empty, a dispatch under it fails (GitHub does not follow either).
echo "$*" >> "$FAKE_GH_LOG"
repo=""; prev=""
for a in "$@"; do case "$prev" in -R|--repo) repo="$a" ;; esac; prev="$a"; done
case "$repo" in jobadabra/*) known=1 ;; *) known="" ;; esac
case "$1 $2" in
  "workflow run") [ -n "$known" ] && exit 0 || { echo "could not find any workflows named $3" >&2; exit 1; } ;;
  "issue list"|"pr list") [ -n "$known" ] && echo '[{"number":7,"title":"found","body":""}]' || echo '[]'; exit 0 ;;
esac
exit 0
'''


@unittest.skipIf(sys.platform == 'win32', 'the fake gh is a bash script')
class OrgOwnerScenarios(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        bin_dir = self.tmp / 'bin'
        bin_dir.mkdir()
        (bin_dir / 'gh').write_text(FAKE_GH)
        (bin_dir / 'gh').chmod(0o755)
        self.log = self.tmp / 'gh.log'
        self.env = {**os.environ, 'PATH': f'{bin_dir}{os.pathsep}{os.environ["PATH"]}', 'FAKE_GH_LOG': str(self.log)}

    def gh_list(self, *args):
        done = subprocess.run(['gh', *args], capture_output=True, text=True, env=self.env)
        return json.loads(done.stdout)

    def test_the_lab_dispatch_reaches_the_public_repos_workflow(self):
        repo = self.tmp / 'lab'
        subprocess.run(['git', 'init', '-q', str(repo)], check=True)
        subprocess.run(['git', '-C', str(repo), 'remote', 'add', 'origin', 'git@github.com:jobadabra/jobadabra-lab.git'], check=True)
        done = subprocess.run(['bash', str(ROOT / 'tools' / 'lab-ci-dispatch.sh'), '12'], cwd=repo, capture_output=True, text=True, env=self.env)
        self.assertIn('lab-ci requested for #12', done.stdout, done.stderr)
        self.assertIn('workflow run lab-ci.yml -R jobadabra/jobadabra', self.log.read_text())

    def repo_of(self, module, name):
        """The repo a tool falls back to when run by hand: a fresh interpreter with no GITHUB_REPOSITORY, as on the owner's Mac."""
        env = {key: value for key, value in self.env.items() if key not in ('GITHUB_REPOSITORY', 'REPO', 'GH_REPO')}
        done = subprocess.run([sys.executable, '-c', f'import sys; sys.path.insert(0, "."); from tools import {module} as m; print(m.{name})'],
                              cwd=ROOT, capture_output=True, text=True, env=env, check=True)
        return done.stdout.strip()

    def test_every_tool_that_lists_or_searches_asks_for_the_org_repo(self):
        asked = {'canary_promote': 'REPO', 'release_guard': 'REPO', 'main_e2e_state': 'REPO', 'e2e_bisect': 'REPO', 'lab_ci': 'LAB'}
        for module, name in asked.items():
            with self.subTest(tool=module):
                repo = self.repo_of(module, name)
                rows = self.gh_list('issue', 'list', '-R', repo, '--search', 'created:>=2026-10-31', '--json', 'number')
                self.assertEqual(len(rows), 1, f'{module} asks GitHub for {repo}: a search under the old owner reads 0 rows without an error')
                self.assertEqual(self.gh_list('issue', 'list', '-R', 'GarryOne/' + repo.split('/', 1)[1], '--json', 'number'), [], 'positive control: the old owner is blind')


if __name__ == '__main__':
    unittest.main()
