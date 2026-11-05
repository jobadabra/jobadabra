"""A stopped run says what stopped it: "limit" only for a limit, and the cause lives on the error so every line agrees (#3059).
Why: a Windows tester read "AI limit reached" and "266 job(s) waiting, none scored" for a Claude Code that may only have been signed out."""
import subprocess
import unittest
from unittest import mock

from src import daily_helpers
from src.ai import cost, interview_insights
from src.ai.providers import claude_code, codex_cli, contract
from src.ai.providers.cli_base import CliError, CliLimitError

ENGINES = ((claude_code, claude_code.ClaudeCode, 'Claude Code'), (codex_cli, codex_cli.Codex, 'Codex'))


def never_answers(*args, **kwargs):
    raise subprocess.TimeoutExpired('cli', 1)


def stop_of(adapter):
    """The error that stops this adapter: at once when it can't run, else on the second call in a row with no answer."""
    for _ in range(2):
        try:
            adapter.call(['x'], 'prompt', '.')
        except CliLimitError as error:
            return error
        except CliError:
            continue
    raise AssertionError('the adapter never stopped')


class StopReasonTest(unittest.TestCase):
    def causes(self, module, adapter, tool):
        return {f'{tool} is not signed in': module.classify('not logged in'),
                f'{tool} is not installed': stop_of(adapter(binary='')),
                f'{tool} did not answer': stop_of(adapter(binary='/bin/cli', run=never_answers, timeout=1))}

    def test_every_stop_that_is_no_limit_says_what_it_is_on_every_line(self):
        for module, adapter, tool in ENGINES:
            for words, error in self.causes(module, adapter, tool).items():
                with self.subTest(words=words):
                    self.assertTrue(cost.limit_reached(error), 'the run still stops: every other call would fail the same way')
                    self.assertEqual(cost.stop_line(error), f'AI stopped: {words}')
                    stats = {'pending': 3, 'done': 0, 'limit': cost.limit_kind(error), 'stopped': cost.stopped(error)}
                    self.assertEqual(daily_helpers.left_out(stats, 'scored'), [f'3 job(s) not scored: {words}'])

    def test_a_real_plan_limit_is_still_called_a_limit(self):
        for module, _, tool in ENGINES:
            with self.subTest(tool=tool):
                error = module.classify('usage limit reached')
                self.assertTrue(cost.stop_line(error).startswith('AI limit reached: '))
                self.assertEqual(cost.stopped(error), '')

    def test_a_refused_key_is_no_limit_either(self):
        error = contract.AiLimit('The AI key was refused', final=True)
        error.ai_status = 401
        self.assertTrue(cost.stop_line(error).startswith('AI stopped: '))
        self.assertIn('key was refused', cost.stop_line(error))

    def test_the_paused_insights_line_names_the_cause(self):
        error = claude_code.classify('not logged in')
        with mock.patch.object(interview_insights, 'update', side_effect=error):
            self.assertEqual(interview_insights.after_review({}, None, None), 'Interview insights: paused, Claude Code is not signed in')

    def test_a_switched_engine_starts_clean(self):
        """Hypothesis 1 of #3059: no. A stop is held only by the adapter of that run: nothing is stored, and the next engine has its own count."""
        stopped = claude_code.ClaudeCode(binary='/bin/cli', run=never_answers, timeout=1)
        self.assertEqual(cost.stopped(stop_of(stopped)), 'Claude Code did not answer')
        self.assertEqual(codex_cli.Codex(binary='/bin/cli')._timeouts, 0)
        self.assertEqual(claude_code.ClaudeCode(binary='/bin/cli')._timeouts, 0)


if __name__ == '__main__':
    unittest.main()
