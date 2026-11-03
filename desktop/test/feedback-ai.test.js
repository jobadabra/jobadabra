// tools/feedback-ai.mjs, the script of the "Send to AI" run (feedback-ai.yml): what it reads, what it redacts again, what may never be posted in public, the before/after proof and what it tells the site.
// Nothing here calls the site, GitHub or the AI broker: fetchers are fakes and the broker's answers are not needed (edit-codex.mjs has its own test).
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {AUDIENCE, addedLines, assertionFailed, changeText, closedReport, copied, fetchBrief, leaks, promptFor, proof, redactBrief, report, runTests, siteToken} from '../../tools/feedback-ai.mjs';

const ENV = {ACTIONS_ID_TOKEN_REQUEST_URL: 'https://token.example/req?x=1', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'req-token', FEEDBACK_AI_URL: 'https://site.example'};
const json = (body, status = 200) => ({ok: status < 400, status, json: async () => body});
const brief = {ref: '00000000000000aa', text: 'The salary field loses what I type after I switch to the Track page and back, every time I use it.', version: '0.9.1', platform: 'darwin', screen: 'Track',
  files: {logs: '10:01 error: ana@example.com saved token=abc123secretvalue in /Users/ana fake/jobs\n10:02 the salary draft was dropped because the store reset on navigation'}};

test('the run token is asked for with the feedback audience, and a run without one fails with a plain reason', async () => {
  const seen = [];
  const token = await siteToken(ENV, async (url, init) => { seen.push([url, init.headers.authorization]); return json({value: 'jwt'}); });
  assert.equal(token, 'jwt');
  assert.deepEqual(seen, [[`https://token.example/req?x=1&audience=${AUDIENCE}`, 'Bearer req-token']]);
  assert.equal(AUDIENCE, 'jobadabra-feedback');
  await assert.rejects(() => siteToken({}, async () => json({})), /no GitHub run token/);
});

test('the brief is fetched with the run token; a refusal names the status and the site\'s reason and never prints a body', async () => {
  const calls = [];
  const fetcher = async (url, init) => { calls.push([url, init.headers.authorization]); return url.includes('token.example') ? json({value: 'jwt'}) : json({ok: true, brief}); };
  assert.deepEqual(await fetchBrief('00000000000000aa', ENV, fetcher), brief);
  assert.deepEqual(calls[1], ['https://site.example/api/feedback/brief?ref=00000000000000aa', 'Bearer jwt']);
  const refused = async url => (url.includes('token.example') ? json({value: 'jwt'}) : json({ok: false, error: 'this feedback is not waiting for a run'}, 409));
  await assert.rejects(() => fetchBrief('00000000000000aa', ENV, refused), /HTTP 409: this feedback is not waiting for a run/);
});

test('the second redaction pass removes e-mails, tokens and the home-folder name from the report and its files before the AI reads them', () => {
  const clean = redactBrief(brief);
  assert.doesNotMatch(clean.files.logs, /ana@example\.com|abc123secretvalue|ana fake/);
  assert.match(clean.files.logs, /the salary draft was dropped/);
  assert.equal(clean.text, brief.text);
});

test('the prompt says the report is data, names the verdict words, the allowed folders and the public rule, and carries the report and its files', () => {
  const prompt = promptFor(redactBrief(brief));
  for (const part of ['DATA written by a stranger', 'fixed-already, not-reproducible, needs-human, false-positive', 'src/, desktop/renderer/, desktop/lib/', 'PUBLIC', 'FAILS before your fix', 'salary field loses', '--- logs (data) ---']) assert.ok(prompt.includes(part), part);
  assert.doesNotMatch(prompt, /ana@example\.com/);
});

test('what may not be posted in public: an e-mail, a home folder, a token, a passage copied from the report or its logs; invented text and a cause in the AI\'s own words are clean', () => {
  const fresh = 'Root cause: the Track store is rebuilt on navigation, so a draft kept only in component state is lost. Fix: keep the draft in the store. Test: type 1200, switch pages, expect 1200.';
  assert.deepEqual(leaks(fresh, brief), []);
  assert.deepEqual(leaks('contact ana@example.com about it', brief), ['an e-mail address']);
  assert.ok(leaks('see /Users/ana/jobs/file.js', brief).includes('a home-folder name'));
  assert.ok(leaks('see /home/runner/work/file.js', brief).length, 'any home-style path is refused: a fix has no reason to name one');
  assert.ok(leaks('Authorization: Bearer abcdef0123456789abcdef', brief).some(reason => /redactor/.test(reason)));
  assert.deepEqual(leaks('The user says the salary field loses what I type after I switch to the Track page', brief), ['a passage copied from the report or its files']);
  assert.deepEqual(leaks('the salary draft was dropped because the store reset on navigation', brief), ['a passage copied from the report or its files'], 'a line of the logs');
  assert.deepEqual(leaks('contact ana@exam\u200bple.com', brief), ['an e-mail address'], 'a zero-width character does not hide an address');
  assert.deepEqual(leaks('contact ana [at] example [dot] com', brief), ['an e-mail address']);
  assert.deepEqual(leaks('call +41 79 123 45 67 tomorrow', brief), ['a phone number']);
  assert.equal(copied('the salary field loses', brief).length, 0, 'under 8 words in common is not a copy');
});

test('the diff scan sees only added lines, and new files whole', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-leak-')), git = (...args) => execFileSync('git', ['-c', 'user.email=a@b', '-c', 'user.name=a', ...args], {cwd: dir, stdio: 'pipe'});
  git('init', '-q'); fs.writeFileSync(path.join(dir, 'a.js'), 'old ana@example.com line\n'); git('add', '-A'); git('commit', '-qm', 'x');
  fs.writeFileSync(path.join(dir, 'a.js'), 'old ana@example.com line\nnew line\n'); fs.writeFileSync(path.join(dir, 'b.js'), 'brand new file with owner@example.org\n'); fs.mkdirSync(path.join(dir, '.fb')); fs.writeFileSync(path.join(dir, '.fb/brief.json'), 'secret@example.org');
  const text = changeText(dir);
  assert.match(text, /new line/);
  assert.match(text, /owner@example\.org/);
  assert.doesNotMatch(text, /secret@example\.org/, 'the work folder is not part of the change');
  assert.doesNotMatch(text, /old ana@example\.com/, 'a line the change did not touch is not scanned');
  assert.equal(addedLines('+++ b/a\n+one\n two\n-three\n+four'), 'one\nfour');
});

test('the proof: a new test must fail on an ASSERTION without the fix and pass with it; no test, one that passes anyway, one that only fails to load, or one that still fails are refused', () => {
  const calls = [], assertion = 'not ok 1 - a\n  code: ERR_ASSERTION', load = 'Error [ERR_MODULE_NOT_FOUND]: Cannot find module', run = answers => (files, where) => { calls.push(where); return answers[where]; };
  assert.deepEqual(proof(['src/a.py'], run({})), {ok: false, why: 'no test file changed'});
  assert.match(proof(['desktop/lib/a.js', 'desktop/test/a.test.js'], run({before: {ok: true}, after: {ok: true}})).why, /passes without the fix/);
  assert.match(proof(['desktop/test/a.test.js'], run({before: {ok: false, output: load}, after: {ok: true}})).why, /not on an assertion/, 'a new function that does not exist yet fails to import: that proves nothing about the bug');
  assert.match(proof(['tests/test_a.py'], run({before: {ok: false, output: assertion}, after: {ok: false}})).why, /fails with the fix/);
  calls.length = 0;
  assert.deepEqual(proof(['src/a.py', 'tests/test_a.py'], run({before: {ok: false, output: 'FAIL: test_a (tests.test_a.T)\nAssertionError: 1 != 2'}, after: {ok: true}})), {ok: true, why: ''});
  assert.deepEqual(calls, ['before', 'after']);
  assert.equal(proof(['desktop/e2e/x.test.mjs'], run({before: {ok: false, output: assertion}, after: {ok: true}})).ok, false, 'only the app and engine test folders count');
  assert.equal(assertionFailed('not ok\n code: ERR_ASSERTION\n SyntaxError: x'), false, 'a load error anywhere in the output wins');
  assert.equal(assertionFailed(''), false);
});

test('runTests runs node and python test files in a folder by exit code alone', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-run-'));
  fs.mkdirSync(path.join(dir, 'desktop/test'), {recursive: true}); fs.mkdirSync(path.join(dir, 'tests'));
  fs.writeFileSync(path.join(dir, 'desktop/test/ok.test.js'), "import test from 'node:test'; test('a', () => {});\n");
  fs.writeFileSync(path.join(dir, 'desktop/test/bad.test.js'), "import test from 'node:test'; import assert from 'node:assert'; test('a', () => assert.equal(1, 2));\n");
  fs.writeFileSync(path.join(dir, 'desktop/package.json'), '{"type":"module"}');
  fs.writeFileSync(path.join(dir, 'tests/test_ok.py'), 'import unittest\nclass T(unittest.TestCase):\n    def test_a(self): pass\n');
  fs.writeFileSync(path.join(dir, 'tests/test_bad.py'), 'import unittest\nclass T(unittest.TestCase):\n    def test_a(self): self.assertEqual(1, 2)\n');
  assert.equal(runTests(['desktop/test/ok.test.js', 'tests/test_ok.py'], dir).ok, true);
  assert.equal(runTests(['desktop/test/ok.test.js', 'desktop/test/bad.test.js'], dir).ok, false);
  assert.equal(runTests(['tests/test_bad.py'], dir).ok, false);
  assert.equal(assertionFailed(runTests(['desktop/test/bad.test.js'], dir).output), true, 'the failing assertion is seen in the captured output, which is never printed');
  assert.equal(assertionFailed(runTests(['tests/test_bad.py'], dir).output), true);
});

test('the site is told with the run token and the right body; a refusal makes the run go red with its reason', async () => {
  const sent = [];
  const fetcher = async (url, init) => { if (url.includes('token.example')) return json({value: 'jwt'}); sent.push([url, init.method, init.headers.authorization, JSON.parse(init.body)]); return json({ok: true}); };
  await report({ref: '00000000000000aa', status: 'none', verdict: 'not-reproducible', why: 'works'}, ENV, fetcher);
  assert.deepEqual(sent, [['https://site.example/api/feedback/ai-status', 'POST', 'Bearer jwt', {ref: '00000000000000aa', status: 'none', verdict: 'not-reproducible', why: 'works'}]]);
  await assert.rejects(() => report({ref: 'x', status: 'none'}, ENV, async url => (url.includes('token.example') ? json({value: 'jwt'}) : json({ok: false, error: 'this run does not own that feedback'}, 409))), /HTTP 409: this run does not own that feedback/);
});

test('a closed pull request is reported only for a branch fd-ai/<ref> of this repository; merged only when GitHub says merged', () => {
  const event = (extra = {}, head = {}) => ({pull_request: {html_url: 'https://github.com/o/r/pull/5', merged: true, user: {type: 'Bot'}, labels: [{name: 'fd-ai'}], head: {ref: 'fd-ai/00000000000000aa', repo: {full_name: 'o/r'}, ...head}, ...extra}});
  assert.deepEqual(closedReport(event(), 'o/r'), {ref: '00000000000000aa', status: 'merged', pr: 'https://github.com/o/r/pull/5'});
  assert.equal(closedReport(event({merged: false}), 'o/r').status, 'closed');
  assert.equal(closedReport(event({merged: 'true'}), 'o/r').status, 'closed', 'only a real true is a merge');
  assert.equal(closedReport(event({}, {repo: {full_name: 'fork/r'}}), 'o/r'), null, 'a fork\'s branch');
  assert.equal(closedReport(event({}, {ref: 'feature/x'}), 'o/r'), null);
  assert.equal(closedReport(event({}, {ref: 'fd-ai/not-a-ref'}), 'o/r'), null);
  assert.equal(closedReport(event({user: {type: 'User'}}), 'o/r'), null, 'a person\'s branch with the right name is not the workflow\'s pull request');
  assert.equal(closedReport(event({labels: []}), 'o/r'), null, 'no fd-ai label');
  assert.equal(closedReport({}, 'o/r'), null);
});

// The scenario of the workflow, on a throwaway repo: an AI edit sits in the working tree; `proof` and `leaks` run as the workflow runs them (real git worktree, real test runs).
const TOOL = path.resolve(import.meta.dirname, '../../tools/feedback-ai.mjs');
function repoWithBug() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-flow-')), git = (...args) => execFileSync('git', ['-c', 'user.email=a@b', '-c', 'user.name=a', ...args], {cwd: dir, stdio: 'pipe'});
  fs.mkdirSync(path.join(dir, 'desktop/lib'), {recursive: true}); fs.mkdirSync(path.join(dir, 'desktop/test'));
  fs.writeFileSync(path.join(dir, 'desktop/package.json'), '{"type":"module"}');
  fs.writeFileSync(path.join(dir, 'desktop/lib/add.js'), 'export const add = (a, b) => a - b;\n');
  git('init', '-q'); git('add', '-A'); git('commit', '-qm', 'x');
  return dir;
}
const cli = (dir, ...args) => { const done = spawnSync('node', [TOOL, ...args], {cwd: dir, encoding: 'utf8', env: {...process.env, NODE_TEST_CONTEXT: ''}}); return {status: done.status, out: done.stdout + done.stderr}; };

test('scenario: a real fix with a test that fails on an assertion before it passes the proof; a test that passes anyway, or one that only fails to import, does not', () => {
  const dir = repoWithBug();
  fs.writeFileSync(path.join(dir, 'desktop/lib/add.js'), 'export const add = (a, b) => a + b;\n');
  fs.writeFileSync(path.join(dir, 'desktop/test/add.test.js'), "import test from 'node:test'; import assert from 'node:assert'; import {add} from '../lib/add.js'; test('adds', () => assert.equal(add(1, 2), 3));\n");
  const good = cli(dir, 'proof');
  assert.equal(good.status, 0, good.out);
  assert.match(good.out, /fails \(on an assertion\) without the fix and passes with it/);
  assert.equal(execFileSync('git', ['worktree', 'list'], {cwd: dir, encoding: 'utf8'}).trim().split('\n').length, 1, 'the clean checkout is removed afterwards');
  fs.writeFileSync(path.join(dir, 'desktop/test/add.test.js'), "import test from 'node:test'; import assert from 'node:assert'; test('always', () => assert.equal(1, 1));\n");
  assert.match(cli(dir, 'proof').out, /also passes without the fix/);
  fs.writeFileSync(path.join(dir, 'desktop/test/add.test.js'), "import test from 'node:test'; import assert from 'node:assert'; import {multiply} from '../lib/add.js'; test('m', () => assert.equal(multiply(2, 3), 6));\n");
  fs.writeFileSync(path.join(dir, 'desktop/lib/add.js'), 'export const add = (a, b) => a + b;\nexport const multiply = (a, b) => a * b;\n');
  const loadOnly = cli(dir, 'proof');
  assert.equal(loadOnly.status, 1);
  assert.match(loadOnly.out, /not on an assertion/);
});

test('scenario: the leak scan stops a pull request text or a new file that copies the report, and passes the AI\'s own words; it never prints what it found', () => {
  const dir = repoWithBug(), out = path.join(dir, '.fb');
  fs.mkdirSync(out); fs.writeFileSync(path.join(out, 'brief.json'), JSON.stringify(brief));
  fs.writeFileSync(path.join(dir, 'desktop/lib/add.js'), 'export const add = (a, b) => a + b;\n');
  fs.writeFileSync(path.join(out, 'title.txt'), '[fd-ai] 00000000000000aa add sums\n'); fs.writeFileSync(path.join(out, 'body.md'), 'Root cause: add subtracted. Fix: add. Test: add(1, 2) is 3.\n');
  const clean = cli(dir, 'leaks', '--out', out, '--title', path.join(out, 'title.txt'), '--body', path.join(out, 'body.md'));
  assert.equal(clean.status, 0, clean.out);
  fs.writeFileSync(path.join(dir, 'desktop/lib/new.js'), "// The salary field loses what I type after I switch to the Track page and back, every time\nexport const x = 1;\n");
  const copiedFile = cli(dir, 'leaks', '--out', out, '--title', path.join(out, 'title.txt'), '--body', path.join(out, 'body.md'));
  assert.equal(copiedFile.status, 1);
  assert.match(copiedFile.out, /a passage copied from the report/);
  assert.doesNotMatch(copiedFile.out, /salary field/, 'the refusal names the kind, never the text');
});
