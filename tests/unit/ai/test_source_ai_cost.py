"""The AI that helps find sources counts in the run's AI cost and the monthly budget, and pauses with the other optional AI at 90%."""
import argparse
import contextlib
import io
import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from src import geo, scout  # noqa: E402
from src.ai import budget, cost, decide  # noqa: E402
from src.notion import cron_runs  # noqa: E402


class SourceCostTests(unittest.TestCase):
    def setUp(self):
        cost.SIDE.clear()
        self.addCleanup(cost.SIDE.clear)

    def test_source_calls_add_up_and_count_in_the_runs_total(self):
        usage = SimpleNamespace(input_tokens=1_000_000, output_tokens=0, cache_read_input_tokens=0, cache_creation_input_tokens=0)
        cost.side('claude-haiku-4-5', usage)
        cost.side('claude-haiku-4-5', usage)
        cost.side('claude-haiku-4-5', None)   # a fake model in tests: nothing counted
        self.assertEqual((cost.SIDE['done'], round(cost.SIDE['usd'], 2)), (2, 2.0))
        run = {'score': {'usd': 0.5}, 'sources': dict(cost.SIDE)}
        self.assertEqual(round(cron_runs.total_usd(run), 2), 2.5)

    def test_each_call_is_counted_under_its_topic_and_the_topics_add_up_to_the_run(self):
        """Why (#2915): 'which step spent the 40' could not be read from any log; the AI decide calls line prints at exit, which a stuck-thread leave skips."""
        cost.TOPICS.clear()
        self.addCleanup(cost.TOPICS.clear)
        decide.reset_run()   # a new run: another test file may have left this process's cap spent
        self.addCleanup(decide.reset_run)
        usage = SimpleNamespace(input_tokens=1, output_tokens=0, cache_read_input_tokens=0, cache_creation_input_tokens=0)
        answer = SimpleNamespace(type='text', text='{"0": "yes", "places": []}')
        client = SimpleNamespace(messages=SimpleNamespace(create=lambda **_: SimpleNamespace(usage=usage, stop_reason='end_turn', content=[answer])))
        with tempfile.TemporaryDirectory() as tmp, mock.patch('src.ai.meanings_pack.queue'), mock.patch('src.ai.meanings_pack.first', return_value=None):
            db = sqlite3.connect(Path(tmp) / 'j.sqlite')
            self.addCleanup(db.close)
            decide.decide('job-title-kind', {'a': 'Pilot'}, ('yes', 'no'), 'Task', client=client, db=db)
            decide.decide('job-title-kind', {'b': 'Nurse'}, ('yes', 'no'), 'Task', client=client, db=db)
            geo._ask(client, ['zurich'])
        cost.side('claude-haiku-4-5', usage)
        self.assertEqual(cost.TOPICS, {'job-title-kind': 2, 'geo': 1, 'test_source_ai_cost': 1})
        self.assertEqual(sum(cost.TOPICS.values()), cost.SIDE['done'])

    def test_the_scout_prints_the_topics_with_its_cost_most_spent_first(self):
        with mock.patch.dict(cost.TOPICS, {'geo': 1, 'job-title-kind': 30, 'page_reader': 9}, clear=True):
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                scout.report_ai_cost({'usd': 0.1, 'done': 40})
        self.assertIn('AI calls by topic: job-title-kind 30, page_reader 9, geo 1\n', out.getvalue())

    def test_a_web_search_s_fee_counts_with_its_tokens(self):
        """Anthropic charges $10 per 1,000 web searches on top of the tokens (19 Oct 2026: the board web search's $0.03 was missing from
        the run's cost); a call on a plan stays $0."""
        searched = SimpleNamespace(input_tokens=0, output_tokens=0, cache_read_input_tokens=0, cache_creation_input_tokens=0,
                                   server_tool_use=SimpleNamespace(web_search_requests=3))
        self.assertAlmostEqual(cost.usd('claude-haiku-5-5', searched), 0.03)
        self.assertEqual(cost.usd('claude-haiku-5-5', SimpleNamespace(**{**vars(searched), 'billing': 'subscription'})), 0.0)
        self.assertEqual(cost.usd('claude-haiku-5-5', SimpleNamespace(**{**vars(searched), 'server_tool_use': None})), 0.0)

    def test_every_web_search_caller_reports_its_cost(self):
        root = Path(__file__).resolve().parents[3] / 'src'
        callers = [path for path in root.rglob('*.py') if 'web_search_20250305' in path.read_text()]
        self.assertGreaterEqual(len(callers), 3)
        for path in callers:
            with self.subTest(path=path.name):
                self.assertIn('cost.side(', path.read_text(), 'its fee and tokens must reach the run cost')

    def test_at_the_monthly_pause_source_reading_is_switched_off_too(self):
        args = argparse.Namespace(auto_kit_max=3, score_max=60, enrich_max=200)
        warnings = []
        with mock.patch.dict(os.environ, {'JOBADABRA_DISABLE': 'google_jobs'}):
            budget.apply_caps(args, {'level': 'pause', 'pct': 0.93}, warnings)
            off = os.environ['JOBADABRA_DISABLE'].split(',')
        self.assertEqual(off, ['google_jobs', 'page_reader', 'job_alerts', 'scout_ai'])
        self.assertIn('AI source reading off', warnings[0])
        with mock.patch.dict(os.environ, {'JOBADABRA_DISABLE': ''}):
            self.assertFalse(budget.apply_caps(args, {'level': 'warn', 'pct': 0.75}, []))
            self.assertEqual(os.environ['JOBADABRA_DISABLE'], '')


if __name__ == '__main__':
    unittest.main()
