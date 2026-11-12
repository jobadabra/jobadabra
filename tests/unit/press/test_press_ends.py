"""The engine process ends by its deadline, whatever call is still running (lanes 1/5, issue #3740; design: docs/superpowers/specs/2026-11-10-find-jobs-finish-line.md WP8).
Why (sf, 10-11 Nov 2026): the search ended at 135 s, but a scoring call still in flight held the process to 158 s (a thread dump of p5's night recording)
or to the app's 175 s stop on CI (exit 143), and the employer finder lost its 45 s. The engine's own end, src/run_exit.py `finish` (src/__main__.py), waits
for the open threads until the deadline and then exits without them, but it counted only non-daemon threads: the scorer runs in a daemon thread
(src/daily_search_scoring.py), so the pool it opens (src/ai/score.py) got a daemon worker that `finish` did not see, while Python's exit
(concurrent/futures/thread.py _python_exit) still joined it (lanes 2/5 counts it: src/run_exit.py holding). Every place that leaves background work running when the search ends is one case of the
same class, so one loop plays them all: each child process starts the product's own work with a stand-in call that never returns by itself, ends
its search as the product does, then ends the way the engine does (run_exit.finish) and must exit. Real time is fair here (a real process exit) but
kept far from both sides: the deadline is 2 s, the call never returns, and the bound is 15 s after it."""
import os
import shutil
import subprocess
import sys
import tempfile
import textwrap
import time
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
DEADLINE_S = 2   # the children's search clock (time_budget.start)
EXIT_BOUND_S = 15   # after the deadline: a child that ends as the engine does exits at it; one held by a call is held for ever
GUARD_S = 60   # how long the children may take to say their search ended (imports): a hang guard only, never the verdict

PRELUDE = '''
import sys, threading
sys.path.insert(0, {root!r})
from src import run_exit, time_budget
from src.sources import careers
careers.READER = None   # no AI page reader in a test process (tests/unit/sources/test_found_boards_ai.py)
ENTERED, NEVER = threading.Event(), threading.Event()

def blocking(*args, **kwargs):
    """A call that never returns by itself: only the end of the process ends it."""
    ENTERED.set()
    NEVER.wait()

time_budget.start({deadline})
'''

ENDING = '''
assert ENTERED.wait(60), 'positive control: the stand-in call was never entered'
print('IN FLIGHT', flush=True)
{end}
print('SEARCH ENDED', flush=True)
raise SystemExit(run_exit.finish(0))   # the engine's own end (src/__main__.py)
'''

# name -> (start: the product starts its background work with the stand-in call, end: the product's own end of that work, '' when the search just goes on)
CASES = {
    'the scorer beside the search (src/daily_search_scoring.py _beside, src/ai/score.py run)': ('''
import tempfile
from pathlib import Path
from types import SimpleNamespace
from src import digest, store, daily_search_scoring
from src.ai import score
path = Path(tempfile.mkdtemp()) / 'jobs.sqlite'
with store.connect(path) as db:
    store.import_watch_report(db, {'jobs': [{'company': 'Example', 'id': '1', 'title': 'SRE', 'location': 'Zurich', 'url': 'https://x.test/1',
                                              'description': 'Kubernetes, Terraform, Datadog.'}]})
client = SimpleNamespace(messages=SimpleNamespace(create=blocking))

def work(own_db, own_stores):
    candidates, _ = digest.eligible_jobs(own_db)
    score.run(own_db, candidates, 'Site reliability engineer, ten years of Kubernetes and Terraform, Zurich.', 'm', 1, client=client, workers=1)
finish = daily_search_scoring._beside(str(path), SimpleNamespace(name='memory'), work, threading.Event(), lambda: max(0.0, time_budget.end() - time_budget.now()))
''', 'finish()'),
    'the EURES read started at second 0 (src/sources/eures.py start_early)': ('''
from src.sources import aggregators, eures
aggregators.sources = lambda *args, **kwargs: [('EURES', None)]
aggregators.read_lately = lambda *args, **kwargs: False
eures.eures = blocking
eures.start_early({'roles': ['SRE']})
''', ''),
    'the board web search started at second 0 (src/sources/board_web.py _submit)': ('''
from src.sources import board_web
board_web.search = blocking
board_web._submit({}, {}, None, None)
''', ''),
    "the slice's board proposal (src/first_jobs.py propose_early)": ('''
from src import first_jobs
from src.ai import board_ideas
board_ideas.proven = lambda *args, **kwargs: False
board_ideas.ideas = blocking
first_jobs.propose_early({'roles': ['SRE']})
''', ''),
    "the fixed boards' employer discovery (src/sources/boards_beside.py Beside)": ('''
from src.sources import boards_beside
discovery = boards_beside.Beside(blocking)
''', 'discovery.finish()'),
    'the found boards read ahead (src/sources/boards_ahead.py Ahead)': ('''
from src.sources import boards_ahead
boards_ahead.Ahead({'roles': ['SRE']}, blocking)
''', ''),
    'a Claude Code call answered by a process started ahead (src/ai/providers/warm.py; as, 12 Nov 2026)': ('''
import os
from src.ai.providers import claude_code, warm
NEVER_ANSWERS = 'import sys, time\\nsys.stdin.readline()\\ntime.sleep(3600)'   # takes its question, never answers: only the engine's end ends the call
pool = warm.Warm(2, spawn=lambda args, env: warm._spawn([sys.executable, '-c', NEVER_ANSWERS], env))
asked = pool.ask

def ask(*args, **kwargs):
    ENTERED.set()
    return asked(*args, **kwargs)
pool.ask = ask
claude_code.flags = lambda *args: set()
client = claude_code.ClaudeCode(binary=sys.executable, warm=pool)
threading.Thread(target=lambda: client.messages.create(model='claude-haiku-4-5', max_tokens=10, messages=[{'role': 'user', 'content': 'x'}]),
                 daemon=True).start()
''', ''),
    'a pool with its own thread names, opened in a daemon thread (the shape behind the scorer: src/run_exit.py holding)': ('''
from concurrent.futures import ThreadPoolExecutor

def opener():
    with ThreadPoolExecutor(max_workers=1, thread_name_prefix='lane-reader') as pool:
        pool.submit(blocking)
threading.Thread(target=opener, daemon=True).start()
''', ''),
}


def _child(start, end):
    return textwrap.dedent(PRELUDE).format(root=str(ROOT), deadline=DEADLINE_S) + textwrap.dedent(start) + textwrap.dedent(ENDING).format(end=end)


class PressEndsTest(unittest.TestCase):
    def test_the_engine_process_ends_by_its_deadline_with_a_call_still_in_flight(self):
        folder = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, folder, True)
        env = {**os.environ, 'JOBADABRA_DATA_DIR': str(folder / 'data'), 'JOBADABRA_CONFIG_DIR': str(folder / 'config'), 'PYTHONUNBUFFERED': '1'}
        (folder / 'data').mkdir()
        shutil.copytree(ROOT / 'tests' / 'fixtures' / 'config', folder / 'config')   # the tests' own search and preferences, never the app's
        logs = {name: folder / f'child-{index}.log' for index, name in enumerate(CASES)}
        began = time.monotonic()
        children = {name: subprocess.Popen([sys.executable, '-c', _child(start, end)], cwd=folder, env=env, stdout=logs[name].open('w'), stderr=subprocess.STDOUT)
                    for name, (start, end) in CASES.items()}   # side by side, on one shared clock: the whole loop waits one bound, not one per case
        try:
            _poll(children, lambda: all(child.poll() is not None or 'SEARCH ENDED' in logs[name].read_text() for name, child in children.items()), began + GUARD_S)
            said = {name: logs[name].read_text() for name in children}
            unreached = [f'{name}\n{text[-2000:]}' for name, text in said.items() if 'SEARCH ENDED' not in text]
            self.assertEqual(unreached, [], 'positive control: each child reached its search end with the call in flight')
            _poll(children, lambda: all(child.poll() is not None for child in children.values()), began + DEADLINE_S + EXIT_BOUND_S)
            held = sorted(name for name, child in children.items() if child.poll() is None)
            self.assertEqual(held, [], f'the process still runs {EXIT_BOUND_S} s after its deadline: a call in flight holds it (#3740)')
        finally:
            for child in children.values():
                if child.poll() is None:
                    child.kill()
                child.wait()


def _poll(children, done, until):
    """Wait until `done()` or the monotonic time `until`: one shared hang guard for every child, never a verdict of its own."""
    while time.monotonic() < until and not done():
        time.sleep(0.05)


if __name__ == '__main__':
    unittest.main()
