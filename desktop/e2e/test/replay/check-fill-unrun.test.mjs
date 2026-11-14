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
