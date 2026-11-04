// The proof a change is a real fix: the changed tests FAIL on an assertion without it and PASS with it, plus the lines a diff adds (moved out of tools/feedback-ai.mjs, 4 Nov 2026, [hm] 2/6).
import {spawnSync} from 'node:child_process';
import path from 'node:path';

// Why (4 Nov 2026, [hm] 3/6 review): the repo's test folders are scoped (TESTS.md: desktop/test/{unit,guards}/<scope>/, tests/{unit,guards}/<scope>/; tests/guards/rules/test_test_folders.py), so the proof must accept them as EDITABLE does; the flat form stays for old callers.
export const TESTS = /^(?:desktop\/test\/(?:(?:unit|guards)\/[A-Za-z0-9_-]+\/)?[A-Za-z0-9._-]+\.test\.js|tests\/(?:(?:unit|guards)\/[A-Za-z0-9_]+\/)?test_[A-Za-z0-9_]+\.py)$/;

/** The lines a diff adds (what would be pushed), without the file headers. */
export const addedLines = diff => String(diff || '').split('\n').filter(line => line.startsWith('+') && !line.startsWith('+++')).map(line => line.slice(1)).join('\n');

const LOAD_ERROR = /ERR_MODULE_NOT_FOUND|ERR_PACKAGE_PATH_NOT_EXPORTED|SyntaxError|Cannot find module|does not provide an export named|ModuleNotFoundError|ImportError|IndentationError/;
/** Did a test FAIL on an assertion (node: ERR_ASSERTION; unittest: a `FAIL:` block), and did nothing fail to load? `output` is read here and never printed (it may quote data). */
export const assertionFailed = output => /ERR_ASSERTION|AssertionError|^FAIL: /m.test(String(output || '')) && !LOAD_ERROR.test(String(output || ''));

/**
 * The proof the change is a real fix: the changed test files FAIL without the change and PASS with it. `run(files, where)` -> {ok}; `where` is 'before' (a clean checkout of HEAD with only the new tests copied in)
 * or 'after' (this tree). -> {ok, why}
 */
export function proof(files, run) {
  const tests = files.filter(file => TESTS.test(file));
  if (!tests.length) return {ok: false, why: 'no test file changed'};
  const before = run(tests, 'before');
  if (before.ok) return {ok: false, why: 'the new test also passes without the fix, so it proves nothing'};
  if (!assertionFailed(before.output)) return {ok: false, why: 'the new test fails without the fix, but not on an assertion (a missing import or a syntax error proves nothing about the bug)'};
  if (!run(tests, 'after').ok) return {ok: false, why: 'the test fails with the fix'};
  return {ok: true, why: ''};
}

/** Runs test files in `root` (the tree, or a clean checkout): node --test for desktop/test, unittest for tests/. -> {ok, output}; the output is never printed (it may quote data). */
export function runTests(files, root) {
  const out = [];
  const env = {...process.env}; delete env.NODE_TEST_CONTEXT;   // a run started from inside another `node --test` would otherwise report through that parent and exit 0 on a failure
  const node = files.filter(file => file.startsWith('desktop/')).map(file => file.slice('desktop/'.length)), py = files.filter(file => file.startsWith('tests/')).map(file => file.replace(/\.py$/, '').replace(/\//g, '.'));
  const done = [node.length && spawnSync('node', ['--test', ...node], {cwd: path.join(root, 'desktop'), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, env}), py.length && spawnSync('python3', ['-m', 'unittest', ...py], {cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, env})].filter(Boolean);
  for (const one of done) out.push(one.stdout, one.stderr);
  return {ok: done.every(one => one.status === 0), output: out.join('\n')};   // the output stays in memory: assertionFailed reads it, nothing prints it
}
