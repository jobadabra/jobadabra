"""The engine process ends by its deadline, whatever call is still running (lanes 1/5, issue #3740; design: docs/superpowers/specs/2026-11-10-find-jobs-finish-line.md WP8).
Why (sf, 10-11 Nov 2026): the search ended at 135 s, but Python's exit joined every pool worker (concurrent/futures/thread.py _python_exit), so a scoring call
still in flight held the process to 158 s (a thread dump of p5's night recording) or to the app's 175 s stop on CI (exit 143), and the employer finder lost
its 45 s. Every place that leaves background work running when the search ends is one case of the same class, so one loop plays them all: each child
process starts the product's own pool with a stand-in call that never returns by itself, ends its search as the product does, and must then exit.
Real time is fair here (a real process exit) but kept far from both sides: the deadline is 2 s, the call never returns, and the bound is 15 s."""
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
EXIT_BOUND_S = 15   # a hang guard: a child that ends its search exits in well under a second; one held by a call is held for ever
GUARD_S = 60   # how long a child may take to reach its search's end (imports, the clock's 2 s): a hang guard only

PRELUDE = '''
import sys, threading
sys.path.insert(0, {root!r})
from src import time_budget
ENTERED, NEVER = threading.Event(), threading.Event()

def blocking(*args, **kwargs):
    """A call that never returns by itself: only the end of the process ends it."""
    ENTERED.set()
    NEVER.wait()

time_budget.start(2)
'''

ENDING = '''
assert ENTERED.wait(60), 'positive control: the stand-in call was never entered'
print('IN FLIGHT', flush=True)
{end}
print('SEARCH ENDED', flush=True)
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
}


def _child(start, end):
    return textwrap.dedent(PRELUDE).format(root=str(ROOT)) + textwrap.dedent(start) + textwrap.dedent(ENDING).format(end=end)


class PressEndsTest(unittest.TestCase):
    @unittest.expectedFailure   # Why (lanes 1/5, #3740): red today, the ratchet's mark: lanes 2/5 (calls end on the clock) makes it pass and removes this line
    def test_the_engine_process_ends_by_its_deadline_with_a_call_still_in_flight(self):
        folder = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, folder, True)
        env = {**os.environ, 'JOBADABRA_DATA_DIR': str(folder / 'data'), 'JOBADABRA_CONFIG_DIR': str(folder / 'config'), 'PYTHONUNBUFFERED': '1'}
        (folder / 'data').mkdir()
        shutil.copytree(ROOT / 'tests' / 'fixtures' / 'config', folder / 'config')   # the tests' own search and preferences, never the app's
        logs = {name: folder / f'child-{index}.log' for index, name in enumerate(CASES)}
        children = {name: subprocess.Popen([sys.executable, '-c', _child(start, end)], cwd=folder, env=env, stdout=logs[name].open('w'), stderr=subprocess.STDOUT)
                    for name, (start, end) in CASES.items()}   # side by side: the whole loop waits about one bound, not one per case
        try:
            ends = {name: _search_end(child, logs[name]) for name, child in children.items()}   # each child's own end, noticed in turn (never earlier than it was)
            for name, child in children.items():
                with self.subTest(name):
                    said = logs[name].read_text()
                    self.assertIn('SEARCH ENDED', said, f'positive control: the child reached its search end with the call in flight\n{said[-2000:]}')
                    try:
                        child.wait(max(0.1, EXIT_BOUND_S - (time.monotonic() - ends[name])))
                    except subprocess.TimeoutExpired:
                        self.fail(f'the process still runs {EXIT_BOUND_S} s after its search ended: a call in flight holds it (#3740)')
        finally:
            for child in children.values():
                if child.poll() is None:
                    child.kill()
                child.wait()


def _search_end(child, log):
    """When the child said its search ended (or stopped on its own), read from its log; a hang guard of GUARD_S, never the verdict."""
    began = time.monotonic()
    while time.monotonic() - began < GUARD_S and child.poll() is None and 'SEARCH ENDED' not in log.read_text():
        time.sleep(0.05)
    return time.monotonic()


if __name__ == '__main__':
    unittest.main()
