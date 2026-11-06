"""A stopped run says what stopped it: "limit" only for a limit, and the cause lives on the error so every line agrees (#3059).
Why: a Windows tester read "AI limit reached" and "266 job(s) waiting, none scored" for a Claude Code that may only have been signed out."""
import contextlib
import io
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from src import daily, daily_helpers, digest, store as job_store
from src.ai import cost, decide, interview_insights, mail, providers, score
from src.ai.providers import claude_code, codex_cli, contract, openai_api
from src.ai.providers.cli_base import CliError, CliLimitError
from tests import mail_fakes
from tests.unit.ai.test_score import FakeClient, seed_jobs

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
        self.assertEqual(contract.reason(error), 'the AI key was refused')

    def test_an_openai_key_refused_with_403_is_no_limit_either(self):
        class Refused(Exception):
            status_code = 403
        self.assertEqual(cost.stop_line(openai_api.error_of(Refused('forbidden'))), 'AI stopped: OpenAI API key was refused')

    def test_the_first_warning_of_a_signed_out_run_says_so(self):
        # feeds, places and triage warn with contract.reason before scoring starts
        self.assertEqual(contract.reason(claude_code.classify('not logged in')), 'Claude Code is not signed in')
        self.assertEqual(contract.reason(claude_code.classify('usage limit reached')), 'the AI limit was reached')

    def test_items_the_ai_left_waiting_name_the_cause(self):
        self.addCleanup(decide.STOPPED.update, why='', key=False, cause='')
        self.addCleanup(decide.WAITING.update, n=0)
        decide.WAITING['n'] = 12
        decide._stop(claude_code.classify('not logged in'))
        self.assertEqual(decide.items_waiting(), 'Claude Code is not signed in: 12 items wait for the next run (Settings → Connections → AI shows what to do)')

    def test_a_gmail_check_of_a_signed_out_engine_never_blames_the_spend_limit(self):
        err = io.StringIO()
        tracker = mail_fakes.FakeTracker([mail_fakes.app('p1', 'Acme', 'SRE')])
        google = mail_fakes.FakeGoogle([mail_fakes.email('m1', 'Your application')])
        with tempfile.TemporaryDirectory() as tmp, contextlib.redirect_stderr(err), mock.patch('src.ai.mail_inbox.classify', side_effect=claude_code.classify('not logged in')), \
                mock.patch('src.ai.mail_calendar.interview_stats', lambda s: {}):
            mail.run(tracker, google, client=mail_fakes.FakeClient([[]]), days=2, send=[].append, calendar=False, now=mail_fakes.NOW, state_path=Path(tmp) / 'state.json', stats={})
        self.assertIn('Mail check: Claude Code is not signed in.', err.getvalue())
        self.assertNotIn('spend limit', err.getvalue())

    def test_a_signed_out_engine_stops_scoring_and_the_run_says_so_not_limit(self):
        class SignedOut(FakeClient):
            def create(self, **params):
                self.requests.append(params)
                raise claude_code.classify('not logged in')
        out = io.StringIO()
        with tempfile.TemporaryDirectory() as tmp, contextlib.redirect_stdout(out):
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                seed_jobs(db, 8)
                candidates, _ = digest.eligible_jobs(db)
                client, stats = SignedOut(), {}
                score.run(db, candidates, 'Profile', 'm', 10, client=client, workers=1, stats=stats)
        self.assertLess(len(client.requests), 8)
        self.assertRegex(out.getvalue(), r'(?m)^AI stopped: Claude Code is not signed in, \d+ job\(s\) left for the next check$')
        self.assertNotIn('AI limit reached', out.getvalue())
        self.assertEqual(daily.left_out(stats, 'scored'), ['8 job(s) not scored: Claude Code is not signed in'])

    def test_the_paused_insights_line_names_the_cause(self):
        error = claude_code.classify('not logged in')
        with mock.patch.object(interview_insights, 'update', side_effect=error):
            self.assertEqual(interview_insights.after_review({}, None, None), 'Interview insights: paused, Claude Code is not signed in')

    def test_a_switched_engine_starts_clean(self):
        """Hypothesis 1 of #3059: no. The real build, one engine stopped, then the switch: a stop lives on that adapter, and build keeps no adapter between calls."""
        first = providers.build({'JOBADABRA_AI_ENGINE': 'cli'})
        first.binary, first.run, first.timeout = '/bin/cli', never_answers, 1
        self.assertEqual(cost.stopped(stop_of(first)), 'Claude Code did not answer')
        switched = providers.build({'JOBADABRA_AI_ENGINE': 'codex'})
        self.assertIsInstance(switched, codex_cli.Codex)
        self.assertEqual(switched._timeouts, 0)
        back = providers.build({'JOBADABRA_AI_ENGINE': 'cli'})
        self.assertIsNot(back, first)
        self.assertEqual(back._timeouts, 0)


if __name__ == '__main__':
    unittest.main()
