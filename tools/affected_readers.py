"""Which desktop tests READ what changed (not import it): whole-tree walkers, readers of a named folder, ratchets, guards over the test files. Split out of tools/affected-tests.py (a pure move, 450-line rule, 7 Nov 2026).
Also tells a package.json change that touches dependencies from one that only edits scripts (ts 4/4). Used only by tools/affected-tests.py; it holds no state and reads git and the changed package.json only."""
import json
import re
import subprocess

TREE_RE = re.compile(r'''globSync|git ls-files|git ls-tree|['"]ls-(?:files|tree)['"]|(?:execFile|exec|spawn)(?:Sync)?\([^\n]*['"]tools/''')   # walks the whole tree: picked for every desktop change

IMPORT_LINE_RE = re.compile(r"""^[ \t]*(?:import\b.*|.*\bfrom\s+['"][^'"\n]+['"].*|.*\brequire\(.*)$""", re.M)


def names_folder(text, changed):
    """Does the text name, as a quoted path piece, a folder a changed file sits in (its first folder, every folder below desktop/test/; the file itself when it sits directly under desktop/)? A folder reader says which folder it reads by naming it.
    Why (7 Nov 2026, the 2nd /code-review of ts 3/3): the first folder alone missed desktop/test/fixtures/cv-shapes/* and main.js (read by name through a helper); import paths ('../lib/x.js') are not reads, so they are left out of the text."""
    names = set()
    for f in changed:
        parts = f.split('/')
        below = parts[1:] if parts[0] == 'desktop' else parts   # desktop/<folder>/... is named by <folder>, as extension/... is by extension
        folders = parts[2:-1] if parts[:2] == ['desktop', 'test'] else below[:1] if len(below) > 1 else []
        names |= set(folders) or {parts[-1]}
    text = IMPORT_LINE_RE.sub('', text)
    return any(re.search(r"""['"`/]""" + re.escape(name) + r"""['"`/]""", text) for name in names)


# Why (7 Nov 2026, the fresh /code-review of ts 3/3, owner: "We should test only the touched parts"): three kinds of reader the folder rule alone dropped. A test that walks down from a root it holds in a variable
# (`readdirSync(dir)` and `isDirectory()`: owner-guard-wiring, legacy-name-literals) names no folder; the ratchets read `git ls-files` for a tree no tooling change touches; a guard over the test files reads them through
# test-files.js or TEST_DIR. Each is picked again below; a new walker with a variable root is picked for every desktop change until it names its folder.
VARIABLE_WALK_RE = re.compile(r'readdirSync\(\s*[A-Za-z_]\w*\s*[,)]')
RATCHETS = ('test/tooling/ci/hardcoded-page-words.test.js', 'test/tooling/ci/unpinned-clock.test.js', 'test/tooling/ci/file-size.test.js')   # nothing else runs them: they keep a rule over the real tree (CLAUDE.md "the ratchets that keep our rules stay")
READS_TESTS_RE = re.compile(r'test-files|TEST_DIR|\\\.test\\\.')   # the helper, its constant, or a filter on `\.test\.js` names


def desktop_reader(name, text, body, relevant, tooling_changed):
    """Is this desktop test a reader of what changed? A whole-tree walk (git ls-files, globSync, a recursive walk from a root in a variable) counts for any change, but a test of our own tooling only for a tooling
    change; a reader of a folder it names counts when a changed file sits there; a ratchet always counts; a guard over the test files counts when a test file changed."""
    tree = bool(TREE_RE.search(body)) or (bool(VARIABLE_WALK_RE.search(text)) and 'isDirectory' in text)
    named = 'readdirSync' in body and names_folder(body, relevant)
    tests_changed = any(f.startswith('desktop/test/') and f.endswith('.test.js') for f in relevant)
    return (tree and (tooling_changed or '/tooling/' not in name)) or named or name.endswith(RATCHETS) or (tests_changed and bool(READS_TESTS_RE.search(body)))


MANIFEST_NOISE = ('scripts', 'version')   # the fields of a package.json that no installed code or test run depends on; any other field (dependencies, overrides, engines, type, main, imports, description: a Python guard reads it...) can change what a test loads
RUNS_THE_TESTS = {'test', 'pretest', 'posttest', 'install', 'preinstall', 'postinstall', 'prepare', 'prestart', 'start'}   # scripts the test run or the install itself goes through: tools/check.py reads `test` for the flags of every picked run


def package_json_change(path, base_ref, root):
    """For one changed package.json: (True, set()) when anything besides its scripts or version changed, or a script the test run itself goes through changed, or when the old or new file cannot be read (when in doubt, run everything); otherwise
    (False, the names of the scripts added, removed or edited). Why (7 Nov 2026, ts 4/4, owner: "windows tests still takes a lot of time"): #3475 added one script line to desktop/package.json and ran all 1068 desktop tests for 4m29s."""
    if not base_ref:
        return True, set()
    try:
        git = lambda *a: subprocess.run(['git', *a], cwd=root, capture_output=True, text=True, encoding='utf-8', check=True).stdout
        old, new = json.loads(git('show', f"{git('merge-base', base_ref, 'HEAD').strip()}:{path}")), json.loads((root / path).read_text(encoding='utf-8'))
        rest = lambda d: {k: v for k, v in d.items() if k not in MANIFEST_NOISE}
        if old == new or rest(old) != rest(new):   # listed as changed but identical to the base: not understood, so run it
            return True, set()
        a, b = old.get('scripts') or {}, new.get('scripts') or {}
        names = {name for name in {*a, *b} if a.get(name) != b.get(name)}
        return (True, set()) if names & RUNS_THE_TESTS else (False, names)
    except (OSError, ValueError, TypeError, AttributeError, subprocess.CalledProcessError):
        return True, set()
