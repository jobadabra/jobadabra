"""Every workflow of this repo that talks to an AI engine has a row in tools/ci-agents.json, so the admin tab "CI Agents" cannot miss an agent.

Guard: data — a new agent that acts by itself (a PR, issues, clicks in the app) would run on the CI without the owner's tab showing it.
Why (3 Nov 2026, owner: "a new tab ... CI Agents ... where we list all the agents on the CI"): the tab reads this registry; this test keeps the registry in step with the workflows.
A workflow that only mentions an engine in passing (a PR check, a billing reader) is listed under notAi with the file name, never silently skipped.
"""
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
REGISTRY = json.loads((ROOT / 'tools' / 'ci-agents.json').read_text())
WORKFLOWS = ROOT / '.github' / 'workflows'
ENGINE = re.compile(r'broker-client|edit-codex|judge-codex|\bcodex\b|FREE_AI|ANTHROPIC|anthropic|claude-code-action|ai-broker', re.I)
TEXT = re.compile(r'^[A-Za-z0-9 ().,/+:_-]{1,60}$')
KINDS_TODAY = {'loop', 'one-shot'}
ENGINES = {'broker', 'api-key', 'free', 'workers-ai', 'plan'}   # plan: the owner's Claude plan token (claude-review-shared.yml, 13 Nov 2026)


def own_files():
    """File names of the registry rows that belong to this repo."""
    rows = REGISTRY['agents'] + REGISTRY['steps']
    return {row['file'] for row in rows if row['repo'] == 'jobadabra'}


class CiAgentsRegistryTest(unittest.TestCase):
    def test_every_workflow_that_mentions_an_ai_engine_has_a_row(self):
        known = own_files() | set(REGISTRY['notAi'])
        missing = [f.name for f in sorted(WORKFLOWS.glob('*.yml')) if ENGINE.search(f.read_text()) and f.name not in known]
        self.assertEqual(missing, [], 'add each to tools/ci-agents.json: agents (acts by itself), steps (the AI answers, the code decides) or notAi (a passing mention)')

    def test_every_row_names_a_workflow_that_exists(self):
        gone = [name for name in sorted(own_files() | set(REGISTRY['notAi'])) if not (WORKFLOWS / name).exists()]
        self.assertEqual(gone, [], 'a row names a workflow that is gone: remove its line')

    def test_a_workflow_has_one_row_only(self):
        files = [row['file'] + '@' + row['repo'] for row in REGISTRY['agents'] + REGISTRY['steps']]
        self.assertEqual(sorted(files), sorted(set(files)))
        self.assertEqual(len({row['id'] for row in REGISTRY['agents']}), len(REGISTRY['agents']))

    def test_an_agent_row_is_complete_and_its_texts_are_safe_for_the_site(self):
        for row in REGISTRY['agents']:
            self.assertEqual(row['id'] + '.yml', row['file'], 'the id is the file name without .yml')
            self.assertIn(row['today'], KINDS_TODAY, row['id'])
            self.assertIn(row['engine'], ENGINES, row['id'])
            for key in ('name', 'starts', 'acts'):
                self.assertRegex(row[key], TEXT, f"{row['id']}.{key}: the site keeps letters, digits, spaces and ().,/+:_- up to 60")
        for row in REGISTRY['steps']:
            self.assertIn(row['engine'], ENGINES, row['file'])
            self.assertRegex(row['name'], TEXT, row['file'])


if __name__ == '__main__':
    unittest.main()
