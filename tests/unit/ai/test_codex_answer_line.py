"""A Codex call returns at Codex's answer line, not when the process ends (src/ai/providers/codex_cli.py answer_line).
Why (as, 12 Nov 2026; owner: "we should optimize any of the local Claude, local Codex and AI-broker"): `codex exec` exited 1-1.5 s after its
answer line on the owner's plan. A fake `codex` (a Python script run through this Python, any OS) plays each case; nothing here reaches a real Codex.
"""
import io
import json
import os
import subprocess
import sys
import tempfile
import textwrap
import time
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from src.ai.providers import codex_cli  # noqa: E402

# Acts by FAKE_CODEX_MODE; `answer` keeps running after its answer line until RELEASE exists, so a test sees the call return before the end.
FAKE = textwrap.dedent('''
    import json, os, sys, time
    mode, folder = os.environ['FAKE_CODEX_MODE'], os.environ['FAKE_CODEX_DIR']
    if mode == 'crash':
        sys.exit(3)
    if mode == 'deaf':   # never reads its input: a large prompt fills the pipe
        with open(os.path.join(folder, 'seen.json'), 'w') as f:
            json.dump({'pid': os.getpid()}, f)
        time.sleep(3600)
    prompt = sys.stdin.read()
    with open(os.path.join(folder, 'seen.json'), 'w') as f:
        json.dump({'prompt': prompt, 'cwd': os.getcwd(), 'pid': os.getpid()}, f)
    say = lambda item: print(json.dumps(item), flush=True)
    say({'type': 'thread.started', 'thread_id': 't'})
    say({'type': 'turn.started'})
    if mode == 'silent':
        time.sleep(3600)
    if mode == 'limit':
        say({'type': 'turn.failed', 'error': {'message': 'You have hit your usage limit'}})
        sys.stderr.write('usage limit reached')
        sys.exit(1)
    if mode == 'late':   # stderr before its answer, then a failure while it closes down
        sys.stderr.write('reading config\\n')
        sys.stderr.flush()
    say({'type': 'item.completed', 'item': {'type': 'agent_message', 'text': 'answer to ' + prompt}})
    say({'type': 'turn.completed', 'usage': {'input_tokens': 9, 'cached_input_tokens': 4, 'output_tokens': 2}})
    while not os.path.exists(os.path.join(folder, 'RELEASE')):
        time.sleep(0.02)
    if mode == 'late':
        sys.stderr.write('telemetry upload failed')
        sys.exit(1)
''')


class AnswerLineTests(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(prefix='codex-line-test-'))
        self.addCleanup(lambda: (self.dir / 'RELEASE').write_text('1'))
        (self.dir / 'fake_codex.py').write_text(FAKE)
        self.call_folder = tempfile.mkdtemp(prefix='codex-call-')

    def run_fake(self, mode, wait=20, prompt='Is SRE an engineering role?'):
        args = [sys.executable, str(self.dir / 'fake_codex.py'), 'exec', '--json', '-C', self.call_folder, '-']
        env = dict(os.environ, FAKE_CODEX_MODE=mode, FAKE_CODEX_DIR=str(self.dir))
        return codex_cli.answer_line(args, prompt, wait, env)

    def seen(self):
        return json.loads((self.dir / 'seen.json').read_text())

    def test_the_call_returns_at_the_answer_line_while_codex_still_closes(self):
        out = self.run_fake('answer')
        self.assertEqual(out.returncode, 0)
        self.assertFalse((self.dir / 'RELEASE').exists())   # positive control: the fake was still running when the call returned
        found = codex_cli.events(out.stdout)
        self.assertEqual([item['type'] for item in found], ['thread.started', 'turn.started', 'item.completed', 'turn.completed'])
        self.assertEqual(self.seen()['prompt'], 'Is SRE an engineering role?')   # the question as asked, unchanged
        # Its working directory is a folder of its own, never the call's (the caller removes that one while Codex may still close).
        self.assertNotEqual(os.path.realpath(self.seen()['cwd']), os.path.realpath(self.call_folder))
        data, stop = codex_cli.Codex(binary='codex', log=lambda text: None).parse(out, ['codex', '-m', 'gpt-x'], 0, 1)
        self.assertEqual((data['text'], data['usage']['input_tokens'], stop), ('answer to Is SRE an engineering role?', 9, 'end_turn'))

    def test_the_process_ends_by_itself_after_the_call_and_its_folder_goes(self):
        out = self.run_fake('answer')
        own = Path(self.seen()['cwd'])
        self.assertEqual(out.returncode, 0)
        (self.dir / 'RELEASE').write_text('1')
        deadline = time.monotonic() + 20   # a hang guard only: the fake ends within a tick of RELEASE
        while own.exists() and time.monotonic() < deadline:
            time.sleep(0.05)
        self.assertFalse(own.exists(), 'the run folder outlived its process')

    def test_a_failed_turn_is_read_with_its_stderr_and_exit_code_as_before(self):
        out = self.run_fake('limit')
        self.assertEqual((out.returncode, out.stderr), (1, 'usage limit reached'))
        with self.assertRaises(codex_cli.CliLimitError):
            codex_cli.Codex(binary='codex', log=lambda text: None).parse(out, ['codex'], 0, 1)

    def test_a_crash_before_the_question_is_returned_not_waited_for(self):
        out = self.run_fake('crash')
        self.assertEqual((out.returncode, out.stdout), (3, ''))

    def test_no_answer_within_the_wait_kills_codex_and_times_out(self):
        with self.assertRaises(subprocess.TimeoutExpired):
            self.run_fake('silent', wait=1)
        pid = self.seen()['pid']
        deadline = time.monotonic() + 20   # a hang guard only: the kill lands at once
        while _alive(pid) and time.monotonic() < deadline:
            time.sleep(0.05)
        self.assertFalse(_alive(pid), 'a silent Codex outlived its timeout')


    def test_a_prompt_larger_than_the_pipe_to_a_codex_that_never_reads_still_times_out(self):
        """Gitar on #3936: the prompt was written before the deadline started, so a full pipe held the call for ever."""
        began = time.monotonic()
        with self.assertRaises(subprocess.TimeoutExpired):
            self.run_fake('deaf', wait=1, prompt='x' * 1_000_000)   # far over any pipe buffer (4-64 KB)
        self.assertLess(time.monotonic() - began, 15, 'the call waited past its deadline on a full pipe')
        pid = self.seen()['pid']
        deadline = time.monotonic() + 20   # a hang guard only: the kill lands at once
        while _alive(pid) and time.monotonic() < deadline:
            time.sleep(0.05)
        self.assertFalse(_alive(pid))

    def test_a_failure_after_the_answer_is_printed_never_dropped_and_the_stderr_before_it_stays_on_the_result(self):
        """Gitar on #3937: the answer-line return said stderr '' and dropped what Codex did after its answer. The answer stands (Codex said
        its turn completed); a non-zero exit or stderr while it closes down is printed as a warning."""
        with mock.patch('sys.stderr', new_callable=io.StringIO) as printed:
            out = self.run_fake('late')
            self.assertEqual((out.returncode, out.stderr), (0, 'reading config\n'))
            self.assertEqual(printed.getvalue(), '')   # positive control: nothing said while it still runs
            (self.dir / 'RELEASE').write_text('1')
            deadline = time.monotonic() + 20   # a hang guard only: the reaper prints within a tick of the exit
            while 'after its answer' not in printed.getvalue() and time.monotonic() < deadline:
                time.sleep(0.05)
        self.assertIn('Warning: Codex closed with exit code 1 after its answer: telemetry upload failed', printed.getvalue())


class RunnerTests(unittest.TestCase):
    def test_the_default_runner_returns_at_the_answer_line_and_a_given_runner_runs_as_before(self):
        finished = subprocess.CompletedProcess([], 0, '', '')
        with mock.patch.object(codex_cli, 'answer_line', return_value=finished) as line:
            self.assertIs(codex_cli.Codex(binary='codex').ask(['codex', 'exec'], 'q', '/tmp', 5), finished)
            line.assert_called_once()
            given = mock.Mock(return_value=finished)
            codex_cli.Codex(binary='codex', run=given).ask(['codex', 'exec'], 'q', '/tmp', 5)
            given.assert_called_once()
            line.assert_called_once()   # still once: the given runner never reaches answer_line


def _alive(pid):
    if os.name == 'nt':
        found = subprocess.run(['tasklist', '/FI', f'PID eq {pid}'], capture_output=True, text=True).stdout
        return str(pid) in found
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    try:   # a killed child not yet reaped by its reaper thread reads as a zombie: dead for this test
        return 'Z' not in subprocess.run(['ps', '-o', 'stat=', '-p', str(pid)], capture_output=True, text=True).stdout
    except OSError:
        return True


if __name__ == '__main__':
    unittest.main()
