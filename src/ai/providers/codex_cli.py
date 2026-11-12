"""The `codex` engine: the user's own signed-in Codex CLI (`codex exec`), on their ChatGPT plan. Shared CLI rules: cli_base.py.

One call is one `codex exec --json --ephemeral` in the call's own temp folder, read-only sandbox, the user's config and rules not loaded
(their MCP servers, hooks and plugins stay out; their sign-in is still used), and every tool a text call does not need switched off by
name, from the features this Codex lists (`codex features list`, once per binary), the shell included. The system prompt becomes Codex's
own instructions (model_instructions_file, a file in the call's folder); a schema goes in --output-schema in OpenAI's strict form; images go in -i. A PDF is refused (reads_pdf False): the live
check of 9 Oct 2026 answered a CV question without opening the file, so a PDF reaches Codex only as page images + text. The model is the same tier in OpenAI's family (models.for_family). It drops the API keys the app gives Python,
so Codex runs on the user's own sign-in; never signs in for them. A call returns at Codex's answer line (`turn.completed`); the process
ends by itself in the background (`answer_line`). Guarded by tests/unit/ai/test_ai_providers.py and tests/unit/ai/test_codex_answer_line.py.
"""
import json
import os
import queue
import re
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

from ..slots import Slots
from .cli_base import CliAdapter, CliError, CliLimitError, conversation
from .contract import SUBSCRIPTION, Usage
from .schema import drop_nulls, parse_json, strict
from .warm import Spare

PARALLEL = 2
# Off for every call (when this Codex has them): a text answer needs none of these.
OFF = ('unified_exec', 'browser_use', 'browser_use_external', 'browser_use_full_cdp_access', 'computer_use', 'image_generation',
       'multi_agent', 'multi_agent_v2', 'apps', 'plugins', 'remote_plugin', 'hooks', 'memories', 'goals', 'in_app_browser',
       'realtime_conversation', 'sleep_tool', 'tool_suggest', 'skill_search', 'skill_mcp_dependency_install', 'view_image')
SHELL = 'shell_tool'     # off too: nothing to run
_features = {}

LIMIT = re.compile(r'usage limit|hit your (?:usage )?limit|limit reached|rate.?limit|too many requests|\b429\b|quota', re.I)
SIGNED_OUT = re.compile(r'not logged in|codex login|log ?in again|unauthorized|\b401\b|authentication|token (?:has )?expired|refresh token', re.I)
LIMIT_TEXT = ('Codex: your ChatGPT plan\'s usage limit is reached, so this AI step is paused; try again later, when the limit resets.')
SIGNED_OUT_TEXT = ('Codex is not signed in on this computer: open Terminal, run `codex login` and sign in with your ChatGPT account, '
                   'then try again. Or switch to an OpenAI API key in Settings → Connections → AI.')
NOT_ANSWERING_TEXT = ('Codex did not answer twice in a row (each waited {seconds} s), so this AI step stops instead of waiting for every job. '
                      'Open Terminal, run `codex`, check it answers, then run again. Or switch to an OpenAI API key in Settings → Connections → AI.')
MISSING_TEXT = ('Codex was not found on this computer: install it (developers.openai.com/codex) and sign in with `codex login`, '
                'or switch to an OpenAI API key in Settings → Connections → AI.')
DROP_ENV = ('OPENAI_API_KEY', 'OPENAI_BASE_URL', 'CODEX_API_KEY', 'ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL')
REAL_RUN = subprocess.run   # the default runner; a runner given by a test or a caller is used as it is


def find_binary(env=None, exists=os.path.exists):
    """The user's `codex`: as the app found it (JOBADABRA_CODEX_BIN), else on PATH, else where its installers put it."""
    env = os.environ if env is None else env
    given = env.get('JOBADABRA_CODEX_BIN')
    if given and exists(given):
        return given
    on_path = shutil.which('codex', path=env.get('PATH'))
    if on_path:
        return on_path
    home = Path(env.get('HOME') or Path.home())
    for place in (home / '.local' / 'bin' / 'codex', home / '.npm-global' / 'bin' / 'codex', home / '.codex' / 'bin' / 'codex',
                  Path('/opt/homebrew/bin/codex'), Path('/usr/local/bin/codex')):
        if exists(str(place)):
            return str(place)
    return ''


def cli_env(parent=None):
    """The user's own environment minus the keys the app added for Python's API calls: Codex runs on the user's sign-in."""
    env = dict(os.environ if parent is None else parent)
    for name in DROP_ENV:
        env.pop(name, None)
    return env


def features(binary, run=subprocess.run):
    """The feature names this Codex knows (`codex features list`), once per binary; an unknown name is never passed."""
    if binary not in _features:
        try:
            out = run([binary, 'features', 'list'], capture_output=True, text=True, timeout=30, env=cli_env())
            _features[binary] = {line.split()[0] for line in (out.stdout or '').splitlines() if line.strip()}
        except (OSError, subprocess.SubprocessError, IndexError):
            _features[binary] = set()
    return _features[binary]


def classify(text):
    if SIGNED_OUT.search(text or ''):
        return CliLimitError(SIGNED_OUT_TEXT, stopped='Codex is not signed in')
    if LIMIT.search(text or ''):
        return CliLimitError(LIMIT_TEXT)
    return CliError(f'Codex failed: {(text or "no output").strip()[:300]}')


def answer_line(args, prompt, wait, env, clock=time.monotonic):
    """One `codex exec` call, returned at its answer line (`turn.completed`) as a finished run (stdout so far, '', 0); the process exits by
    itself in the background. A call that ends without that line (a failed turn, a crash) is returned as it ended, with its stderr and exit
    code, so classify() reads it as before. Raises subprocess.TimeoutExpired as subprocess.run does (the process is killed).

    Why (as, 12 Nov 2026; owner: "we should optimize any of the local Claude, local Codex and AI-broker"): on the owner's plan (gpt-6-luna,
    9 calls) `codex exec` reached its answer line at a median 3.49 s and exited at 4.6 s; the 1-1.5 s between is Codex closing down, after
    the answer is complete. A warm `codex app-server` was measured too and is not used: its answer came at 3.46 s (no start-up left to save:
    exec reaches thread.started in ~0.3 s), and it loads the person's own ~/.codex config (+57 input tokens; --ignore-user-config is exec's).
    The process runs in a folder of its own (its stderr file), never the call's folder, which the caller removes while Codex may still be
    closing (Windows refuses to remove a running process's working directory); `-C` keeps Codex's own folder the call's."""
    own = tempfile.mkdtemp(prefix='jobadabra-codex-run-')
    try:
        with open(os.path.join(own, 'stderr.txt'), 'w', encoding='utf-8') as errors:
            process = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=errors, text=True, cwd=own, env=env,
                                       close_fds=True)
    except OSError:
        shutil.rmtree(own, ignore_errors=True)
        raise
    run = Spare(process, own, clock())   # reads its output in a daemon thread; end() lets it exit and removes its folder after
    try:
        process.stdin.write(prompt)
        process.stdin.close()
    except (OSError, ValueError):
        pass   # it ended before reading its question: its output and exit code say why
    lines, until = [], clock() + wait
    while True:
        try:
            line = run.lines.get(timeout=max(0.0, until - clock()))
        except queue.Empty:
            process.kill()
            run.end()
            raise subprocess.TimeoutExpired(args, wait) from None
        if line is None:   # its output ended without an answer line: read as the whole run, as before
            try:
                code = process.wait(timeout=max(1.0, until - clock()))
            except subprocess.TimeoutExpired:
                process.kill()
                code = process.wait()
            errors = run.stderr()   # before end(): its reaper removes the folder, stderr file included
            run.end()
            return subprocess.CompletedProcess(args, code, ''.join(lines), errors)
        lines.append(line)
        if _kind(line) == 'turn.completed':
            run.end()
            return subprocess.CompletedProcess(args, 0, ''.join(lines), '')


def _kind(line):
    try:
        item = json.loads(line)
    except ValueError:
        return ''
    return item.get('type', '') if isinstance(item, dict) else ''


def events(stdout):
    found = []
    for line in (stdout or '').splitlines():
        try:
            item = json.loads(line)
        except ValueError:
            continue
        if isinstance(item, dict):
            found.append(item)
    return found


class Codex(CliAdapter):
    name, family, tool, folder = 'codex', 'openai', 'Codex', 'codex'
    label = 'Codex (your ChatGPT plan)'
    fallback_label = 'your OpenAI API key'
    reads_pdf = False
    missing_text, not_answering_text = MISSING_TEXT, NOT_ANSWERING_TEXT
    _slots = Slots(PARALLEL)

    def __init__(self, binary=None, fallback=None, run=subprocess.run, timeout=None, log=None, models=None):
        super().__init__(binary if binary is not None else find_binary(), fallback=fallback, run=run, timeout=timeout, log=log)
        from .. import models as default_models
        self.models = models or default_models

    def build(self, request, folder, files):
        model, effort = self.models.for_family(request.model, 'openai', request.effort)
        known = features(self.binary, self.run)
        args = [self.binary, 'exec', '--json', '--ephemeral', '--skip-git-repo-check', '-s', 'read-only', '-C', folder,
                '--ignore-user-config', '--ignore-rules', '-m', model]
        for name in OFF + (SHELL,):
            if name in known:
                args += ['--disable', name]
        args += ['-c', f'web_search="{"live" if request.web_search else "disabled"}"']
        if effort:
            args += ['-c', f'model_reasoning_effort="{"high" if effort == "max" else effort}"']
        if request.schema is not None:
            path = Path(folder) / 'answer-schema.json'
            path.write_text(json.dumps(strict(request.schema)))
            args += ['--output-schema', str(path)]
        for name in files:
            args += ['-i', str(Path(folder) / name)]
        prompt = conversation(request, files)
        if request.system:
            # The system prompt as Codex's own instructions (model_instructions_file, a file in this call's folder: never on a command line,
            # where any local process could read it), replacing Codex's coding-agent prompt. 9 Oct 2026: written in front of the user's
            # prompt instead, under Codex's own agent prompt, the Gmail eval read an interview invitation as "Reply received" (14/17;
            # the same model through the API: 16/17).
            instructions = Path(folder) / 'instructions.md'
            instructions.write_text(request.system)
            args += ['-c', f'model_instructions_file={json.dumps(str(instructions))}']
        return args + ['-'], prompt, request.schema is not None

    def env(self, args):
        return cli_env()

    def ask(self, args, prompt, folder, wait, key=None):
        """The call's run, returned at Codex's answer line (answer_line); a runner given by a test or a caller runs the whole process as before."""
        if self.run is not REAL_RUN:
            return super().ask(args, prompt, folder, wait, key)
        return answer_line(args, prompt, wait, self.env(args))

    def parse(self, out, args, queued_s, ran_s):
        found = events(out.stdout)
        failed = [item for item in found if item.get('type') in ('turn.failed', 'error')]
        if not found or failed or out.returncode != 0:
            detail = ' '.join(str((item.get('error') or {}).get('message') or item.get('message') or '') for item in failed)
            raise classify(f'{detail}\n{out.stderr or ""}'.strip() or f'exit code {out.returncode}')
        model = args[args.index('-m') + 1] if '-m' in args else '?'
        self.log(f'Codex {model}: answered in {ran_s:.0f} s{f", waited {queued_s:.0f} s for a free slot" if queued_s >= 1 else ""}')
        messages = [item['item'].get('text', '') for item in found
                    if item.get('type') == 'item.completed' and (item.get('item') or {}).get('type') == 'agent_message']
        usage = next((item.get('usage') for item in reversed(found) if item.get('type') == 'turn.completed'), {}) or {}
        return {'text': messages[-1] if messages else '', 'usage': usage, 'model': model}, 'end_turn'

    def answer(self, data, schema):
        text = data.get('text') or ''
        if schema is None:
            return text
        try:
            return json.dumps(drop_nulls(parse_json(text), schema), ensure_ascii=False)
        except ValueError:
            return text   # the base asks once more, with what was wrong

    def usage(self, data):
        usage = data.get('usage') or {}
        number = lambda key: int(usage.get(key) or 0)
        cached = number('cached_input_tokens')
        return Usage(max(0, number('input_tokens') - cached), number('output_tokens'), cached, 0, SUBSCRIPTION, 'openai', data.get('model', ''))
