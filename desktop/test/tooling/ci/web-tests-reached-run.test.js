// Guard: release — what the PR gate's web-test step does in each case (tools/web-tests-reached.sh): red only when THIS PR turns a web test red; an outside failure never reds a PR.
// Cases (Gitar on #3950, coordinator 13 Nov 2026): no change = no clone; web unreachable = warning; web private and no token = a warning that names why; a package the job lacks = skipped or warning;
// a break the PR causes = red even beside such a test; red on the base too = warning. Every no-op warning starts "web tests NOT run:". A throwaway git repo is the PR, a folder of tests is web (its tools/lay-private.sh a copy of its test/ folder).
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const GUARD = "import assert from 'node:assert/strict';\nimport {test} from 'node:test';\nimport {readFileSync} from 'node:fs';\ntest('the workflow is clean', () => assert.ok(!readFileSync('.github/workflows/x.yml', 'utf8').includes('BAD'), 'x.yml says BAD'));\n";
const MISSING = "import {test} from 'node:test';\nconst name = ['not', 'installed', 'pkg'].join('-');\nconst note = '.github/workflows/x.yml';\ntest('needs a package', async () => { await import(name); });\n";
const STATIC_PACKAGE = "import {x} from 'left-pad';\nimport {test} from 'node:test';\nconst note = '.github/workflows/x.yml';\ntest('static', () => x);\n";

/** A PR whose base has x.yml = baseText and whose head has headText (the same text: no change), and a web with the given test files. */
function pr({baseText = 'ok\n', headText = 'ok\n', tests = {'test/unit/guard.test.js': GUARD}}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'web-run-'));
  const repo = path.join(root, 'repo'), web = path.join(root, 'web');
  const git = (...args) => spawnSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {encoding: 'utf8'});
  fs.mkdirSync(path.join(repo, 'tools'), {recursive: true});
  fs.mkdirSync(path.join(repo, '.github/workflows'), {recursive: true});
  for (const file of ['web-tests-reached.mjs', 'web-tests-reached.sh']) fs.copyFileSync(path.join(REPO, 'tools', file), path.join(repo, 'tools', file));
  git('init', '-q'); fs.writeFileSync(path.join(repo, '.github/workflows/x.yml'), baseText); git('add', '-A'); git('commit', '-q', '-m', 'base');
  const baseSha = git('rev-parse', 'HEAD').stdout.trim();
  fs.writeFileSync(path.join(repo, '.github/workflows/x.yml'), headText); git('add', '-A'); git('commit', '-q', '--allow-empty', '-m', 'head');
  const headSha = git('rev-parse', 'HEAD').stdout.trim();
  fs.mkdirSync(path.join(web, 'tools'), {recursive: true});
  fs.writeFileSync(path.join(web, 'tools/lay-private.sh'), '#!/usr/bin/env bash\nmkdir -p "$2/test" && cp -R "$1/test/." "$2/test/"\n', {mode: 0o755});
  for (const [file, text] of Object.entries(tests)) { fs.mkdirSync(path.dirname(path.join(web, file)), {recursive: true}); fs.writeFileSync(path.join(web, file), text); }
  const env = {...process.env, CLONE_WAIT: '0'};
  delete env.NODE_TEST_CONTEXT;   // a child `node --test` inside this test would otherwise report to the parent runner
  const run = extra => { const done = spawnSync('bash', ['tools/web-tests-reached.sh', baseSha, headSha], {cwd: repo, encoding: 'utf8', env: {...env, ...extra}}); return {status: done.status, out: done.stdout + done.stderr}; };
  return {run, web};
}

test('a PR that changes no file ends at once, and never clones web', () => {
  const {run} = pr({});
  const done = run({WEB_REPO_URL: '/nonexistent/web.git'});
  assert.equal(done.status, 0, done.out);
  assert.match(done.out, /changes no file/);
  assert.doesNotMatch(done.out, /clone/);
});

test('web cannot be cloned: a warning that says the tests were not run, never a red', () => {
  const {run} = pr({headText: 'changed\n'});
  const done = run({WEB_REPO_URL: '/nonexistent/web.git'});
  assert.equal(done.status, 0, done.out);
  assert.match(done.out, /::warning::web tests NOT run: could not clone jobadabra-web in 3 tries/);
});

// A git that answers a clone the way GitHub answers a private repo asked without a token (a username prompt that is off), and is the real git for everything else.
function gitRefusingClone() {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'web-run-bin-'));
  const real = spawnSync('which', ['git'], {encoding: 'utf8'}).stdout.trim();
  fs.writeFileSync(path.join(bin, 'git'), `#!/usr/bin/env bash\nfor a in "$@"; do [ "$a" = clone ] && { echo "fatal: could not read Username for 'https://github.com': terminal prompts disabled" >&2; exit 128; }; done\nexec ${real} "$@"\n`, {mode: 0o755});
  return bin;
}

test('web is private and the job has no token: the warning names why, and nothing is run, never a red', () => {
  const {run} = pr({headText: 'changed\n'});
  const done = run({PATH: `${gitRefusingClone()}${path.delimiter}${process.env.PATH}`});
  assert.equal(done.status, 0, done.out);
  assert.match(done.out, /::warning::web tests NOT run: jobadabra-web refused a clone without a token \(private\?\) and this job had none/);
  assert.match(done.out, /terminal prompts disabled/);
  assert.doesNotMatch(done.out, /every jobadabra-web test/);
});

test('web handed over as a checkout (WEB_DIR) never clones, so a private web can be read', () => {
  const {run, web} = pr({headText: 'BAD\n'});
  const done = run({WEB_DIR: web, PATH: `${gitRefusingClone()}${path.delimiter}${process.env.PATH}`});
  assert.equal(done.status, 1, done.out);
  assert.match(done.out, /::error::this PR turns jobadabra-web test\(s\) red: test\/unit\/guard\.test\.js/);
});

test('a change no picked web test objects to is green', () => {
  const {run, web} = pr({headText: 'fine\n'});
  const done = run({WEB_DIR: web});
  assert.equal(done.status, 0, done.out);
  assert.match(done.out, /1\):\n {2}test\/unit\/guard\.test\.js/);
  assert.match(done.out, /passes/);
});

test('a web test the PR turns red is red, with the test\'s own message', () => {
  const {run, web} = pr({headText: 'BAD\n'});
  const done = run({WEB_DIR: web});
  assert.equal(done.status, 1, done.out);
  assert.match(done.out, /::error::this PR turns jobadabra-web test\(s\) red: test\/unit\/guard\.test\.js/);
  assert.match(done.out, /x\.yml says BAD/);
});

test('a test already red on the base is a warning: not this PR\'s', () => {
  const {run, web} = pr({baseText: 'BAD\n', headText: 'BAD BAD\n'});
  const done = run({WEB_DIR: web});
  assert.equal(done.status, 0, done.out);
  assert.match(done.out, /::warning::test\/unit\/guard\.test\.js is red on the base too/);
});

test('a test that needs a package the job lacks is not run and says so; a computed import that fails is a warning', () => {
  const {run, web} = pr({headText: 'fine\n', tests: {'test/unit/static.test.js': STATIC_PACKAGE, 'test/unit/missing.test.js': MISSING}});
  const done = run({WEB_DIR: web});
  assert.equal(done.status, 0, done.out);
  assert.match(done.out, /not run here[^]*test\/unit\/static\.test\.js: needs left-pad/);
  assert.match(done.out, /::warning::web test NOT run: test\/unit\/missing\.test\.js needs a package this job does not install/);
  assert.match(done.out, /passes \(web tests NOT run: 2, see above\)/);
});

test('a real break is still red beside a test that needs a missing package', () => {
  const {run, web} = pr({headText: 'BAD\n', tests: {'test/unit/guard.test.js': GUARD, 'test/unit/missing.test.js': MISSING}});
  const done = run({WEB_DIR: web});
  assert.equal(done.status, 1, done.out);
  assert.match(done.out, /::warning::web test NOT run: test\/unit\/missing\.test\.js needs a package/);
  assert.match(done.out, /::error::this PR turns jobadabra-web test\(s\) red: test\/unit\/guard\.test\.js/);
});
