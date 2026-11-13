"""Claude Code processes started ahead (src/ai/providers/warm.py): a call takes one, answers once, falls back to its own process, and none outlives the engine.
Why (as, 12 Nov 2026; owner: "To keep warmed up sessions. to avoid startup" · "if no activity at all, we hsould always have 1 session active. if we're getting
more and more calls, we add 2 .. 3... on the fly" · "And then we downscaling when the load fades away"): each call spent ~2.4 s starting Claude Code.
A fake `claude` (a Python script) plays each case; the cold path (today's own process) is recorded, never run; nothing here reaches a real Claude Code.
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

from src.ai.providers import claude_code, cli_base, warm  # noqa: E402

# The fake: reads one stream-json line (the question) and acts by FAKE_WARM_MODE. `answer` keeps running after its result until RELEASE exists,
# so a test can see the call return before the process ends.
FAKE = textwrap.dedent('''
    import json, os, sys, time
    mode, folder = os.environ['FAKE_WARM_MODE'], os.environ['FAKE_WARM_DIR']
    with open(os.path.join(folder, f'args-{os.getpid()}.json'), 'w') as f:
        json.dump(sys.argv[1:], f)
    if mode == 'die':
        sys.exit(3)
    if mode == 'eof':   # the orphan case: wait for end of input, then say so
        sys.stdin.read()
        open(os.path.join(folder, 'ended'), 'w').write('eof')
        sys.exit(0)
    print(json.dumps({'type': 'system', 'subtype': 'init'}), flush=True)
    line = sys.stdin.readline()
    with open(os.path.join(folder, f'question-{os.getpid()}.json'), 'w') as f:
        f.write(line)
    if mode == 'mute':
        sys.exit(0)
    if mode == 'silent':   # takes the question, never answers: only a timeout ends the call
        time.sleep(3600)
    if mode == 'limit':   # Claude Code's error answer: the reason on stderr, a non-zero exit
        print(json.dumps({'type': 'result', 'subtype': 'success', 'is_error': True, 'result': '', 'num_turns': 1, 'usage': {}}), flush=True)
        sys.stderr.write("You've hit your usage limit, resets 3am")
        sys.exit(1)
    content = json.loads(line)['message']['content']
    print(json.dumps({'type': 'assistant', 'message': {'content': [{'type': 'text', 'text': 'x'}]}}), flush=True)
    print(json.dumps({'type': 'result', 'subtype': 'success', 'is_error': False, 'result': 'answer to ' + content, 'num_turns': 1,
                      'duration_ms': 900, 'duration_api_ms': 800, 'usage': {'input_tokens': 5, 'output_tokens': 2}}), flush=True)
    while not os.path.exists(os.path.join(folder, 'RELEASE')):
        time.sleep(0.02)
''')

HAIKU = dict(model='claude-haiku-4-5', max_tokens=50, system='Answer with one word.')
FLAGS = {'--tools', '--max-turns', '--permission-mode', '--no-session-persistence', '--strict-mcp-config', '--safe-mode'}


class Fake:
    """The fake script, its folder, and a spawn that starts it in place of `claude` (any OS: run through this Python)."""

    def __init__(self, test, mode):
        self.dir = Path(tempfile.mkdtemp(prefix='warm-test-'))
        test.addCleanup(lambda: (self.dir / 'RELEASE').write_text('1'))
        self.script = self.dir / 'fake_claude.py'
        self.script.write_text(FAKE)
        self.mode, self.processes = mode, []

    def spawn(self, args, env):
        process, folder = warm._spawn([sys.executable, str(self.script), *args[1:]], dict(env, FAKE_WARM_MODE=self.mode, FAKE_WARM_DIR=str(self.dir)))
        self.processes.append(process)
        return process, folder

    def seen(self, kind):
        return [json.loads(path.read_text()) for path in sorted(self.dir.glob(f'{kind}-*.json'))]


class Client:
    """A ClaudeCode on the default runner with its own pool; the cold path (today's own process) is recorded, never started."""

    def __init__(self, test, pool):
        self.cold = []
        patches = [mock.patch.object(claude_code, 'flags', lambda *a: FLAGS),
                   mock.patch.object(cli_base.CliAdapter, 'ask', lambda adapter, *args, **kwargs: self._cold(adapter, *args, **kwargs))]
        for patch in patches:
            patch.start()
            test.addCleanup(patch.stop)
        self.lines = []
        self.client = claude_code.ClaudeCode(binary='claude', log=self.lines.append, warm=pool)
        test.addCleanup(pool.close)

    def _cold(self, adapter, args, prompt, folder, wait, key=None):
        self.cold.append(prompt)
        result = {'type': 'result', 'subtype': 'success', 'result': 'cold answer', 'num_turns': 1, 'duration_api_ms': 800, 'usage': {}}
        return subprocess.CompletedProcess(args, 0, json.dumps(result), '')

    def ask(self, text):
        return self.client.messages.create(**HAIKU, messages=[{'role': 'user', 'content': text}]).content[0].text


class StubProcess:
    """A process stand-in for the scaling tests: alive until its input is closed."""

    def __init__(self):
        self.stdin, self.stdout, self.closed = io.StringIO(), io.StringIO(), False   # an output that says nothing and can be closed, as a pipe
        self.stdin.close = self._close

    def _close(self):
        self.closed = True

    def poll(self):
        return 0 if self.closed else None

    def wait(self, timeout=None):
        return 0

    def kill(self):
        self.closed = True


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


def stub_pool(cap=4, clock=None):
    started = []

    def spawn(args, env):
        started.append(args[0])
        return StubProcess(), tempfile.mkdtemp(prefix='warm-stub-')
    return warm.Warm(cap, spawn=spawn, idle_s=30, clock=clock or Clock()), started


class AnswerTests(unittest.TestCase):
    def test_a_call_takes_the_process_started_ahead_and_returns_at_its_answer(self):
        fake = Fake(self, 'answer')
        pool = warm.Warm(4, spawn=fake.spawn)
        client = Client(self, pool)
        self.assertEqual(client.ask('Say ok.'), 'answer to Say ok.')
        self.assertEqual(client.cold, [], 'answered by the process started ahead, not a new one')
        self.assertTrue(client.lines[-1].endswith('; started ahead)'), client.lines)
        # Returned at its result line: the process that answered still runs (it ends by itself; here when released).
        self.assertIsNone(fake.processes[0].poll(), 'the call waited for the process to exit')
        cold_args = client.client.command(HAIKU['model'], HAIKU['system'])
        self.assertEqual(fake.seen('args')[0], claude_code.warm_args(cold_args)[1:], 'the same model, system prompt and flags; only stream-json in and out')
        self.assertEqual(fake.seen('question')[0]['message']['content'], 'Say ok.')

    def test_the_question_is_the_cold_calls_prompt_unchanged(self):
        fake = Fake(self, 'answer')
        client = Client(self, warm.Warm(4, spawn=fake.spawn))
        prompt = 'Line one\n\nItem 2: "quoted" ünïcode'
        client.ask(prompt)
        self.assertEqual(fake.seen('question')[0]['message'], {'role': 'user', 'content': prompt})

    def test_the_next_call_of_the_same_kind_finds_one_ready(self):
        fake = Fake(self, 'answer')
        pool = warm.Warm(4, spawn=fake.spawn)
        client = Client(self, pool)
        client.ask('one')
        self.assertEqual(len(pool.spares[next(iter(pool.spares))]), 1, 'always 1 session ready after a call')
        client.ask('two')
        self.assertEqual((pool.counts['asked'], pool.counts['warm'], client.cold), (2, 2, []))


class FallbackTests(unittest.TestCase):
    def test_a_spare_that_died_before_its_question_falls_back_to_a_new_process_once(self):
        fake = Fake(self, 'die')
        pool = warm.Warm(4, spawn=fake.spawn)
        client = Client(self, pool)
        args = client.client.command(HAIKU['model'], HAIKU['system'])
        key = pool.asked(claude_code.warm_args(args), client.client.env(args))   # as the call itself will: its spare starts now
        pool.gone(key)
        for spare in pool.spares[key]:
            spare.process.wait(timeout=30)   # positive control: it is dead before the call
        self.assertEqual(client.ask('Say ok.'), 'cold answer')
        self.assertEqual(client.cold, ['Say ok.'], 'asked once, on a new process')

    def test_a_spare_that_took_the_question_but_said_nothing_falls_back_once(self):
        fake = Fake(self, 'mute')
        client = Client(self, warm.Warm(4, spawn=fake.spawn))
        self.assertEqual(client.ask('Say ok.'), 'cold answer')
        self.assertEqual(client.cold, ['Say ok.'])
        self.assertEqual(len(fake.seen('question')), 1, 'positive control: the spare did take the question')

    def test_an_error_answer_is_read_with_its_stderr_and_exit_code_as_a_cold_call(self):
        """Gitar on #3931: the warm path returned exit 0 and no stderr, so a plan limit could be read as a plain failure."""
        fake = Fake(self, 'limit')
        client = Client(self, warm.Warm(4, spawn=fake.spawn))
        with self.assertRaises(cli_base.CliLimitError) as said:
            client.ask('Say ok.')
        self.assertIn('usage limit', str(said.exception) + said.exception.said)
        self.assertEqual(client.cold, [], 'the error came from the process started ahead, not a second ask')

    def test_a_spare_that_never_answers_is_killed_at_the_timeout(self):
        fake = Fake(self, 'silent')
        client = Client(self, warm.Warm(4, spawn=fake.spawn))
        client.client.timeout = 1   # a real process, a real 1 s limit: the timeout is what is tested
        with self.assertRaises(cli_base.CliError) as said:
            client.ask('Say ok.')
        self.assertIn('did not answer within 1 s', str(said.exception))
        self.assertIsNotNone(fake.processes[0].wait(timeout=30), 'the silent process was killed')
        self.assertEqual(client.cold, [], 'a timeout is not asked again (as a cold call that times out)')

    def test_a_call_that_never_reaches_its_slot_stops_waiting(self):
        """Gitar on #3931: any way out between coming() and take() (not only the deadline) must release the call, or the pool never shrinks."""
        pool, _ = stub_pool()
        client = Client(self, pool)
        with mock.patch.object(type(client.client._slots), '__enter__', side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                client.ask('Say ok.')
        self.assertEqual(sum(pool.waiting.values()), 0)

    def test_a_call_with_other_flags_never_takes_a_spare(self):
        pool, started = stub_pool()
        sonnet = pool.asked(['claude', '--model', 'sonnet'], {})
        haiku = pool.asked(['claude', '--model', 'haiku'], {})
        pool.take(haiku)
        self.assertIsNone(pool.take(pool.key(['claude', '--model', 'opus'], {})))
        self.assertEqual(len(pool.spares[sonnet]), 1, "the sonnet spare waits for a sonnet call")

    def test_a_spare_too_old_is_replaced_not_used(self):
        clock = Clock()
        pool, started = stub_pool(clock=clock)
        key = pool.asked(['claude'], {})
        old = pool.spares[key][0]
        clock.now += warm.MAX_AGE_S + 1
        taken = pool.take(key)
        self.assertIsNot(taken, old)
        self.assertTrue(old.process.closed)


class ScalingTests(unittest.TestCase):
    """The owner's rule: 1 ready when idle, one more per waiting call, back to 1 when the load fades; never more than the cap."""

    def test_one_more_per_waiting_call_up_to_the_cap(self):
        pool, started = stub_pool(cap=4)
        key = pool.key(['claude', '--model', 'haiku'], {})
        for _ in range(6):
            pool.asked(['claude', '--model', 'haiku'], {})
        self.assertEqual(len(pool.spares[key]), 4, '6 calls waiting, 4 at most')
        for _ in range(6):
            pool.take(key)
        self.assertEqual(len(pool.spares[key]), 1, 'all taken: 1 stays ready')

    def test_a_new_kind_makes_room_by_ending_the_oldest_other_spare(self):
        pool, started = stub_pool(cap=2)
        a = pool.asked(['claude', 'a'], {})
        pool.asked(['claude', 'a'], {})
        b = pool.asked(['claude', 'b'], {})
        self.assertEqual((len(pool.spares[a]), len(pool.spares[b])), (1, 1))
        self.assertEqual(sum(len(items) for items in pool.spares.values()), 2)

    def test_down_to_one_when_the_load_fades(self):
        clock = Clock()
        pool, started = stub_pool(cap=4, clock=clock)
        a = pool.asked(['claude', 'a'], {})
        for _ in range(3):
            pool.asked(['claude', 'b'], {})
        b = pool.key(['claude', 'b'], {})
        for _ in range(3):
            pool.take(b)
        pool.take(a)
        pool.trim()
        self.assertEqual(sum(len(items) for items in pool.spares.values()), 2, 'calls came less than idle_s ago: nothing ends')
        clock.now += 31
        pool.trim()
        self.assertEqual({k[0][1]: len(v) for k, v in pool.spares.items()}, {'a': 0, 'b': 1}, 'only the last kind asked keeps its 1')

    def test_the_timer_never_holds_the_engine(self):
        pool, _ = stub_pool()
        pool.asked(['claude'], {})
        self.assertTrue(pool.timer.daemon)
        pool.close()


class OrphanTests(unittest.TestCase):
    def test_a_spare_ends_when_the_engine_is_killed(self):
        """sa (12 Nov 2026): every warm process ends when the search process ends, also on a crash or a kill at the deadline."""
        fake = Fake(self, 'eof')
        child = textwrap.dedent(f'''
            import os, signal, sys
            sys.path.insert(0, {str(ROOT)!r})
            from src.ai.providers import warm
            process, folder = warm._spawn([sys.executable, {str(fake.script)!r}], dict(os.environ, FAKE_WARM_MODE='eof', FAKE_WARM_DIR={str(fake.dir)!r}))
            print('STARTED', process.pid, flush=True)
            os.kill(os.getpid(), signal.SIGKILL) if hasattr(signal, 'SIGKILL') else os._exit(9)
        ''')
        # On Windows there is no SIGKILL: os._exit is the abrupt end there (no exit hooks, no close()), so the pipe closing is still what ends the spare.
        out = subprocess.run([sys.executable, '-c', child], capture_output=True, text=True, timeout=60)
        self.assertIn('STARTED', out.stdout, out.stderr)   # positive control: the spare was started before the kill
        until = time.monotonic() + 30   # a hang guard only: it ends within a second
        while time.monotonic() < until and not (fake.dir / 'ended').exists():
            time.sleep(0.05)
        self.assertTrue((fake.dir / 'ended').exists(), 'the spare kept waiting after its engine was killed')


if __name__ == '__main__':
    unittest.main()


class PipesTests(unittest.TestCase):
    """#3973's red (13 Nov 2026): the reader thread left the process's output pipe open, and Python's "unclosed file" warning for it landed in
    the captured stderr of whichever test ran when the garbage collector did (test_codex_answer_line's positive control)."""

    def test_the_output_pipe_is_closed_when_the_process_has_said_everything(self):
        folder = tempfile.mkdtemp(prefix='jobadabra-warm-test-')
        process = subprocess.Popen([sys.executable, '-c', 'print("one")'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, cwd=folder)
        spare = warm.Spare(process, folder, 0.0)
        self.assertEqual(spare.lines.get(timeout=20), 'one\n')
        self.assertIsNone(spare.lines.get(timeout=20))   # the end of its output: said after the pipe is closed
        self.assertTrue(process.stdout.closed)
        spare.end()
        process.wait(timeout=20)
