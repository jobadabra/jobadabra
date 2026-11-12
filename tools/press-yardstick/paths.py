"""The src files that start the Find jobs pipeline yardstick (.github/workflows/press-yardstick.yml `on: pull_request: paths:`), derived, never hand-listed
(owner, 10 Nov 2026, asked via AskUserQuestion in session sa: "Every file the search reaches (Recommended)": the yardstick starts on 91 of the last 100 engine
PRs, one job of about 8 minutes; the old hand list started on 40, and missed the files that decide what is kept or read: src/sources/feeds.py, features.py,
aggregators.py, geo.py, places.py). A src file starts it when the Find jobs run can reach it: the import closure of the files that own a stage
(src/press/stages.py TABLE) and the press package, plus the files that call them (`python3 -m src daily`: daily.py, daily_args.py, daily_modes.py, daily_search.py; themselves, not what they import: that also holds the digest and the kit writer). A file the run never imports (the inbox, the stores' Notion pages, the
kit writer's helpers) does not.
  python3 tools/press-yardstick/paths.py           the `paths:` lines for src (`src/**`, then `!src/<file>` for each file the run never reaches)
  python3 tools/press-yardstick/paths.py --check   fails when the workflow's src lines are not exactly those (the workflow's first step, and its guard test)
A new file is in `src/**` at once (an extra run, never a missed one); a new import of a file listed as unreached is an edit to a reached file, which starts
the workflow, which then fails this check with the line to run."""
import importlib.util
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / '.github' / 'workflows' / 'press-yardstick.yml'
CALLERS = ('src/daily.py', 'src/daily_args.py', 'src/daily_modes.py', 'src/daily_search.py')   # the run's entry (desktop/lib/pipeline-args.js `src daily`) and the file that calls the stages in order (stages.py says so): their own edits move the run


def _load(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'tools' / file)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def stage_roots():
    """The files that own a stage: every `src/...py` in src/press/stages.py's TABLE rows, and the press package beside it."""
    spec = importlib.util.spec_from_file_location('press_stages', ROOT / 'src' / 'press' / 'stages.py')
    stages = importlib.util.module_from_spec(spec)
    sys.modules['press_stages'] = stages
    spec.loader.exec_module(stages)
    press = {str(file.relative_to(ROOT)) for file in (ROOT / 'src' / 'press').glob('*.py') if file.name != 'stages.py'}   # the press package is the run's order, clock and budget: all of it
    return sorted({owner for stage in stages.TABLE for owner in stage.owners if owner.endswith('.py')} | press)


def reached():
    """Every src .py file the stages' owners import, directly or not, and the owners themselves (repo-relative): what the Find jobs run can load."""
    affected = _load('affected_tests_for_paths', 'affected-tests.py')
    reach = _load('affected_reach', 'affected_reach.py')
    graph = affected.py_graph()
    found = set(CALLERS) | {'src/press/stages.py'}   # Why (Gitar on #3684, 11 Nov 2026): its TABLE decides the roots above, so an edit to it moves the run and this list
    for root in stage_roots():
        files = reach.closure(ROOT / root, graph)
        if files is None:   # an unreadable file reaches everything: so does the yardstick
            return None
        found |= {str(file.relative_to(ROOT)) for file in files}
    return {file for file in found if file.startswith('src/')}


def entries():
    """The workflow's src `paths:` entries: `src/**`, then `!src/<file>` for each src .py the run never reaches (None = everything is reached)."""
    found = reached()
    every = sorted(str(file.relative_to(ROOT)) for file in (ROOT / 'src').rglob('*.py') if '__pycache__' not in file.parts)
    return ['src/**'] + ([] if found is None else [f'!{file}' for file in every if file not in found])


def listed(workflow=WORKFLOW, trigger='  pull_request:'):
    """The src entries of the workflow's `trigger` paths, as written."""
    text = workflow.read_text(encoding='utf-8')
    start = text.index(trigger)
    block = text[start:text.index('\n  workflow_dispatch:', start)]
    return [found for found in re.findall(r"^\s+- '(!?src/[^']+)'", block, re.M)]


def check():
    """'' when the yardstick workflow lists exactly entries(); else what drifted and the line to run."""
    wanted, out = entries(), []
    for workflow, trigger in ((WORKFLOW, '  pull_request:'),):   # press-tapes-auto.yml starts on the Worker's daily timer since 12 Nov 2026, no paths
        have = listed(workflow, trigger)
        missing, extra = [e for e in wanted if e not in have], [e for e in have if e not in wanted]
        if missing or extra:
            out.append(f"{workflow.name}: its src paths drifted from what the Find jobs run reaches. Missing: {', '.join(missing) or 'none'}. Extra: {', '.join(extra) or 'none'}.")
    return '\n'.join(out + ['Run: python3 tools/press-yardstick/paths.py and put the lines in the paths list (in place of every src/ entry).'] if out else [])


def main(argv):
    if argv == ['--check']:
        drift = check()
        print(drift or f'press-yardstick.yml: its src paths are what the Find jobs run reaches ({len(entries()) - 1} files left out)')
        return 1 if drift else 0
    if argv:
        print(__doc__, file=sys.stderr)
        return 2
    print('\n'.join(f"      - '{entry}'" for entry in entries()))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
