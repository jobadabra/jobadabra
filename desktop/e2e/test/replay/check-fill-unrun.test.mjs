// Guard: release — without it one case's failed press retires the shared browser and every case still queued counts as wrong, so main goes red on cases that never ran
// (main at 691d7224: 81/140 right against 137/140, 56 of them "not run"). lib/check-fill-score.mjs runUnrun.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {bucketOf, runUnrun} from '../../lib/check-fill-score.mjs';

const retired = name => ({name, ok: false, retired: true, seconds: 0, failures: ['not run: browser retired after a: error: panel button "Fill again" not pressed'], seen: {tabs: 0, opened: 0}});
const right = name => ({name, ok: true, failures: [], seen: {tabs: 1, opened: 0}});

test('a case a retired browser never ran gets one run in a fresh browser; the case that failed keeps its own red', async () => {
  const items = [{name: 'a'}, {name: 'b'}, {name: 'c'}];
  const first = [{name: 'a', ok: false, fatal: true, failures: ['error: panel button "Fill again" not pressed']}, retired('b'), retired('c')];
  const asked = [];
  const out = await runUnrun(items, first, async list => { asked.push(list.map(one => one.name)); return list.map(one => right(one.name)); });
  assert.deepEqual(asked, [['b', 'c']], 'only the cases that never ran, once, in their order');
  assert.deepEqual(out.map(bucketOf), [bucketOf(first[0]), 'right', 'right']);
});

test('no case left unrun: no second browser', async () => {
  let calls = 0;
  const results = [right('a')];
  assert.equal(await runUnrun([{name: 'a'}], results, async () => { calls += 1; return []; }), results);
  assert.equal(calls, 0);
});

test('a case the second browser also never ran stays "not run", and a short second answer keeps the first result (Gitar on #4142, reopened as #4148)', async () => {
  const items = [{name: 'a'}, {name: 'b'}, {name: 'c'}];
  const first = [right('a'), retired('b'), retired('c')];
  const twice = await runUnrun(items, first, async list => [retired(list[0].name), right(list[1].name)]);
  assert.equal(twice[1].retired, true, 'still not run: the second retirement is a real red, never a pass');
  assert.equal(twice[2].ok, true);
  const short = await runUnrun(items, first, async () => []);
  assert.deepEqual(short, first, 'no answer for a case: its first result stays');
});

test('a second browser that fails to start keeps the first results, and each case it never ran says why (Gitar on #4148)', async () => {
  const items = [{name: 'a'}, {name: 'b'}];
  const first = [right('a'), retired('b')];
  const out = await runUnrun(items, first, async () => { throw new Error('replay browser startup: no answer in 120000 ms'); });
  assert.equal(out[0], first[0]);
  assert.equal(out[1].retired, true);
  assert.match(out[1].failures.at(-1), /^second browser failed: replay browser startup/);
});
