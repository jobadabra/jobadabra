"""Which tests a change can break: the local push check and a PR's `Unit / desktop (Linux)` job run only these; main runs everything. For every other PR job GitHub's `paths:` decides (tests/tooling/ci/test_workflow_paths.py).

  python3 tools/affected-tests.py --base origin/main            (JSON on stdout: per area a list of test files, or "all")
  python3 tools/affected-tests.py --files src/store.py desktop/lib/x.js
Output keys: per area its tests or "all"; `reasons`; `commands.<area>` (always a command you can run, only for an area with a picked list); `ci_only.<area>` (an area picked
whole: a sentence with the reason; run nothing locally for it, CI runs it).

A test is selected when (1) its transitive imports reach a changed file, (2) its text names a changed file (path, file name or a
Python dotted name: covers fs reads, subprocess calls and fixtures), or (3) it scans the whole tree (always run). The e2e harness's own tests (desktop/e2e/test) are an area too ("e2e"); their reach also
comes from desktop/e2e/lib/test-reach.mjs (new URL(...) folder reads, "// Reaches:" lines), through tools/e2e-test-reach.mjs. A change nothing
maps (dependency files, config, unknown top-level paths, an unreadable source) selects "all" for that area: when in doubt, run it.
"""
import argparse
import ast
import functools
import importlib.util
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKIP = {'node_modules', '.git', '.claude', 'dist', 'build', '__pycache__', '.venv', 'shared'}
JS_EXT = ('.js', '.mjs', '.cjs')
IMPORT_RE = re.compile(r"""(?:require\(\s*|\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)['"](\.[^'"]*)['"]""")
# Why (4 Nov 2026, PR time 2/2): rename-guard runs tools/rename-inventory.mjs as a process; its reach and its text name nothing, and it was the only test the picker missed in 40 red PR runs.
SCANNER_RE = re.compile(r'''readdirSync|globSync|git ls-files|git ls-tree|['"]ls-(?:files|tree)['"]|(?:execFile|exec|spawn)(?:Sync)?\([^\n]*['"]tools/''')   # the last: execFileSync('git', ['ls-files', ...]) (15 Oct 2026)
# Why (7 Nov 2026, owner: "We should test only the touched parts"; ts 2/2): the one boolean above meant "reads the whole tree" for 219 unit tests that read one named folder through a helper (desktop/test/toast-scan.js
# reads renderer/ by fs, which the import graph cannot see), so a 2-file change under desktop/e2e picked 341 desktop tests. Desktop tests now have two kinds of reader (docs/superpowers/specs/2026-11-07-pr-tests-touched-only.md).
SAFETY_GUARD_RE = re.compile(r'Guard:\s*(?:safety|data|money|privacy|release)\b')   # a guard that says it keeps safety, data, money, privacy or the release verdict is picked for every desktop change
TOOLING_EXTRA = ('desktop/test/tooling/',)   # what the repo's own tooling tests are about (tools/app-tests.py TOOLING, plus their own folder)
ENGINE_RE = re.compile(r'python|(?:^|[^A-Za-z])src[/.]')
NODE_AREAS = {'desktop': 'desktop/test', 'worker': 'app-core/test', 'e2e': 'desktop/e2e/test', 'integration': 'desktop/integration'}   # e2e: the harness's; integration: the app, extension and store layers own tests (c27, 1 Nov 2026)
AREAS = ('python', 'desktop', 'worker', 'e2e', 'integration')
# Why (c27, 1 Nov 2026, owner "Yes, via affected-tests"): ~70 harness tests scan every suite (the folders desktop/, extension/, app-core/) (ratchets, step lists, guards); #2767 found them one CI round at a time (4 rounds).
# They are picked as scanners only for a change the harness can read (the app, the extension, the Worker, the workflows); a Python-only edit picks them by reach or mention alone.
E2E_SCAN_FOR = ('desktop/', 'extension/', 'app-core/', '.github/')
PREFIX = {'worker': 'app-core/', 'e2e': 'desktop/e2e/', 'integration': 'desktop/integration/'}   # the folder a picked test path is printed relative to (default: the area name + '/')
# Why (4 Nov 2026, PR time 2/2; Windows workflow added 5 Nov 2026, owner "Yes: reached tests, every PR"): what runs the desktop tests themselves, on Linux and on Windows, and the picker's own three files (tools/affected-tests.py, tools/affected_readers.py since 7 Nov 2026, ts 3/3; tools/affected_reach.py since 7 Nov 2026, ts 8/8); a change here can break any test without reaching it.
DESKTOP_RUNNER = re.compile(r'^(desktop/test/no-live-site\.mjs|desktop/test/reporter-by-file\.mjs|desktop/scripts/stage\.mjs|tools/check\.(py|sh)|tools/affected-tests\.py|tools/affected_readers\.py|tools/affected_reach\.py|tools/data-readers\.mjs|desktop/e2e/lib/data-reads\.mjs|\.github/workflows/tests-desktop(-windows)?\.yml)$')   # -windows: 5 Nov 2026, the Windows job runs the picked tests too
ALL_TRIGGERS = re.compile(r'(^|/)(package(-lock)?\.json|requirements[^/]*\.txt|pyproject\.toml|eslint\.config\.mjs)$|^\.github/workflows/build\.yml$')
# A dependency file inside one JS area (desktop/e2e/package.json) makes THAT area run whole; the other areas still pick by imports and mentions (11 Oct 2026: 1 of 150 commits, the e2e
# harness's package.json, ran Python and worker whole for nothing). A root-level file (package.json, requirements, pyproject) still runs everything.
SCOPED_DEPS = re.compile(r'^(desktop|app-core|worker)/(.+/)?package(-lock)?\.json$')
NO_TEST_EFFECT = re.compile(r'\.md$|^docs/|^LICENSE|\.gitignore$')
KNOWN = ('src/', 'tests/', 'tools/', 'config/', 'templates/', 'desktop/', 'extension/', 'app-core/', 'worker/', '.github/', 'docs/', '.gitattributes')   # .gitattributes: the tests that name it (test_ship, merge-baseline) are picked by mention


@functools.lru_cache(maxsize=None)
def desktop_job_paths():
    """[(negated, compiled pattern)] of tests-desktop.yml's `paths:`, in order. Why (4 Nov 2026, Gitar on PR time 2/2): that list names files outside desktop/ that the tests read; a PR changing only one started the job and picked no test."""
    text = (ROOT / '.github/workflows/tests-desktop.yml').read_text(encoding='utf-8').split('\npermissions:')[0]
    glob = lambda p: re.compile('.*'.join('[^/]*'.join(re.escape(part) for part in piece.split('*')) for piece in p.split('**')) + '$')
    return [(p.startswith('!'), glob(p.lstrip('!'))) for p in re.findall(r"^ {6}- '([^']+)'", text, re.M)]


def starts_desktop_job(f):
    """Does a change to this file start the desktop job? The last pattern that matches decides, as on GitHub."""
    verdict = False
    for negated, pattern in desktop_job_paths():
        if pattern.match(f):
            verdict = not negated
    return verdict


def walk(suffixes):
    out = []
    for p in ROOT.rglob('*'):
        if p.is_file() and p.suffix in suffixes and not (set(p.relative_to(ROOT).parts) & SKIP):
            out.append(p)
    return out


def read(p):
    try:
        return p.read_text(errors='replace')
    except OSError:
        return ''


@functools.lru_cache(maxsize=None)   # a path's repo-relative name never changes (95k calls in the picks test, 7 s)
def rel(p):
    return p.relative_to(ROOT).as_posix()


def _load(name, file):
    """A sibling tool by file path (tools/*.py are not a package; tools/check.py loads them the same way)."""
    spec = importlib.util.spec_from_file_location(name, ROOT / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


readers = _load('affected_readers', 'tools/affected_readers.py')
reach_tools = _load('affected_reach', 'tools/affected_reach.py')   # the import closure and its per-graph memo (a pure move, 500-line rule)
closure, by_graph, reach_of = reach_tools.closure, reach_tools.by_graph, reach_tools.reach_of


@functools.lru_cache(maxsize=None)
def tooling_roots():
    """What the repo's own tooling tests are about: tools/app-tests.py owns the list (Gitar on ts 3/3: one source of truth), plus the tooling tests' own folder. Loaded on first use, because app-tests loads this file."""
    return (*_load('app_tests', 'tools/app-tests.py').TOOLING, *TOOLING_EXTRA)


text_of = functools.lru_cache(maxsize=None)(read)   # a helper is read once per process, not once per importing test


# --- Where tests live (TESTS.md is the same map for people) ---------------------------------------------------------------------------
# Why (3 Nov 2026, owner chose "B: same names per home": "a clear folder structure with: unit tests, integrations tests, e2e tests... guards", "properly structured by
# type/intent/scope"): tests/ and desktop/test/ each hold unit/, guards/ and tooling/, split by scope below; the flat files left at the top move there in their own PRs.
TEST_KINDS = ('unit', 'guards', 'tooling')


def python_tests():
    """Every Python test file: tests/test_*.py (until moved) and tests/<kind>/**/test_*.py."""
    found = list((ROOT / 'tests').glob('test_*.py'))
    for kind in TEST_KINDS:
        found += (ROOT / 'tests' / kind).rglob('test_*.py')
    return sorted(found)


def desktop_tests():
    """Every desktop unit-suite file: desktop/test/*.test.js (until moved) and desktop/test/<kind>/**/*.test.js."""
    base = ROOT / 'desktop/test'
    found = list(base.glob('*.test.js'))
    for kind in TEST_KINDS:
        found += (base / kind).rglob('*.test.js')
    return sorted(found)


# --- Python import graph -------------------------------------------------------------------------------------------------------------
def py_module_name(p):
    r = p.relative_to(ROOT)
    parts = list(r.with_suffix('').parts)
    if parts[0] == 'tests':        # tests/ is on sys.path as a top-level folder
        parts = parts[1:]
    if parts and parts[-1] == '__init__':
        parts = parts[:-1]
    return '.'.join(parts)



@functools.lru_cache(maxsize=None)   # one parse of the tree per process: select() is called 13x by its tests (21 s -> 9 s); the tree does not change during a run
def py_graph():
    files = [p for p in walk({'.py'}) if p.relative_to(ROOT).parts[0] in ('src', 'tests', 'tools')]
    names = {py_module_name(p): p for p in files}
    edges = {}
    for p in files:
        deps = set()
        try:
            tree = ast.parse(read(p))
        except SyntaxError:
            edges[p] = None        # unreadable: the caller treats it as "reaches everything"
            continue
        me = py_module_name(p).split('.')
        pkg = me if p.name == '__init__.py' else me[:-1]
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                targets = [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom):
                base = '.'.join(pkg[:len(pkg) - node.level + 1]) if node.level else ''
                mod = '.'.join(x for x in (base, node.module or '') if x)
                targets = [mod] + [f'{mod}.{a.name}'.lstrip('.') for a in node.names]
            else:
                continue
            for t in targets:
                parts = t.split('.')
                for i in range(1, len(parts) + 1):     # a.b.c reaches a, a.b and a.b.c
                    if '.'.join(parts[:i]) in names:
                        deps.add(names['.'.join(parts[:i])])
        edges[p] = deps
    return edges


@functools.lru_cache(maxsize=None)   # called once per file a test reaches (85k times with the e2e area: 10 of 12 s); a path's answer never changes
def is_tree_reader(f):
    """A module a guard test imports to read the repo (scripts/, tools/, test helpers). App code under lib/ scans the user's data folders, not the repo."""
    parts = f.relative_to(ROOT).parts if f.is_relative_to(ROOT) else ()
    return bool(parts) and ('scripts' in parts or 'tools' in parts or 'test' in parts or 'e2e' in parts)


# --- JavaScript import graph ---------------------------------------------------------------------------------------------------------
def resolve_js(base, spec):
    target = (base.parent / spec).resolve()
    for cand in [target] + [Path(str(target) + e) for e in JS_EXT] + [target / f'index{e}' for e in JS_EXT]:
        if cand.is_file():
            return cand
    return None


@functools.lru_cache(maxsize=None)
def js_graph():
    files = walk(set(JS_EXT))
    edges = {}
    for p in files:
        edges[p.resolve()] = {r for spec in IMPORT_RE.findall(read(p)) if (r := resolve_js(p, spec))}
    return edges


# --- selection -----------------------------------------------------------------------------------------------------------------------
WORKFLOW_DIR_RE = re.compile(r"\.github['\"]?\s*[/,]\s*['\"]?workflows")   # a test that scans the workflows folder (path or pathlib pieces) without naming a file


def mentions(text, changed, py_names):
    """Does the test's text name a changed file: its path, its file name (6+ characters), or its Python dotted name?"""
    if WORKFLOW_DIR_RE.search(text) and any(f.startswith('.github/workflows/') for f in changed):
        return True
    for f in changed:
        base = Path(f).name
        dotted = py_names.get(f)
        if f in text or (len(base) >= 6 and base in text) or (dotted and dotted in text):
            return True
    return False


@functools.lru_cache(maxsize=None)
def e2e_reach():
    """{harness test path: [repo paths it reaches; a folder read ends with '/']} from the harness's own parser; {} when node or the helper is missing (the Python import graph still applies);
    None when the helper is there and fails (a syntax error in test-reach.mjs): the caller picks the whole e2e area, as for any unreadable source (Gitar on #2774)."""
    helper, node = ROOT / 'tools/e2e-test-reach.mjs', shutil.which('node')
    if not node or not helper.is_file():
        return {}
    out = subprocess.run([node, str(helper)], cwd=ROOT, capture_output=True, text=True, check=False)
    try:
        return json.loads(out.stdout) if out.returncode == 0 else None
    except ValueError:
        return None


_DATA_READS = {}   # changed file -> the code files that read it ([] for a code file or a file nothing names)


def data_readers(changed):
    """{changed data file: [code files that read it at run time]} from desktop/e2e/lib/data-reads.mjs, through tools/data-readers.mjs; {} without node or the helper;
    None when the helper fails: the caller then runs everything, as for any change it cannot map.
    Why (2 Nov 2026, betas 16 and 17; owner chose "e2e + integration"): docs/notion-profile-template.md, read by desktop/lib/strategy.js into the wizard's AI ask, picked no test."""
    helper, node = ROOT / 'tools/data-readers.mjs', shutil.which('node')
    if not node or not helper.is_file():
        return {}
    todo = [f for f in dict.fromkeys(changed) if f not in _DATA_READS]   # Why (ts 8/8): the helper answers each file on its own, so one asked before is not asked again (a node process per select() call: 11 s in the picks test)
    if todo:
        out = subprocess.run([node, str(helper), *todo], cwd=ROOT, capture_output=True, text=True, check=False)
        try:
            found = json.loads(out.stdout) if out.returncode == 0 else None
        except ValueError:
            found = None
        if found is None:
            return None
        _DATA_READS.update({f: found.get(f, []) for f in todo})
    return {f: _DATA_READS[f] for f in changed if _DATA_READS[f]}


def reaches_changed(paths, changed):
    """Does a test's reach hold a changed file, or a folder it reads whole (a trailing '/') that holds one?"""
    folders = [p for p in paths if p.endswith('/')]
    return any(f in paths or any(f.startswith(d) for d in folders) for f in changed)


# Why (5 Nov 2026, #3257; owner-visible: a screen test red on main only): a test that runs a repo script (spawnSync(..., ['scripts/shot.mjs', ...])) reaches what the script imports and what it launches only
# at run time, so the import graph stopped at the spawn: #3257 changed renderer files and apply-ui-state.test.js, which starts the app through shot.mjs, was never picked. One rule for the class: the closure of
# every repo script a test (or a module it imports) spawns counts as the test's reach; a script that starts the Electron app reaches the app (its entry's imports plus the folders it loads at run time).
SPAWN_RE = re.compile(r'spawn|execFile|execSync|fork\(')
SCRIPT_RE = re.compile(r"""['"`]((?:desktop/)?(?:scripts|tools)/[\w./-]+\.(?:m?js|cjs))['"`]""")
APP_LAUNCH_RE = re.compile(r'\.bin\W+electron|_electron\.launch')
APP_ENTRY, APP_FOLDERS = 'desktop/start.js', ('desktop/renderer/', 'desktop/demo/', 'desktop/assets/')   # html/css/data the window loads by path, not by import


@functools.lru_cache(maxsize=None)
def spawned_scripts(f):
    """The repo scripts a JS file starts as a process: a path literal under scripts/ or tools/ in a file that spawns something (relative to the repo or to desktop/, as the cwd of the spawn is)."""
    text = read(f)
    if not SPAWN_RE.search(text):
        return ()
    found = {c.resolve() for m in SCRIPT_RE.findall(text) for c in (ROOT / m, ROOT / 'desktop' / m) if c.is_file()}
    return tuple(sorted(found))


@functools.lru_cache(maxsize=None)
def script_reach(script):
    """(every file the script imports, does it start the Electron app) for one spawned script."""
    files = closure(script, js_graph()) or {script}
    return frozenset(files), any(APP_LAUNCH_RE.search(read(g)) for g in files)


def touches_app(changed):
    """Does a change belong to the running app: a file its entry imports, or one in the folders it loads by path?"""
    graph = js_graph()
    app = by_graph('app', APP_ENTRY, graph, lambda: {rel(g) for g in closure((ROOT / APP_ENTRY).resolve(), graph) or () if g.is_relative_to(ROOT)})
    return any(f in app or f.startswith(APP_FOLDERS) for f in changed)


def driven_reach(reach):
    """(files reached through scripts this test's reach spawns, does one of them start the app)."""
    files, launches = set(), False
    for f in reach:
        for script in spawned_scripts(f):
            got, app = script_reach(script)
            files |= got
            launches = launches or app
    return files, launches


@functools.lru_cache(maxsize=None)
def scans_tree(f):
    """Does this file's text scan the tree (a guard may scan through a module it imports, 10 Oct 2026)? A file's text does not change during a run."""
    return bool(SCANNER_RE.search(read(f)))


def static_facts(area, t, graph):
    """What one test file is, whatever changed: (text, repo-relative name, import reach, scans the tree, text plus its tree-reading helpers (desktop), files reached through spawned scripts, starts the app).
    Why (7 Nov 2026, ts 8/8, owner: "is 4 minutes expected?"): select() rebuilt this for ~345 desktop tests on every call (2.2 s a call, 77 calls in tests/guards/rules/test_pr_desktop_picks.py = 167 s); a call now only compares it with the changed files."""
    def make():
        text, reach = read(t), reach_of(t.resolve(), graph)
        # e2e: not through desktop/e2e/lib (254 of 411 tests import a lib that lists a runtime folder: artifacts, logs, traces; c27, 1 Nov 2026); a lib that reads the repo is caught by reach
        via = [f for f in reach if is_tree_reader(f) and not (area == 'e2e' and '/e2e/lib/' in f.as_posix())]
        scanner = bool(SCANNER_RE.search(text)) or any(scans_tree(f) for f in via)
        body = '\n'.join([text, *(text_of(f) for f in via)]) if area == 'desktop' else ''
        return (text, rel(t), reach, scanner, body, *(driven_reach(reach) if area != 'e2e' else (set(), False)))
    return by_graph(area, t, graph, make)


def pick_node_area(area, folder, relevant, graph, engine_changed, words=()):
    """The test files of one node area a change can break (paths relative to the area), or 'all' when the e2e reach helper is there and fails."""
    changed_js = {(ROOT / f).resolve() for f in relevant}
    # Why (R2, 1 Nov 2026, owner: "whatever e2e suite we'd feel to run on a PR, we should run the integrations counterpart"): the integration layer is the PR-time counterpart of the e2e journeys, in three
    # sub-folders (app, extension, store); it is picked by the same reach, mention and scanner rules as the unit tests, not by a second picker.
    pattern = '**/*.test.*' if area == 'integration' else '*.test.*'
    tests = desktop_tests() if area == 'desktop' else sorted((ROOT / folder).glob(pattern)) if (ROOT / folder).is_dir() else []
    if area == 'e2e':   # Why (c27, 1 Nov 2026, area folders): the harness tests sit one folder down (test/<area>/x.test.mjs); test/fixtures holds stand-ins, never tests
        tests += sorted(t for t in (ROOT / folder).glob('*/*.test.*') if t.parent.name != 'fixtures')
    reached = e2e_reach() if area == 'e2e' else {}
    if reached is None:
        return 'all'
    scan_ok = any(f.startswith(E2E_SCAN_FOR) for f in relevant) if area == 'e2e' else area != 'integration'   # an integration test is never a whole-tree guard: only reach and mention pick it
    app_changed = area != 'e2e' and touches_app(relevant)   # e2e: its own reach parser decides
    tooling_changed = any(f.startswith(tooling_roots()) for f in relevant)
    picked = []
    for t in tests:
        text, name, reach, scanner, body, driven, launches = static_facts(area, t, graph)
        if area == 'desktop':   # two kinds of reader (ts 3/3): a tree walker is picked for any change (one of our own tooling tests only for a tooling change), a folder reader when a changed file sits under a folder its text (or a helper's) names
            scanner = readers.desktop_reader(name, text, body, relevant, tooling_changed)
        if (area == 'desktop' and '/guards/' in name and SAFETY_GUARD_RE.search(text[:1500])) or (reach & changed_js) or (driven & changed_js) or (launches and app_changed) or mentions(text, [*relevant, *words], {}) or (scanner and scan_ok) \
                or reaches_changed(reached.get(name, ()), relevant) \
                or (area == 'desktop' and engine_changed and ENGINE_RE.search(text)) \
                or (area == 'integration' and engine_changed and '/integration/store/' in name):   # the store layer runs the real Python engine
            picked.append(name[len(PREFIX.get(area, area + '/')):])
    return picked


def pick_python(py_changed, result, why):
    """The Python tests the changed Python-area files can break, into result['python'] (a pure move out of select, clean-code gate, 2 Nov 2026): by import
    reach and mention; 'all' for a non-code input the engine reads, or for an engine file no test reaches."""
    edges = py_graph()
    changed_paths = {ROOT / f for f in py_changed}
    non_py_src = [f for f in py_changed if not f.endswith('.py') and f.startswith(('src/', 'config/', 'templates/'))]
    if non_py_src:
        result['python'] = 'all'; why['python'] = f'non-code input read by the engine: {non_py_src[0]}'
        return
    names = {f: py_module_name(ROOT / f) for f in py_changed if f.endswith('.py')}
    picked = []
    for t in python_tests():
        reach = reach_of(t, edges)
        if reach is None or reach & changed_paths or mentions(text_of(t), py_changed, names):
            picked.append(py_module_name(t))
    result['python'] = picked
    orphans = [f for f in names if f.startswith('src/') and not any(
        (ROOT / f) in (reach_of(t, edges) or {ROOT / f}) for t in python_tests())]
    if orphans and not picked:   # an engine file no test reaches: nothing could fail, so run the lot rather than nothing
        result['python'] = 'all'; why['python'] = f'no test reaches {orphans[0]}'


def select(changed, base_ref=None):
    changed = sorted(set(changed))
    result = {'python': [], 'desktop': [], 'worker': [], 'e2e': [], 'integration': [], 'reasons': {}}
    why = result['reasons']
    if not changed:
        return result
    # A data file the app or the engine reads by path (docs, config, JSON) counts as its readers changed: their tests run (lib/data-reads.mjs).
    data_found = data_readers(changed)
    if data_found is None:
        why['all'] = ['tools/data-readers.mjs failed']
        return {**{k: 'all' for k in AREAS}, 'reasons': why}
    if data_found:
        why['data'] = data_found
        changed = sorted(set(changed) | {reader for found in data_found.values() for reader in found})
    # A doc or fixture outside desktop/ on the job's `paths:` is there because a desktop test reads it, so it counts.
    relevant = [f for f in changed if not NO_TEST_EFFECT.search(f) or (starts_desktop_job(f) and not f.startswith(('desktop/', 'extension/')))]
    if not relevant:
        return result
    # Why (7 Nov 2026, ts 4/4): a package.json whose dependencies did not change picks like any file, plus the tests that name a script it changed (6+ characters, as for file names); only a dependency change runs all.
    manifests = {f: readers.package_json_change(f, base_ref, ROOT) for f in relevant if Path(f).name == 'package.json'}
    plain = {f for f, (deps, _) in manifests.items() if not deps}
    words = {name for f in plain for name in manifests[f][1] if len(name) >= 6}
    scoped = [f for f in relevant if SCOPED_DEPS.match(f) and f not in plain]
    everything = [f for f in relevant if f not in plain and ((ALL_TRIGGERS.search(f) and f not in scoped) or f in ('tests/suite_ids.py', 'tests/suite_store_guard.py'))]
    areas = {'python': (lambda f: f.startswith(('src/', 'tests/', 'tools/', 'config/', 'templates/', '.github/workflows/')) or f == '.gitattributes'),
             'desktop': (lambda f: f.startswith(('desktop/', 'extension/')) or f == '.gitattributes'),
             'worker': (lambda f: f.startswith(('app-core/', 'extension/'))),
             'e2e': (lambda f: True),   # any file may be read by a harness test: reach and mention decide
             'integration': (lambda f: f.startswith(('desktop/', 'extension/')))}
    unknown = [f for f in relevant if f not in plain and not f.startswith(KNOWN) and not starts_desktop_job(f)]
    if everything or unknown:
        why['all'] = everything + unknown
        return {**{k: 'all' for k in AREAS}, 'reasons': why}

    # Python
    py_changed = [f for f in relevant if areas['python'](f)]
    if py_changed:
        pick_python(py_changed, result, why)
    # Node areas
    graph = None
    # An engine edit (src/) or a fixture/helper under tests/ (a desktop test may read it) counts; an edit to a Python test file itself (tests/test_*.py) cannot change what the app does (11 Oct 2026: it started ~130 desktop tests).
    engine_changed = any(f.startswith('src/') or (f.startswith('tests/') and not re.fullmatch(r'tests/(?:[^/]+/)*test_[^/]+\.py', f)) for f in relevant)
    for area, folder in NODE_AREAS.items():
        if not any(areas[area](f) for f in relevant) and not (area in ('desktop', 'integration') and engine_changed) and not (area == 'desktop' and any(starts_desktop_job(f) for f in relevant)):
            continue
        graph = graph or js_graph()
        picked = pick_node_area(area, folder, relevant, graph, engine_changed, words)
        result[area] = picked
        if picked == 'all':
            why[area] = 'tools/e2e-test-reach.mjs failed'
    runner = [f for f in relevant if DESKTOP_RUNNER.match(f)]
    if runner:
        result['desktop'] = 'all'; why['desktop'] = f'test runner: {runner[0]}'
    for f in scoped:
        area = 'worker' if f.startswith('app-core/') else f.split('/')[0]   # Why (1 Nov 2026): the area key `worker` is kept, its folder is app-core/
        result[area] = 'all'; why[area] = f'dependency file: {f}'
        if f.startswith('desktop/e2e/'):
            result['e2e'] = 'all'; why['e2e'] = f'dependency file: {f}'
    return result


def commands(result):
    """A ready command per area that has picked tests (run from the repo root); an area picked whole is left to CI, so it gets none."""
    out = {}
    for area, picked in result.items():
        if area not in AREAS or not picked or picked == 'all':   # the other keys (reasons, ci_only) are not areas
            continue
        files = ' '.join(picked)
        out[area] = {'python': f'python3 tools/py-shards.py {files}',
                     'desktop': f'cd desktop && node --test {files}',
                     'worker': f'cd app-core && node --test {files}',
                     'e2e': f'cd desktop/e2e && node --import ./test/stdout-to-stderr.mjs --test {files}',
                     'integration': f'cd desktop && node --import ./test/no-live-site.mjs --test {" ".join("integration/" + name for name in picked)}'}[area]
    return out


def with_ci_only(result):
    """`result` plus "ci_only": {area: sentence} for every area picked whole. Such an area has no `commands` entry on purpose (never a whole suite or a hand-built list locally);
    this says so in words, with the reason, so a session does not guess (a8, 1 Nov 2026, #2766 and #2763)."""
    why = result.get('reasons', {})
    out = {}
    for area in AREAS:
        if result.get(area) != 'all':
            continue
        reason = why.get(area) or why.get('all') or 'in doubt'
        reason = '; '.join(reason) if isinstance(reason, list) else reason
        out[area] = f'picked whole ({reason}): CI runs every {area} test; run nothing for this area here'
    return {**result, 'ci_only': out}


def git_changed(base):
    for spec in (f'{base}...HEAD', f'{base}..HEAD'):
        out = subprocess.run(['git', 'diff', '--name-only', spec], cwd=ROOT, capture_output=True, text=True)
        if out.returncode == 0:
            return [l for l in out.stdout.splitlines() if l]
    return None


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--base', help='compare HEAD with this ref (merge base)')
    ap.add_argument('--files', nargs='*', help='changed files, instead of git')
    args = ap.parse_args(argv)
    changed = args.files if args.files is not None else git_changed(args.base or 'origin/main')
    if changed is None:       # no way to know what changed: everything
        print(json.dumps(with_ci_only({**{k: 'all' for k in AREAS}, 'reasons': {'all': ['git diff failed']}})))
        return 0
    picked = select(changed, args.base or 'origin/main')
    picked = with_ci_only(picked)
    print(json.dumps({**picked, 'commands': commands(picked)}))
    return 0


if __name__ == '__main__':
    sys.exit(main())
