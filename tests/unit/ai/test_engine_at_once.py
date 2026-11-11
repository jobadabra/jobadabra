"""Every step sizes its AI calls from the engine in use, not from Claude Code's 4 (src/ai/engine.py at_once, queued; src/ai/title_triage.py _workers).
Owner, 11 Nov 2026: "we can either use Claude, Either Codex, either Free AI". On Codex's 2 slots the title sort alone could hold both; an API engine
(your key, Free AI) has no shared slots, so leaving half of them free only slowed its titles."""
import unittest
from unittest import mock

from src.ai import engine, title_triage


class Budget:
    def __init__(self, beside):
        self.beside = beside

    def scored_beside(self):
        return self.beside


class EngineAtOnceTest(unittest.TestCase):
    def sizes(self, name):
        env = {'JOBADABRA_AI_ENGINE': name}
        with mock.patch.dict('os.environ', env):
            return engine.at_once(), engine.queued(), title_triage._workers(Budget(True)), title_triage._workers(Budget(False))

    def test_each_engine_gives_its_own_calls_at_once_and_title_workers(self):
        for name, expected in (('cli', (4, True, 2, 4)),      # Claude Code: half of its 4 slots while a scorer runs beside the search
                               ('codex', (2, True, 1, 2)),    # Codex: one of its 2 slots stays free for the scores and the board reads
                               ('api', (4, False, 4, 4)),     # your key or Free AI: no slot queue, the titles keep all their threads
                               ('openai', (4, False, 4, 4))):
            with self.subTest(engine=name):
                self.assertEqual(self.sizes(name), expected)


if __name__ == '__main__':
    unittest.main()
