"""Module-level state on the Find jobs search path only shrinks (contract C1 of docs/superpowers/specs/2026-11-10-find-jobs-code-shape.md; owner, 10 Nov
2026: "each session that tries to improve a case, does this wihout worsening/affecting other improvements done previosuly").
Why (cr 1/5, 10 Nov 2026): state a module keeps between calls is shared by every stage and every run in the process, so one session's change reached
another's through it (69 such containers measured on main 87a41364). A run's state belongs on the Run (src/press/run.py), made once and passed down.
State here = a module-level name the module mutates (an item set, append/add/clear/update..., `global`, or a lock/condition/event/thread-local);
a constant table nobody writes is not state. A name on the list may go (then delete its line); a new one fails: put it on the Run instead."""
import ast
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SEARCH_PATH = ('src/press/*.py', 'src/sources/*.py', 'src/ai/*.py', 'src/first_jobs.py', 'src/daily_search*.py', 'src/run_counts.py',
               'src/run_details.py', 'src/read_methods.py', 'src/time_budget.py')
MUTATORS = {'append', 'add', 'clear', 'update', 'pop', 'extend', 'setdefault', 'discard', 'remove', 'insert', 'put', 'popitem', 'appendleft', 'popleft'}
SYNC = {'Lock', 'RLock', 'Condition', 'Event', 'local', 'Semaphore', 'BoundedSemaphore'}

# Measured on main 05c6bfbf (10 Nov 2026). Only shrinks: each line leaves as its state moves onto the Run (sf 3/8, cr 2/5-3/5).
KNOWN = {
    'src/ai/batch_scope.py': {'_WATCHED', '_by_reader', '_frozen', '_local'},
    'src/ai/board_ideas.py': {'STORE'},
    'src/ai/cost.py': {'SIDE', 'TOPICS', 'TOPICS_LOCK'},
    'src/ai/decide.py': {'CACHE_ONLY', 'FAILED', 'SCOPE', 'STOPPED', 'WAITING', '_calls', '_own'},
    'src/ai/insights.py': {'SCHEMA'},
    'src/ai/insights_text.py': {'WEEKLY_SCHEMA'},
    'src/ai/page_reader.py': {'_reads'},
    'src/ai/place_triage.py': {'LOCK'},
    'src/ai/slots.py': {'_local'},
    'src/ai/title_queue.py': {'_cv', '_hub', '_local', '_running'},
    'src/ai/title_triage.py': {'LOCK'},
    'src/first_jobs.py': {'_early'},
    'src/press/resume.py': {'_lock', '_ran', '_said'},
    'src/press/scorer.py': {'_claimed', '_lock', '_shared'},
    'src/press/step_yield.py': {'_landed', '_lock', '_scored', '_spans'},
    'src/read_methods.py': {'_lock', '_state'},
    'src/run_counts.py': {'_lock'},
    'src/run_details.py': {'_boards', '_clock', '_counts', '_steps'},
    'src/sources/aggregators.py': {'TAKEN'},
    'src/sources/ats_conditional.py': {'_asking'},
    'src/sources/board_web.py': {'_early', '_lock', '_searched'},
    'src/sources/careers.py': {'REFUSALS'},
    'src/sources/describe.py': {'_ROUTE'},
    'src/sources/eures.py': {'CUT', 'HELD', 'LOCK', '_early'},
    'src/sources/feeds.py': {'PLACED', 'READ', 'TRIAGED'},
    'src/sources/found_boards.py': {'_early'},
    'src/sources/host_pace.py': {'_lock', '_state'},
    'src/sources/late_reads.py': {'_lock'},
    'src/sources/nuts_names.py': {'LOCK', '_loaded'},
    'src/sources/nuts_points.py': {'_by_name'},
    'src/sources/one_posting.py': {'_asks'},
    'src/sources/read_budget.py': {'_short'},
    'src/sources/render.py': {'_state'},
    'src/sources/visits.py': {'LOCK'},
    'src/sources/web_answers.py': {'_lock'},
    'src/time_budget.py': {'CLOCK'},
}


def module_state(source):
    """The module-level names `source` keeps as state (see the header), sorted."""
    tree = ast.parse(source)
    top = {}
    for node in tree.body:
        targets = node.targets if isinstance(node, ast.Assign) else [node.target] if isinstance(node, ast.AnnAssign) and node.value else []
        top.update({target.id: node.value for target in targets if isinstance(target, ast.Name)})
    found = set()
    for name, value in top.items():
        if isinstance(value, ast.Call):
            func = value.func
            if (func.attr if isinstance(func, ast.Attribute) else getattr(func, 'id', '')) in SYNC:
                found.add(name)
    for node in ast.walk(tree):
        if isinstance(node, ast.Global):
            found.update(name for name in node.names if name in top)
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr in MUTATORS \
                and isinstance(node.func.value, ast.Name) and node.func.value.id in top:
            found.add(node.func.value.id)
        elif isinstance(node, (ast.Assign, ast.AugAssign, ast.Delete)):
            for target in (node.target,) if isinstance(node, ast.AugAssign) else node.targets:
                while isinstance(target, (ast.Subscript, ast.Attribute)):
                    target = target.value
                    if isinstance(target, ast.Name) and target.id in top:
                        found.add(target.id)
    return sorted(found)


class RunStateOnlyShrinksTest(unittest.TestCase):
    def test_the_finder_sees_each_kind_of_state(self):
        source = ('import threading\nA = []\nB = {}\nC = {}\nD = threading.Lock()\nE = [0]\nTABLE = {"k": 1}\n'
                  'def f():\n    global C\n    A.append(1)\n    B["x"] = 1\n    E[0] += 1\n    return TABLE["k"]\n')
        self.assertEqual(module_state(source), ['A', 'B', 'C', 'D', 'E'])   # TABLE is only read: a constant

    def test_no_new_module_state_on_the_search_path(self):
        seen = {}
        for pattern in SEARCH_PATH:
            for path in sorted(ROOT.glob(pattern)):
                names = module_state(path.read_text(encoding='utf-8'))
                if names:
                    seen[path.relative_to(ROOT).as_posix()] = set(names)
        for path in sorted(set(seen) | set(KNOWN)):
            with self.subTest(path):
                new = seen.get(path, set()) - KNOWN.get(path, set())
                gone = KNOWN.get(path, set()) - seen.get(path, set())
                self.assertFalse(new, f'{path}: new module-level state {sorted(new)}; a run\'s state goes on the Run (src/press/run.py), passed down')
                self.assertFalse(gone, f'{path}: {sorted(gone)} is gone, thank you: delete it from KNOWN in {Path(__file__).name} (the list only shrinks)')


if __name__ == '__main__':
    unittest.main()
