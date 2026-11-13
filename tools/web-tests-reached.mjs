#!/usr/bin/env node
// Which jobadabra-web tests read a file a jobadabra PR changes, derived from the web tests' own text (no hand-kept list).
//   git diff --name-only --no-renames origin/main...HEAD | node tools/web-tests-reached.mjs --web <jobadabra-web checkout> --tree <this repo's checkout>
// Prints one test per line, as its path in the joined tree (jobadabra with web laid over it): test/unit/x.test.js, tests/test_site_x.py. Nothing printed = the PR reaches no web test this job can run.
// A test that needs a package outside Node and Python's own libraries (playwright-core, eslint, anthropic) is not printed but named on stderr as "skipped": the PR gate installs nothing (Gitar on #3950).
// Why (13 Nov 2026, owner, asked via AskUserQuestion: "Add the check (Recommended)"; 2 escapes in 30 days): #3684 (10 Nov) and #3939 (12 Nov) changed press-yardstick.yml and turned web's
// test/unit/admin/search/search-night-prs.test.js red on every web PR, found only after the merge. A read is a quoted path, a path.join/`/ 'a' / 'b'` chain or a template prefix in the test or in a
// file it imports; a changed file matches a read of itself or of a folder above it, so a deleted file still matches. Over-picking is cheap (seconds), under-picking is the escape: when in doubt, pick.
// Required check "Web tests that read this PR's files" of .github/workflows/pr-gate.yml. Guard: desktop/test/tooling/ci/web-tests-reached.test.js.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import {builtinModules} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const posix = path.posix;
const CODE = /\.(m?js|cjs)$/;
const WEB_TEST = /^test\/(?:.+\.test\.js|python\/test_site_[^/]+\.py)$/;
const QUOTED = /(['"`])((?:(?!\1)[^\\\n])*)\1/g;
const CALL = /\b(?:join|resolve)\(([^()\n]*)\)/g;   // path.join(root, 'desktop', 'renderer'): the literals in order
const CHAIN = /(?:\/\s*(['"])[^'"\n]+\1\s*){2,}/g;   // python: ROOT / '.github' / 'workflows'
const IMPORT = /(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\(\s*|\bimport\s+)['"](\.[^'"]*)['"]/g;

// layout: tools/layout-map.txt of jobadabra-web, "<path in the web repo> <path in the joined tree>"
const layoutOf = web => {
  const file = path.join(web, 'tools/layout-map.txt');
  return (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n') : []).filter(line => !line.startsWith('#')).map(line => line.trim().split(/\s+/)).filter(parts => parts.length === 2);
};
const swap = (file, pairs, from, to) => {
  const hit = pairs.filter(pair => file === pair[from] || file.startsWith(`${pair[from]}/`)).sort((a, b) => b[from].length - a[from].length)[0];
  return hit ? hit[to] + file.slice(hit[from].length) : file;
};
const listed = (dir, keep, base = dir) => fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
  const file = path.join(dir, entry.name);
  return entry.isDirectory() ? (entry.name === 'node_modules' ? [] : listed(file, keep, base)) : keep(path.relative(base, file).split(path.sep).join('/')) ? [path.relative(base, file).split(path.sep).join('/')] : [];
});

/** The web tests, as their paths in the web repo. */
export const webTests = web => listed(path.join(web, 'test'), file => WEB_TEST.test(`test/${file}`)).map(file => `test/${file}`);

/** Where a file of the joined tree lives on disk, with the extensions an import leaves out: the web checkout first (through its layout map), then this repo's tree; null when absent (a deleted file). */
function locator({web, tree}) {
  const pairs = layoutOf(web), isFile = file => fs.existsSync(file) && fs.statSync(file).isFile();
  return joined => {
    for (const name of [joined, `${joined}.js`, `${joined}.mjs`, `${joined}.cjs`, `${joined}/index.js`]) {
      const inWeb = path.join(web, swap(name, pairs, 1, 0)), inTree = path.join(tree, name);
      if (isFile(inWeb)) return {file: inWeb, own: true};
      if (isFile(inTree)) return {file: inTree, own: false};
    }
    return null;
  };
}

// A literal as a path of the joined tree, or null when it cannot be one. `dir`: the joined folder of the file it is in (for './' and '../').
function asPath(text, dir) {
  let value = text.trim();
  const cut = value.search(/\$\{|\*|\{/);
  if (cut >= 0) value = value.slice(0, value.lastIndexOf('/', cut) + 1);   // `a/${x}` and `a/*.yml` read the folder a/
  if (!/^[\w./@-]+\/?$/.test(value) || value.length > 200) return null;
  const clean = (/^\.\.?\//.test(value) ? posix.normalize(posix.join(dir, value)) : posix.normalize(value)).replace(/^\.\//, '').replace(/\/$/, '');
  return clean.includes('/') && !clean.startsWith('..') ? clean : null;   // one name alone ('src', 'tools') is no read: it would pick every PR
}

// Only files that run or test something in the joined tree name paths they read: the tests, their helpers, the tools and jobs. A page or Worker module that lists paths as data
// (admin/search-night-prs.js SEARCH_PATHS) reads nothing, and counting it picked 111 web tests for one desktop/lib file; what such a module imports still counts.
const READS_FILES = /^(?:test|tests|tools|jobs|desktop\/test)\//;

// A package is named by a real import: a line that starts with import/export ... from a quoted name, or a dynamic import or require call with a quoted name; never prose inside a string. Not a path ('./x', '/x'), not Node's own.
const BARE_STATIC = /^[ \t]*(?:import|export)\b[^'"\n;()]*?\bfrom\s*['"]([^'"\n]+)['"]|^[ \t]*import\s*['"]([^'"\n]+)['"]/gm;
const BARE_CALL = /\b(?:import|require)\(\s*['"]([^'"\n]+)['"]\s*\)/g;
const PACKAGE_NAME = /^(?:@[a-z0-9~-][\w.~-]*\/)?[a-z0-9~-][\w.~-]*(?:\/[\w./-]*)?$/;
const PYTHON_IMPORT = /^\s*(?:import|from)\s+([A-Za-z_]\w*)/gm;
let pythonStdlib;   // sys.stdlib_module_names of the python3 on the PATH; null when there is none (every python import then counts as a package)
const stdlib = () => pythonStdlib ??= (() => { try { return new Set(execFileSync('python3', ['-c', 'import sys; print(*sys.stdlib_module_names)'], {encoding: 'utf8'}).trim().split(/\s+/)); } catch { return null; } })();

/** A reader of the web tests of one checkout. reads(testFile) = the joined-tree paths (files or folders) the test reads: its own literals and path chains, those of the helpers/tools/jobs it
 * imports or names, and the files it imports (a jobadabra file down its own imports). packages(testFile) = the packages outside Node and Python's own libraries that the test, or a file it
 * imports, needs (playwright-core for the browser walks): the PR gate installs none, so such a test is not run there. One scan per file, so all ~400 tests cost about one pass. */
export function reader({web, tree}) {
  const pairs = layoutOf(web), find = locator({web, tree}), scans = new Map();
  const scan = ({file, own}) => {
    if (scans.has(file)) return scans.get(file);
    const joined = own ? swap(path.relative(web, file).split(path.sep).join('/'), pairs, 0, 1) : path.relative(tree, file).split(path.sep).join('/'), dir = posix.dirname(joined);
    const text = fs.readFileSync(file, 'utf8'), found = new Set(), packages = new Set();
    const add = literal => { const hit = asPath(literal, dir); if (hit) found.add(hit); };
    if (own && READS_FILES.test(joined)) {
      for (const [, , literal] of text.matchAll(QUOTED)) add(literal);
      for (const [, args] of text.matchAll(CALL)) { const parts = [...args.matchAll(QUOTED)].map(match => match[2]); if (parts.length > 1) add(parts.join('/')); }
      for (const [chain] of text.matchAll(CHAIN)) add([...chain.matchAll(QUOTED)].map(match => match[2]).join('/'));
    }
    const imports = new Set();
    if (CODE.test(file)) {
      for (const [, spec] of text.matchAll(IMPORT)) { add(spec); const hit = asPath(posix.join(dir, spec), '.'); if (hit) imports.add(hit); }
      for (const match of [...text.matchAll(BARE_STATIC), ...text.matchAll(BARE_CALL)]) {
        const spec = match[1] || match[2];
        if (!PACKAGE_NAME.test(spec) || spec.startsWith('node:') || builtinModules.includes(spec) || builtinModules.includes(spec.split('/')[0])) continue;
        packages.add(spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);
      }
      if (own && /PLAYWRIGHT_CORE/.test(text)) packages.add('playwright-core');   // the browser walks load it by this variable, not by name
    } else if (file.endsWith('.py')) {
      for (const [, name] of text.matchAll(PYTHON_IMPORT)) {
        const local = [path.join(web, 'tools', `${name}.py`), path.join(path.dirname(file), `${name}.py`)].some(candidate => fs.existsSync(candidate));
        if (!local && !(stdlib() || new Set()).has(name)) packages.add(name);
      }
    }
    const code = names => [...names].map(find).filter(next => next && CODE.test(next.file));
    const result = {found, packages, next: code(found), imported: code(imports)};
    scans.set(file, result);
    return result;
  };
  // reads follow every file a test names (a tool it starts, a helper); packages follow only what it imports: a file read as text is not run, so its own imports are not needed.
  const walk = (testFile, edge) => {
    const reads = new Set(), packages = new Set(), seen = new Set(), stack = [{file: testFile, own: true}];
    while (stack.length) {
      const item = stack.pop();
      if (seen.has(item.file)) continue;
      seen.add(item.file);
      const scanned = scan(item);
      for (const hit of scanned.found) reads.add(hit);
      for (const name of scanned.packages) packages.add(name);
      stack.push(...scanned[edge]);
    }
    return {reads, packages};
  };
  return {reads: testFile => walk(testFile, 'next').reads, packages: testFile => walk(testFile, 'imported').packages};
}

/** The joined-tree paths a web test reads (see reader). */
export const readsOf = (testFile, context) => reader(context).reads(testFile);

/** The web tests (paths in the web repo) that read one of the changed files (joined-tree paths, a deleted file included), split into what this job can run and what needs a package
 * it does not install: {run: [...], skipped: [{test, packages}]}. */
export function testsReaching(changed, {web, tree}) {
  const files = changed.map(file => file.trim()).filter(Boolean), picked = {run: [], skipped: []};
  if (!files.length) return picked;
  const scanner = reader({web, tree});
  for (const test of webTests(web).sort()) {
    const read = scanner.reads(path.join(web, test));
    if (!files.some(file => read.has(file) || [...read].some(entry => file.startsWith(`${entry}/`)))) continue;
    const packages = [...scanner.packages(path.join(web, test))];
    if (packages.length) picked.skipped.push({test, packages}); else picked.run.push(test);
  }
  return picked;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = name => { const at = process.argv.indexOf(name); return at > 0 ? path.resolve(process.argv[at + 1]) : null; };
  const web = arg('--web'), tree = arg('--tree');
  if (!web || !tree) { console.error('usage: git diff --name-only --no-renames <base>...<head> | node tools/web-tests-reached.mjs --web <jobadabra-web> --tree <jobadabra>'); process.exit(2); }
  const pairs = layoutOf(web), {run, skipped} = testsReaching(fs.readFileSync(0, 'utf8').split('\n'), {web, tree});
  for (const {test, packages} of skipped) console.error(`skipped ${swap(test, pairs, 0, 1)}: needs ${packages.join(', ')}`);   // stderr: the script shows it, stdout stays the list to run
  for (const test of run) console.log(swap(test, pairs, 0, 1));
}
