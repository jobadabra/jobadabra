// A save of the search settings starts the engine's preparation of the next search (lib/search-prepared.js), after the copy is written, and never waits for it or fails with it.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {saveSettings} from '../../../lib/strategy.js';
import {prepareSearch} from '../../../lib/search-prepared.js';

function setup(run) {
  const files = {'config/search.json': JSON.stringify({role_keywords: ['example role']}), 'config/preferences.json': '{}'};
  const calls = [];
  const storage = {readText: name => files[name] || '', writeText: (name, text) => { files[name] = text; calls.push(`write:${name}`); }, secret: () => '', settings: () => ({}), saveSettings() {}};
  const deps = {run: run || (async (_, args) => { calls.push(`run:${args.join(' ')}`); return {code: 0, stdout: ''}; }), ensurePage: async () => '', writePage: async () => {}};
  return {files, calls, storage, deps};
}
const settled = () => new Promise(resolve => setImmediate(resolve));

test('saving the search settings prepares the next search, after the copy is written', async () => {
  const t = setup();
  await saveSettings(t.storage, {search: {role_keywords: ['another example role']}}, t.deps);
  await settled();
  assert.deepEqual(t.calls, ['write:config/search.json', 'run:src.search_prepared prepare']);
});

test('a save of the preferences alone prepares nothing: places and roles did not change', async () => {
  const t = setup();
  await saveSettings(t.storage, {preferences: {daily_applications_target: 5}}, t.deps);
  await settled();
  assert.deepEqual(t.calls, ['write:config/preferences.json']);
});

test('the save does not wait for the preparation and does not fail with it', async () => {
  let release;
  const t = setup(() => new Promise((_, reject) => { release = () => reject(new Error('engine not found')); }));
  await saveSettings(t.storage, {search: {role_keywords: ['x']}}, t.deps);   // returns while the engine still runs
  assert.equal(JSON.parse(t.files['config/search.json']).role_keywords[0], 'x');
  release();
  await settled();
});

test('no runner, a refusal or an engine error: false, never a throw', async () => {
  assert.equal(await prepareSearch({}, undefined), false);
  assert.equal(await prepareSearch({}, async () => ({code: 1})), false);
  assert.equal(await prepareSearch({}, async () => { throw new Error('x'); }), false);
  assert.equal(await prepareSearch({}, async () => ({code: 0})), true);
});
