"""Guard: release — a by-hand Search check run on another tier (the search's own steps on mid, or another judge) never writes a night, floors, the reference
or a red: without it one mid-tier run would replace the week's small-tier record. Owner, 11 Nov 2026: "Did we decide if Luna is a too weak model for Find jobs ?"."""
import re
import unittest
from pathlib import Path

WORKFLOW = Path(__file__).resolve().parents[3] / '.github' / 'workflows' / 'search-personas.yml'
NIGHT = "(inputs.chain || 'codex,claude') == 'codex,claude'"


class ByHandTierNeverNight(unittest.TestCase):
    def test_every_night_condition_needs_the_small_search_and_judge_tiers(self):
        lines = [line for line in WORKFLOW.read_text(encoding='utf-8').splitlines() if NIGHT in line]
        self.assertGreaterEqual(len(lines), 9, 'the locked-series conditions moved: count them again')
        for line in lines:
            self.assertIn("(inputs.search_tier || 'small') == 'small'", line, line.strip()[:120])
            self.assertIn("(inputs.judge_tier || 'small') == 'small'", line, line.strip()[:120])

    def test_the_night_searches_on_the_small_tier_and_mid_only_by_hand(self):
        text = WORKFLOW.read_text(encoding='utf-8')
        override = re.search(r'^  JOBADABRA_MODEL_OVERRIDE: (.+)$', text, re.M).group(1)
        self.assertEqual(override.strip(), "${{ (inputs.search_tier || 'small') == 'mid' && 'claude-sonnet-5-5' || 'claude-haiku-5-5' }}")


if __name__ == '__main__':
    unittest.main()
