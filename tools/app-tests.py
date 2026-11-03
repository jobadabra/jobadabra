"""Which unit tests test the repo's own tooling, not what the app ships: the release pipeline's unit legs leave them out (tools/check.py --app-only); guarded by tests/test_app_tests.py.

  python3 tools/app-tests.py python|desktop     (the tests left out, one per line: a Python module name, or a desktop/test path relative to desktop/)

Why (2 Nov 2026, owner: "The harness tests for sure should not be run in the beta pipeline" … "THat's not a blocker or a reliability gate for the release"): beta 0.9.1's
Mac unit leg took 9.6 min, and its slowest tests were the repo's own tooling (ship, the PR watcher, the push hook, the locks, the e2e reliability check). CI · Tests
(build.yml) still runs every test on every push, and a beta builds a commit that passed it.
One rule per language, each from how its tests reach the code (measured on 2 Nov 2026):
- Python: a module is kept when its imports reach the engine (src/): it runs the engine's code. The tooling tests run their script as a process and import
  nothing of it, so "imports tooling" would keep them (it left out 16 modules, 8 s; this rule 233, the slowest five among them). A module that reads src/ or the
  app as text (test_exit_hooks_stderr parses src/ with ast) checks a rule about the code, the same on every OS: it is left out here and runs in CI · Tests.
  "Names a shipped path" would keep it but also test_ship_pr and test_affected_tests (435 s), whose fixtures name src/ files (Gitar on #3009).
- desktop: a file is left out when its imports reach the repo's tooling (TOOLING) and none of what ships. A screen test often loads renderer files as text into
  jsdom and imports nothing, so "imports the app" would drop it (116 files that test screens); when in doubt, a file is kept.
What ships: the app's own files (desktop/package.json build.files), the extension and app-core (staged into desktop/shared/). An import is judged by its path, so
a file the build stages later (desktop/shared/) still counts.
"""
import functools
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location('affected_tests', ROOT / 'tools/affected-tests.py')
graphs = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(graphs)

ENGINE = ('src/',)
# Shipped beside the app's own files: the extension (scripts/stage.mjs copies it into the app) and app-core's code (staged into desktop/shared/app-core).
ALSO_SHIPPED = ('extension/', 'app-core/src/')
# The repo's own tooling: scripts and hooks, the e2e harness and the integration layers' runners, the build scripts, the workflows.
TOOLING = ('tools/', 'desktop/e2e/', 'desktop/integration/', 'desktop/scripts/', '.github/')


@functools.lru_cache(maxsize=None)
def app_files():
    """The repo paths (a folder ends with '/') of the app's own files, read from electron-builder's `files` list in desktop/package.json."""
    listed = json.loads((ROOT / 'desktop/package.json').read_text())['build']['files']
    keep = [f for f in listed if not f.startswith('!') and not f.startswith('node_modules') and not f.endswith('.json')]
    return tuple('desktop/' + f.removesuffix('**') for f in keep)


@functools.lru_cache(maxsize=None)
def python_tooling_tests():
    """Test module names under tests/ whose imports never reach the engine; an unreadable module is kept (when in doubt, run it)."""
    edges = graphs.py_graph()
    out = []
    for test in graphs.python_tests():
        if test.is_relative_to(ROOT / 'tests/tooling'):   # Why (3 Nov 2026, owner: test folders by type/intent/scope): the folder says it; the import rule below is for the files not moved yet
            out.append(graphs.py_module_name(test))
            continue
        if test.parent != ROOT / 'tests':
            continue
        reach = graphs.closure(test, edges)
        if reach is not None and not any(graphs.rel(f).startswith(ENGINE) for f in reach):
            out.append(test.stem)
    return tuple(out)


def _repo_path(path):
    try:
        return path.relative_to(ROOT).as_posix()
    except ValueError:   # a package outside the repo
        return ''


@functools.lru_cache(maxsize=None)   # once per file: a test's imports share most files with the others' (40 s per call without it)
def _touches(path):
    """(ships, tooling) for one JS file: is it, or a path it imports, in what ships / in the tooling? An import counts by its path, resolved or not:
    desktop/shared/ exists only once the build staged it."""
    shipped = app_files() + ALSO_SHIPPED
    paths = {_repo_path(path)} | {_repo_path((path.parent / spec).resolve()) for spec in graphs.IMPORT_RE.findall(graphs.read(path))}
    return any(p.startswith(shipped) for p in paths), any(p.startswith(TOOLING) for p in paths)


@functools.lru_cache(maxsize=None)
def desktop_tooling_tests():
    """desktop/test files (relative to desktop/) whose imports reach the repo's tooling and nothing that ships."""
    edges = graphs.js_graph()
    out = []
    for test in graphs.desktop_tests():
        if test.is_relative_to(ROOT / 'desktop/test/tooling'):   # the folder says it (see python_tooling_tests)
            out.append(test.relative_to(ROOT / 'desktop').as_posix())
            continue
        if test.parent != ROOT / 'desktop/test':
            continue
        marks = [_touches(f) for f in graphs.closure(test.resolve(), edges)]
        if any(tooling for _, tooling in marks) and not any(ships for ships, _ in marks):
            out.append(f'test/{test.name}')
    return tuple(out)


def desktop_glob():
    """The `node --test` patterns of every desktop/test file but the tooling ones: the flat files not moved yet (one extglob) and every kind folder but tooling/.
    Node expands them, so the command stays short: the ~900 kept paths would come close to Windows' 32 KB command line."""
    left = [Path(t).name.removesuffix('.test.js') for t in desktop_tooling_tests() if t.count('/') == 1]
    kinds = ','.join(k for k in graphs.TEST_KINDS if k != 'tooling')
    return [f"test/!({'|'.join(left)}).test.js" if left else 'test/*.test.js', f'test/{{{kinds}}}/**/*.test.js']


def main(argv):
    if argv not in (['python'], ['desktop']):
        print(__doc__, file=sys.stderr)
        return 2
    print('\n'.join(python_tooling_tests() if argv == ['python'] else desktop_tooling_tests()))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
