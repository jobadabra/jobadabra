"""Every pull_request job that holds a secret or the broker's OIDC token skips a bot's fd-ai/ branch.

Why (3 Nov 2026, 7/7 Send to AI review): "Send to AI" opens a draft pull request whose code an AI wrote from a stranger's report. A pull request from a branch of this repository
runs its checks with the repository's secrets, so a job that holds one would hand it to that code before a person has read the diff. The bot's push or opening of an fd-ai/ branch
therefore skips those jobs (a person's later push starts them). A new workflow that holds a secret on a pull_request fails here until its job carries the same `if`, or it is listed
below with the only paths it starts on (none an AI may edit).
"""
import re
import unittest
from pathlib import Path

WORKFLOWS = Path(__file__).resolve().parents[1] / '.github' / 'workflows'
GUARD = "startsWith(github.head_ref, 'fd-ai/') && endsWith(github.actor, '[bot]')"
SECRET = re.compile(r"secrets\.(?!GITHUB_TOKEN)[A-Z_]+|id-token: write|secrets:\s*inherit|create-github-app-token")
# Workflows that start on a pull request only for these paths, none of which the AI's fix may touch (feedback-ai.yml allows src/, desktop/renderer, desktop/lib, desktop/test, tests).
EXCEPTIONS = {
    'key-org-proof.yml': {'.github/workflows/key-org-proof.yml'},
    'extension-store-publish.yml': {'.github/workflows/extension-store-publish.yml', 'tools/webstore-publish.mjs'},
}


def code_of(path):
    return '\n'.join(line for line in path.read_text(encoding='utf-8').split('\n') if not line.lstrip().startswith('#'))


class AiSecretJobs(unittest.TestCase):
    def test_every_pull_request_job_with_a_secret_skips_a_bots_fd_ai_branch(self):
        checked = []
        for path in sorted(WORKFLOWS.glob('*.y*ml')):
            code = code_of(path)
            at = code.find('\njobs:')
            head = code[:at]
            if not re.search(r'\n  pull_request:|\non:.*\bpull_request\b', '\n' + head):
                continue
            if path.name in EXCEPTIONS:
                block = re.search(r'\n  pull_request:(.*?)(?=\n  [a-z_]+:|\Z)', head, re.S)
                paths = set(re.findall(r"^\s*-\s*['\"]([^'\"]+)['\"]", block.group(1) if block else '', re.M))
                self.assertTrue(paths and paths <= EXCEPTIONS[path.name], f'{path.name}: an exception starts on a pull request only for {EXCEPTIONS[path.name]}, not {paths}')
                continue
            wide = bool(SECRET.search(re.sub(r'\non:.*?(?=\n[a-z-]+:)', '\n', head, flags=re.S)))   # workflow-level permissions or env reach every job
            for block in re.split(r'\n(?=  [A-Za-z0-9_-]+:\n)', code[at + 1:])[1:]:
                name = re.match(r'  ([A-Za-z0-9_-]+):', block).group(1)
                if not (wide or SECRET.search(block)):
                    continue
                checked.append(f'{path.name}:{name}')
                condition = re.search(r'\n    if:.*', block)
                self.assertTrue(condition and GUARD in condition.group(0), f'{path.name} job {name} holds a secret or an OIDC token on a pull_request: it must skip a bot\'s fd-ai/ branch (`if: ... !({GUARD})`)')
        for known in ('smoke.yml:smoke', 'search-personas.yml:persona', 'page-cases.yml:report'):
            self.assertIn(known, checked, f'the scan must see {known}')


if __name__ == '__main__':
    unittest.main()
