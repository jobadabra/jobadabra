"""Always on's Test button, the engine's side (src/connection_test.py): each check says what is wrong in plain words, spends at most one tiny AI call on the
user's own key, and never writes a secret's value anywhere (the result file is uploaded as an artifact)."""
import contextlib
import io
import json
import os
import tempfile
import unittest
import urllib.error
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from src import connection_test as selftest


def http_error(code):
    return urllib.error.HTTPError('https://api.notion.com/v1/x', code, 'x', {}, io.BytesIO(b'{}'))


class FakeTracker:
    def __init__(self, fail=None, database_id='db-1'):
        self.calls, self.fail, self.database_id = [], fail or {}, database_id

    def _request(self, method, path, body=None):
        self.calls.append((method, path))
        if path in self.fail:
            raise self.fail[path]
        return {}


class FakeAi:
    def __init__(self, error=None, content=('ok',)):
        self.error, self.content, self.sent = error, content, []
        self.messages = SimpleNamespace(create=self.create)

    def create(self, **kwargs):
        self.sent.append(kwargs)
        if self.error:
            raise self.error
        return SimpleNamespace(content=list(self.content))


class GithubCheck(unittest.TestCase):
    def test_passes_when_the_repository_handed_over_both_secrets(self):
        self.assertTrue(selftest.check_github({'NOTION_TOKEN': 'n', 'NOTION_APPLICATIONS_DB': 'db', 'ANTHROPIC_API_KEY': 'a'})[0])

    def test_names_the_missing_secret_for_the_engine_the_user_chose(self):
        base = {'NOTION_TOKEN': 'n', 'NOTION_APPLICATIONS_DB': 'db', 'ANTHROPIC_API_KEY': 'a'}
        for engine in ('openai', ' OpenAI '):   # providers.choice trims and lower-cases; so does the check
            ok, line = selftest.check_github({**base, 'JOBADABRA_AI_ENGINE': engine})
            self.assertFalse(ok)
            self.assertIn('OPENAI_API_KEY', line)
            self.assertNotIn('NOTION_TOKEN', line)

    def test_names_a_missing_database_id(self):
        ok, line = selftest.check_github({'NOTION_TOKEN': 'n', 'ANTHROPIC_API_KEY': 'a'})
        self.assertFalse(ok)
        self.assertIn('NOTION_APPLICATIONS_DB', line)

    def test_names_every_missing_secret(self):
        self.assertIn('NOTION_TOKEN and no NOTION_APPLICATIONS_DB and no ANTHROPIC_API_KEY', selftest.check_github({})[1])


class NotionCheck(unittest.TestCase):
    def test_reads_the_user_then_the_jobs_database_and_nothing_else(self):
        tracker = FakeTracker()
        self.assertTrue(selftest.check_notion(tracker)[0])
        self.assertEqual(tracker.calls, [('GET', 'users/me'), ('GET', 'databases/db-1')])

    def test_no_token_says_to_connect_notion(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            ok, line = selftest.check_notion()
        self.assertFalse(ok)
        self.assertIn('Connect Notion', line)

    def test_a_refused_token_and_an_unshared_database_say_different_things(self):
        refused = selftest.check_notion(FakeTracker({'users/me': http_error(401)}))[1]
        unshared = selftest.check_notion(FakeTracker({'databases/db-1': http_error(404)}))[1]
        self.assertIn('refused the token', refused)
        self.assertIn('not shared', unshared)

    def test_a_switched_off_notion_is_said_as_such_not_as_a_missing_token(self):
        with mock.patch.dict(os.environ, {'JOBADABRA_DISABLE': 'notion', 'NOTION_TOKEN': 'secret_x'}, clear=True):
            ok, line = selftest.check_notion()
        self.assertFalse(ok)
        self.assertIn('switched off', line)

    def test_an_empty_database_id_is_not_blamed_on_sharing(self):
        tracker = FakeTracker(database_id='')
        ok, line = selftest.check_notion(tracker)
        self.assertFalse(ok)
        self.assertIn('no Notion jobs database set', line)
        self.assertEqual(tracker.calls, [])

    def test_an_unreachable_notion_is_a_failed_check_not_a_crash(self):
        ok, line = selftest.check_notion(FakeTracker({'users/me': OSError('down')}))
        self.assertFalse(ok)
        self.assertIn('could not be reached', line)


KEY = {'ANTHROPIC_API_KEY': 'sk-ant-SECRET-VALUE-123'}


class AiCheck(unittest.TestCase):
    def test_one_tiny_question_on_the_small_model(self):
        client = FakeAi()
        self.assertTrue(selftest.check_ai(client, KEY)[0])
        self.assertEqual(len(client.sent), 1)
        self.assertLessEqual(client.sent[0]['max_tokens'], 1000)   # room for Haiku 5.5 to think (tests/unit/ai/test_haiku_5_5.py), still a fraction of a cent

    def test_a_refused_key_says_401(self):
        ok, line = selftest.check_ai(FakeAi(RuntimeError('Error code: 401 - invalid x-api-key')), KEY)
        self.assertFalse(ok)
        self.assertIn('refused (401)', line)

    def test_any_other_failure_names_only_its_type_never_its_text(self):
        for error in (TimeoutError('slow'), RuntimeError(f'bad request for {KEY["ANTHROPIC_API_KEY"]}')):
            ok, line = selftest.check_ai(FakeAi(error), KEY)
            self.assertFalse(ok)
            self.assertIn(type(error).__name__, line)
            self.assertNotIn('SECRET-VALUE', line)
            self.assertNotIn('slow', line)

    def test_a_missing_key_is_not_called_a_refused_key_and_asks_nothing(self):
        client = FakeAi(RuntimeError('authentication failed'))
        ok, line = selftest.check_ai(client, {})
        self.assertFalse(ok)
        self.assertIn('No AI key reached this run', line)
        self.assertEqual(client.sent, [])

    def test_the_key_of_the_chosen_engine_is_the_one_needed(self):
        client = FakeAi()
        self.assertFalse(selftest.check_ai(client, {**KEY, 'JOBADABRA_AI_ENGINE': 'openai'})[0])
        self.assertTrue(selftest.check_ai(client, {'OPENAI_API_KEY': 'sk-x', 'JOBADABRA_AI_ENGINE': 'openai'})[0])

    def test_an_answer_with_no_text_still_proves_the_key(self):
        self.assertTrue(selftest.check_ai(FakeAi(content=()), KEY)[0])


class MainCommand(unittest.TestCase):
    def run_step(self, step, env, checks):
        out = io.StringIO()
        with tempfile.TemporaryDirectory() as folder, mock.patch.dict(os.environ, env, clear=True), \
                mock.patch.object(selftest, 'RESULT_FILE', Path(folder) / 'selftest.json'), \
                mock.patch.dict(selftest.__dict__, checks), contextlib.redirect_stdout(out):
            code = selftest.main([step])
            return code, out.getvalue(), json.loads((Path(folder) / 'selftest.json').read_text())

    def test_a_failed_step_exits_1_and_is_in_the_result_file(self):
        code, out, data = self.run_step('github', {}, {})
        self.assertEqual(code, 1)
        self.assertFalse(data['steps']['github']['ok'])
        self.assertTrue(out.startswith('❌'))

    def test_the_result_file_and_the_output_never_hold_a_secret_value(self):
        secret = 'sk-ant-SECRET-VALUE-123'
        env = {'NOTION_TOKEN': 'secret_notion_abc', 'NOTION_APPLICATIONS_DB': 'db-1', 'ANTHROPIC_API_KEY': secret}
        original = selftest.check_ai
        leaky = {'check_ai': lambda: original(FakeAi(RuntimeError(f'rejected {secret}')), env)}
        for step, checks in (('github', {}), ('ai', leaky)):
            code, out, data = self.run_step(step, env, checks)
            self.assertEqual(code, 0 if step == 'github' else 1)
            for text in (out, json.dumps(data)):
                self.assertNotIn(secret, text)
                self.assertNotIn('secret_notion_abc', text)

    def test_an_unknown_step_is_refused(self):
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(selftest.main(['search']), 2)


if __name__ == '__main__':
    unittest.main()
