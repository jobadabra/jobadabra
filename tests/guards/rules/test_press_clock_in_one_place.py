"""A Find jobs run's seconds and counts live in one table, src/press/budget.json (plan docs/superpowers/plans/2026-11-07-the-press.md 3/6;
owner, 7 Nov 2026: "one agent fixes an issue, then comes another agent and tries to improve the speed and mroves that logic"). In 30 days before
it, knobs were added straight into the stage files at least 9 times (boards SHARE_S, boards_first WEB_WAIT, read_budget READ_SECONDS/FLOOR/GRACE
26 Oct; time_budget FEED 27 Oct; eures LAST_PAGE, MOST #3305; KEEP 27 Oct). Fails when a stage file assigns a number at module level that is not
in the table and not one of today's other constants below, or when it reads the wall clock more often than today (the clock moves into
src/press in 4/6). Both allow-lists only shrink: an entry that no longer exists fails too."""
import ast
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
STAGES = ('src/time_budget.py', 'src/sources/read_budget.py', 'src/sources/boards.py', 'src/sources/boards_first.py', 'src/sources/eures.py',
          'src/first_jobs.py', 'src/ai/title_triage.py')
# Numbers that are not a run's seconds or counts (sizes of a request, a fit line, a file's age, a JSON schema's limits, a counter's start).
OTHER = {'src/time_budget.py': {'_local', '_scored'}, 'src/sources/read_budget.py': {'LEFT_DAYS'},
         'src/sources/boards.py': {'PAGE_SIZE', 'MAX_TERMS', 'MAX_REQUESTS', 'QUERIES_SCHEMA'}, 'src/sources/eures.py': {'PAGE_SIZE', 'MAX_PAGES'},
         'src/first_jobs.py': {'FIT'}}
# Wall-clock reads today per stage file (time_budget is the clock itself until 4/6 moves it).
CLOCK_READS = {'src/sources/read_budget.py': 6, 'src/sources/boards.py': 3, 'src/sources/boards_first.py': 0, 'src/sources/eures.py': 6,
               'src/first_jobs.py': 2, 'src/ai/title_triage.py': 2}
CLOCKS = {('time', 'monotonic'), ('time', 'time'), ('time', 'perf_counter'), ('datetime', 'now')}


def _number(node):
    return isinstance(node, ast.Constant) and type(node.value) in (int, float)


def _from_table(node):
    return isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr in ('value', 'group')


def numbers(path):
    """Names a module assigns a value holding a number to at its top level (a literal, a dict or tuple of them, a sum, a negative), unless the
    value is read from the table (budget.value / group). Review of ps 3/6: a bare-literal check let `SHARE = {...}` back in."""
    names = set()
    for node in ast.parse((ROOT / path).read_text(encoding='utf-8')).body:
        targets = node.targets if isinstance(node, ast.Assign) else [node.target] if isinstance(node, ast.AnnAssign) and node.value else []
        if not targets or _from_table(node.value) or not any(_number(n) for n in ast.walk(node.value)):
            continue
        names |= {target.id for target in targets if isinstance(target, ast.Name)}
    return names


def clock_reads(path):
    """Calls of the wall clock in a module's code (comments and strings do not count): time.monotonic(), time.time(), perf_counter, datetime.now."""
    calls = 0
    for node in ast.walk(ast.parse((ROOT / path).read_text(encoding='utf-8'))):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and isinstance(node.func.value, ast.Name):
            calls += (node.func.value.id, node.func.attr) in CLOCKS
    return calls


class ClockInOnePlaceTest(unittest.TestCase):
    def test_no_stage_file_holds_a_seconds_or_count_number_of_its_own(self):
        for path in STAGES:
            with self.subTest(path):
                self.assertEqual(numbers(path) - OTHER.get(path, set()), set(),
                                 'a run\'s second or count goes into src/press/budget.json (a row with why and pr), read with budget.value()')

    def test_the_allow_lists_only_shrink(self):
        for path, names in OTHER.items():
            with self.subTest(path):
                self.assertEqual(names - numbers(path), set(), 'gone from the file: take it off OTHER')
        for path, most in CLOCK_READS.items():
            with self.subTest(path):
                held = clock_reads(path)
                self.assertLessEqual(held, most, 'a new deadline on the wall clock: take it from time_budget (src/press in 4/6)')
                self.assertEqual(held, most, f'{path} reads the clock {held} times now: lower CLOCK_READS to it')


if __name__ == '__main__':
    unittest.main()
