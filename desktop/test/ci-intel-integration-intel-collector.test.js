// The integration collector's pure part (tools/ci-intel/jobs/integration-intel-rows.mjs): result files, run rows, flaky detection (same commit, unchanged files, a fix is not flaky), the slowest 10, the move's counts.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readResults} from '../../tools/ci-intel/jobs/integration-intel.mjs';
import {beforePending, inOrder, advance, countsOf, grepCounts, moveRow, parseResult, pathMatches, runRow, slowestOf} from '../../tools/ci-intel/jobs/integration-intel-rows.mjs';

const file = (layer, tests, extra = {}) => ({v: 1, layer, platform: 'linux', tests, ...extra});
const obs = (runId, sha, createdAt, ok, extra = {}) => ({runId, sha, day: createdAt.slice(0, 10), createdAt, on: 'main', layer: 'app', platform: 'linux', name: 'focus keeps state', file: 'desktop/integration/app/f.test.js', ok, ...extra});

test('a result file: wrong version, layer or shape is refused; the time is the file\'s or the sum of its tests', () => {
  assert.equal(parseResult(null), null);
  assert.equal(parseResult(file('nope', [])), null);
  assert.equal(parseResult({...file('app', []), v: 2}), null);
  const result = parseResult(file('app', [{name: 'a', file: 'x.js', ok: true, ms: 120.4}, {name: 'b', file: 'x.js', ok: false, ms: 80, failure: 'expected 1\nreceived 2'}, {ok: true}]));
  assert.deepEqual([result.tests.length, result.ms, result.tests[1].failure], [2, 200, 'expected 1 received 2']);
  assert.equal(parseResult(file('app', [{name: 'a', ok: true, ms: 5}], {ms: 9000})).ms, 9000);
});

test('a run row: a push to main is main, any other branch is a PR; one failed test makes the layer red', () => {
  const result = parseResult(file('store', [{name: 'a', ok: true, ms: 5}, {name: 'b', ok: false, ms: 5}]));
  const main = runRow({databaseId: 7, createdAt: '2026-11-01T10:00:00Z', headSha: 'abc1234', headBranch: 'main', event: 'push'}, result);
  assert.deepEqual([main.on, main.conclusion, main.failed, main.tests, main.day], ['main', 'failure', 1, 2, '2026-11-01']);
  assert.equal(runRow({databaseId: 8, createdAt: '2026-11-01T10:00:00Z', headSha: 'abc1234', headBranch: 'c27', event: 'pull_request'}, result).on, 'pr');
});

test('flaky: red then green on the same commit is flaky; on another commit only when nothing the workflow watches changed; a change in between is a fix', async () => {
  const watched = ['desktop/integration/**', 'desktop/lib/**'];
  const same = await advance([], [obs(1, 'aaa', '2026-11-01T10:00:00Z', false), obs(2, 'aaa', '2026-11-01T10:20:00Z', true)], {watched});
  assert.deepEqual(same.flaky.map(row => [row.kind, row.red.runId, row.green.runId]), [['same-commit', 1, 2]]);
  assert.deepEqual(same.open, []);
  const unchanged = await advance([], [obs(1, 'aaa', '2026-11-01T10:00:00Z', false), obs(2, 'bbb', '2026-11-01T11:00:00Z', true)], {watched, changedBetween: async () => ['docs/readme.md', 'tools/x.mjs']});
  assert.deepEqual(unchanged.flaky.map(row => row.kind), ['unchanged-files']);
  const fixed = await advance([], [obs(1, 'aaa', '2026-11-01T10:00:00Z', false), obs(2, 'bbb', '2026-11-01T11:00:00Z', true)], {watched, changedBetween: async () => ['desktop/lib/focus.js']});
  assert.deepEqual([fixed.flaky.length, fixed.open.length], [0, 0], 'the code changed: a fix, not a flake');
  const unknown = await advance([], [obs(1, 'aaa', '2026-11-01T10:00:00Z', false), obs(2, 'bbb', '2026-11-01T11:00:00Z', true)], {watched, changedBetween: async () => null});
  assert.equal(unknown.flaky.length, 0, 'an unreadable comparison is never guessed');
  const noWatch = await advance([], [obs(1, 'aaa', '2026-11-01T10:00:00Z', false), obs(2, 'bbb', '2026-11-01T11:00:00Z', true)], {changedBetween: async () => []});
  assert.equal(noWatch.flaky.length, 0, 'no workflow paths read: only the same-commit kind');
  const pr = await advance([], [obs(1, 'aaa', '2026-11-01T10:00:00Z', false, {on: 'pr'}), obs(2, 'bbb', '2026-11-01T11:00:00Z', true, {on: 'pr'})], {watched, changedBetween: async () => []});
  assert.equal(pr.flaky.length, 0, 'a PR branch changes on every push: only main is compared across commits');
});

test('an open red survives the hour: it is stored and closed by a later green; a platform is its own test', async () => {
  const first = await advance([], [obs(1, 'aaa', '2026-11-01T10:00:00Z', false)], {});
  assert.equal(first.open.length, 1);
  const second = await advance(first.open, [obs(2, 'aaa', '2026-11-01T10:30:00Z', true, {platform: 'windows'})], {});
  assert.equal(second.flaky.length, 0, 'the other platform passing says nothing about this one');
  const third = await advance(second.open, [obs(3, 'aaa', '2026-11-01T10:40:00Z', true)], {});
  assert.deepEqual([third.flaky.length, third.open.length], [1, 0]);
});

test('paths: ** crosses folders, * does not', () => {
  assert.equal(pathMatches(['desktop/integration/**'], 'desktop/integration/app/a.js'), true);
  assert.equal(pathMatches(['extension/*.js'], 'extension/x/y.js'), false);
  assert.equal(pathMatches(['extension/*.js'], 'extension/y.js'), true);
  assert.equal(pathMatches(['desktop/lib/**'], 'docs/desktop/lib/a.js'), false);
});

test('the slowest 10 keep one row per layer and test (its slowest time); counts come from the fullest result', () => {
  const results = [parseResult(file('app', [{name: 'a', file: 'a.js', ok: true, ms: 100}, {name: 'b', file: 'b.js', ok: true, ms: 900}])), parseResult({...file('app', [{name: 'a', file: 'a.js', ok: true, ms: 700}]), platform: 'windows'}),
    parseResult(file('store', [{name: 'a', file: 's.js', ok: true, ms: 50}]))];
  assert.deepEqual(slowestOf(results).map(row => `${row.layer}/${row.test}/${row.ms}`), ['app/b/900', 'app/a/700', 'store/a/50']);
  assert.equal(slowestOf(Array.from({length: 15}, (_, i) => parseResult(file('store', [{name: `t${i}`, ok: true, ms: i}])))).length, 10);
  assert.deepEqual(countsOf(results), {extension: {tests: 0, files: 0}, app: {tests: 2, files: 2}, store: {tests: 1, files: 1}});
});

test('the move: git grep counts and the tree become a day\'s row', () => {
  const stepCounts = grepCounts('abc:desktop/e2e/suites/apply.mjs:12\nabc:desktop/e2e/suites/jobs.mjs:30\n', 'abc');
  const testCounts = grepCounts('desktop/integration/app/a.test.js:5\ndesktop/integration/store/s.test.mjs:7\ndesktop/integration/app/kit.js:0\n');
  const row = moveRow('2026-11-01', ['desktop/e2e/suites/apply.mjs', 'desktop/e2e/suites/jobs.mjs', 'desktop/e2e/suites/readme.md', 'desktop/integration/app/a.test.js'], stepCounts, testCounts);
  assert.deepEqual(row, {day: '2026-11-01', e2eSuites: 2, e2eSteps: 42, integration: {extension: 0, app: 5, store: 7}});
});

test('a run is read once, but only for a clear answer: files, or gh\'s "no artifact"; a timeout or rate limit leaves it to the next hour (Gitar #245)', async () => {
  const fail = message => async () => { const error = new Error(message); error.stderr = message; throw error; };
  assert.deepEqual(await readResults(1, async () => {}), {ok: true, results: []}, 'downloaded nothing: no result file');
  assert.equal((await readResults(2, fail('no artifact matches any of the names or patterns provided'))).ok, true);
  assert.equal((await readResults(3, fail('no valid artifacts found to download'))).ok, true);
  assert.equal((await readResults(4, fail('Command failed: gh run download ETIMEDOUT'))).ok, false);
  assert.equal((await readResults(5, fail('HTTP 403: API rate limit exceeded'))).ok, false);
});

test('a run not read for certain holds back the newer ones, so a retry never reaches advance() out of order; a run dead for two days is let go', () => {
  const item = (id, createdAt, ok) => ({run: {databaseId: id, createdAt}, ok, results: ok ? [1] : []});
  const now = Date.parse('2026-11-01T12:00:00Z');
  assert.deepEqual(inOrder([item(3, '2026-11-01T11:00:00Z', true), item(1, '2026-11-01T09:00:00Z', true), item(2, '2026-11-01T10:00:00Z', false)], now).map(entry => entry.run.databaseId), [1], 'run 2 failed: 3 waits for it');
  const old = inOrder([item(1, '2026-10-29T09:00:00Z', false), item(2, '2026-11-01T10:00:00Z', true)], now);
  assert.deepEqual(old.map(entry => [entry.run.databaseId, entry.ok, entry.results.length]), [[1, true, 0], [2, true, 1]]);
});

test('a run still in progress holds back the newer finished ones, until it is two days old', () => {
  const items = [{run: {createdAt: '2026-11-01T10:45:00Z'}}, {run: {createdAt: '2026-11-01T10:00:00Z'}}];
  const now = Date.parse('2026-11-01T12:00:00Z');
  assert.deepEqual(beforePending(items, [{createdAt: '2026-11-01T10:30:00Z', conclusion: null}], now).map(item => item.run.createdAt), ['2026-11-01T10:00:00Z']);
  assert.equal(beforePending(items, [{createdAt: '2026-10-29T10:30:00Z', conclusion: null}], now).length, 2, 'a run stuck for days lets go');
  assert.equal(beforePending(items, [{createdAt: '2026-11-01T10:30:00Z', conclusion: 'cancelled'}], now).length, 2);
});
