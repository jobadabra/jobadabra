"""Warm Claude Code processes: started before their question, so a call does not wait for the program to start (owner, 12 Nov 2026).

Why (as, 12 Nov 2026; owner: "To keep warmed up sessions. to avoid startup" · "if no activity at all, we hsould always have 1 session active. if we're getting
more and more calls, we add 2 .. 3... on the fly" · "And then we downscaling when the load fades away"): a search's ~48 calls each spent ~2.4 s of
Claude Code starting (116 s a search, sa's 168 recorded searches): ~0.3 s process start and ~1.4 s of its own start-up fetches before the question is
sent. A process started ahead (`--input-format stream-json`) does that while nobody waits: 1.1-1.8 s question to answer instead of 2.3-3.3 s, the same
input tokens (587-590) and model, on this Mac (scratchpad timings, 12 Nov 2026).

Invariants:
- One process answers ONE question, in its own fresh conversation, then ends: no call ever sees another call's question.
- A process is used only for a call with exactly its command line and environment (the key): same model, system prompt, flags.
- Spares per key: at least 1 for the key asked last, plus one for each call of that key waiting for its process, never more than `cap` spares in all;
  spares beyond the last key's one end after `idle_s` without a call. A spare older than `max_age_s` is replaced, never used.
- A spare that is dead or refuses the question is dropped and the caller asks a fresh process (cli_base.call): an answer is never lost or doubled.
- No orphan: a spare's stdin is held only by this process (close_fds), so when the engine ends, however it ends, the spare reads end-of-input and exits
  (0.8 s measured); `close()` and the exit hook end them sooner. Timer and reader threads are daemons: they never hold the engine's exit.
Guarded by tests/unit/ai/test_warm_claude.py and tests/unit/press/test_press_ends.py; Spare also by tests/unit/ai/test_codex_answer_line.py.
"""
import atexit
import json
import os
import queue
import shutil
import subprocess
import sys
import tempfile
import threading
import time

IDLE_S = 30        # spares beyond the last key's one end after this long without a call
MAX_AGE_S = 600    # a spare this old is replaced, not used (its sign-in or the binary on disk may have changed meanwhile)


class Spare:
    """One started CLI process (a Claude Code spare here; a Codex call in codex_cli.answer_line): its output lines go to `lines` (a daemon thread
    reads them: works on Windows too), its input is written by feed(), end() lets it exit and removes its folder. end(answered=True): the call
    already returned its answer; a non-zero exit or stderr after it is printed as a warning, never dropped (Gitar on #3937): the answer stands."""

    def __init__(self, process, folder, born, tool='Claude Code'):
        self.process, self.folder, self.born, self.tool = process, folder, born, tool
        self.lines = queue.Queue()
        threading.Thread(target=self._read, daemon=True, name='cli-reader').start()

    def _read(self):
        try:
            for line in self.process.stdout:
                self.lines.put(line)
        except (OSError, ValueError):
            pass
        try:   # Why (#3973, 13 Nov 2026): left open, the pipe was closed by the garbage collector with an "unclosed file" warning on stderr, in whichever call ran then
            self.process.stdout.close()
        except (OSError, ValueError):
            pass
        self.lines.put(None)   # end of output

    def feed(self, text):
        """Write its input and close it from a daemon thread, so the caller's deadline runs at once: a process that never reads its input cannot
        hold the caller on a full pipe (a prompt over the pipe's 4-64 KB; Gitar on #3936); killing it ends the write too."""
        def write():
            try:
                self.process.stdin.write(text)
                self.process.stdin.close()
            except (OSError, ValueError):
                pass   # it ended before reading: its output and exit code say why
        threading.Thread(target=write, daemon=True, name='cli-writer').start()

    def alive(self):
        return self.process.poll() is None

    def end(self, answered=False):
        """Close its input (it exits by itself) and remove its folder once it has."""
        said = len(self.stderr()) if answered else 0
        try:
            self.process.stdin.close()
        except OSError:
            pass
        threading.Thread(target=self._reap, args=(answered, said), daemon=True, name='cli-reaper').start()

    def _reap(self, answered=False, said=0):
        try:
            code = self.process.wait(timeout=30)
        except subprocess.TimeoutExpired:
            self.process.kill()
            code = 'killed'
        after = self.stderr()[said:].strip() if answered else ''
        if answered and (code != 0 or after):
            print(f"Warning: {self.tool} closed with exit code {code} after its answer{': ' + after[:500] if after else ''}", file=sys.stderr)
        shutil.rmtree(self.folder, ignore_errors=True)

    def stderr(self):
        try:
            with open(os.path.join(self.folder, 'stderr.txt'), encoding='utf-8', errors='replace') as file:
                return file.read()
        except OSError:
            return ''


def _spawn(args, env):
    """A process for `args`, waiting for its question on stdin, in a folder of its own (its working directory and stderr file)."""
    folder = tempfile.mkdtemp(prefix='jobadabra-claude-warm-')
    with open(os.path.join(folder, 'stderr.txt'), 'w', encoding='utf-8') as errors:
        process = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=errors, text=True, encoding='utf-8',
                                   cwd=folder, env=env, close_fds=True)
    return process, folder


class Warm:
    """The spares of one engine (ClaudeCode keeps one Warm, as it keeps one Slots): asked → taken → answered, scaled by the calls waiting."""

    def __init__(self, cap, spawn=_spawn, idle_s=IDLE_S, max_age_s=MAX_AGE_S, clock=time.monotonic):
        self.cap, self.spawn, self.idle_s, self.max_age_s, self.clock = cap, spawn, idle_s, max_age_s, clock
        self.lock = threading.Lock()
        self.spares = {}     # key -> [Spare], oldest first
        self.waiting = {}    # key -> calls asked that have no process yet
        self.recipes = {}    # key -> (args, env) to start one more
        self.last = None     # (key, when) of the last call asked
        self.timer = None
        self.counts = {'asked': 0, 'warm': 0, 'started': 0, 'dropped': 0}
        atexit.register(self.close)

    @staticmethod
    def key(args, env):
        return tuple(args), tuple(sorted(env.items()))

    def asked(self, args, env):
        """A call of this command is coming (before it waits for a slot): start the spares it and the others waiting need. Returns its key."""
        key = self.key(args, env)
        with self.lock:
            self.counts['asked'] += 1
            self.recipes[key] = (list(args), dict(env))
            self.waiting[key] = self.waiting.get(key, 0) + 1
            self.last = (key, self.clock())
            self._top_up(key, self.waiting[key])
        self._arm()
        return key

    def take(self, key):
        """A live, young spare for this key (the call now has its slot), or None: the caller then starts its own process as before."""
        with self.lock:
            if key not in self.recipes:   # never asked: nothing was started for it
                return None
            self.waiting[key] = max(0, self.waiting.get(key, 0) - 1)
            found = None
            mine = self.spares.get(key, [])
            while mine and found is None:
                spare = mine.pop(0)
                if spare.alive() and self.clock() - spare.born < self.max_age_s:
                    found = spare
                else:
                    self.counts['dropped'] += 1
                    spare.end()
            if found is not None:
                self.counts['warm'] += 1
            self._top_up(key, max(1, self.waiting[key]))   # the next call of this key finds one ready ("always 1 session active")
        return found

    def gone(self, key):
        """A call that asked but never took (it failed before its slot): it no longer waits."""
        with self.lock:
            self.waiting[key] = max(0, self.waiting.get(key, 0) - 1)

    def _top_up(self, key, want):
        """Start spares of `key` until it has `want`, within `cap` in all; the least recently asked keys' spares make room first. Under the lock."""
        mine = self.spares.setdefault(key, [])
        while len(mine) < min(want, self.cap):
            if self._total() >= self.cap and not self._evict(key):
                return
            try:
                process, folder = self.spawn(*self.recipes[key])
            except OSError:
                return   # the call starts its own process and says why, as before
            mine.append(Spare(process, folder, self.clock()))
            self.counts['started'] += 1

    def _total(self):
        return sum(len(items) for items in self.spares.values())

    def _evict(self, keep):
        """End the oldest spare of another key; False when only `keep`'s spares are left."""
        others = [(spare.born, key) for key, items in self.spares.items() if key != keep for spare in items]
        if not others:
            return False
        _, key = min(others, key=lambda item: item[0])
        self.spares[key].pop(0).end()
        self.counts['dropped'] += 1
        return True

    def _arm(self):
        """One daemon timer: after `idle_s` without a call, trim to the last key's one spare."""
        with self.lock:
            if self.timer is not None:
                self.timer.cancel()
            self.timer = threading.Timer(self.idle_s, self.trim)
            self.timer.daemon = True
            self.timer.start()

    def trim(self):
        """Down-scale when the load fades: end every spare but one of the last key asked, unless calls came in the last `idle_s`."""
        with self.lock:
            if self.last is None or self.clock() - self.last[1] < self.idle_s:
                return
            keep = self.last[0]
            for key, items in self.spares.items():
                limit = 1 if key == keep else 0
                while len(items) > max(limit, self.waiting.get(key, 0)):
                    items.pop().end()
                    self.counts['dropped'] += 1

    def close(self):
        """End every spare (the engine ends or the run is over)."""
        with self.lock:
            if self.timer is not None:
                self.timer.cancel()
            for items in self.spares.values():
                while items:
                    items.pop().end()

    def ask(self, spare, prompt, timeout):
        """Send the question to a taken spare; (stdout, stderr, returncode) shaped like a finished `claude -p --output-format json`, returned as soon
        as its result line arrives (the process ends by itself after it). None when the spare took no question (dead, or its input closed): the
        caller asks a fresh process instead. Raises subprocess.TimeoutExpired as subprocess.run does (the process is killed)."""
        message = json.dumps({'type': 'user', 'message': {'role': 'user', 'content': prompt}}, ensure_ascii=False)
        spare.feed(message + '\n')   # a spare that took no question (dead, input closed) ends its output unsaid: None below
        until, said = self.clock() + timeout, False
        while True:
            try:
                line = spare.lines.get(timeout=max(0.0, until - self.clock()))
            except queue.Empty:
                spare.process.kill()
                spare.end()
                raise subprocess.TimeoutExpired('claude', timeout) from None
            if line is None:   # the output ended without a result
                spare.end()
                return ('', spare.stderr(), spare.process.wait()) if said else None
            try:
                event = json.loads(line)
            except ValueError:
                continue
            said = said or event.get('type') in ('assistant', 'result')
            if event.get('type') == 'result':
                if event.get('is_error') or str(event.get('subtype', 'success')).startswith('error'):
                    # An error answer is read as the cold call reads it (claude_code.parse, classify): its stderr and exit code, so a plan
                    # limit or a signed-out CLI is told apart the same way; only a good answer returns before the process ends (Gitar on #3931).
                    try:
                        code = spare.process.wait(timeout=max(1.0, until - self.clock()))
                    except subprocess.TimeoutExpired:
                        spare.process.kill()
                        code = spare.process.wait()
                    errors = spare.stderr()   # read before end(): its reaper removes the folder, stderr file included
                    spare.end()
                    return json.dumps(event), errors, code
                errors = spare.stderr()   # what it wrote so far; anything after is said by end(answered=True)
                spare.end(answered=True)
                return json.dumps(event), errors, 0
