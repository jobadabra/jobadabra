"""Which desktop tests READ what changed (not import it): whole-tree walkers, readers of a named folder, ratchets, guards over the test files. Split out of tools/affected-tests.py (a pure move, 450-line rule, 7 Nov 2026).
Used only by tools/affected-tests.py `pick_node_area`; it holds no state and reads no file."""
import re

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
