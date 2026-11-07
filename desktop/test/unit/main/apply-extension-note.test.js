// Owner's 0.9.13 retest (7 Nov 2026): an old extension filled the forms and nothing said so. A press that opens Chrome now answers with the stale-copy sentence (`extensionNote`); the hidden browser, a failed start and a current copy carry none.
import assert from 'node:assert/strict';
import path from 'node:path';
import {test} from 'node:test';
import {registerApplyHandlers} from '../../../lib/apply-handlers.js';
import {staleExtensionNote} from '../../../lib/extension-target.js';

const here = path.resolve(import.meta.dirname, '../../..');
const NOTE = 'Chrome runs Jobadabra extension 0.9.756, older than this app\'s 0.9.759: reload it once (chrome://extensions → ↻ on Jobadabra); from then on it updates itself.';

// Every runner the handlers call is a fake that records its call: nothing in this file may open a browser (a real applyOne once opened 3 tabs in the owner's Chrome, 7 Nov 2026; `calls` is the positive control).
const calls = [];
function handlers({note = NOTE, runner}) {
  const handles = new Map();
  registerApplyHandlers({DEMO: false, extensionGate: () => null, allowanceBlock: () => null, needsNotion: () => null, claudeConsent: async () => true, staleNote: () => note,
    applyRunner: {start: async () => { calls.push('start'); return {ok: true, message: 'started'}; }, applyOne: async () => { calls.push('applyOne'); return {ok: true, session: {id: 's1'}}; },
      openOne: () => { calls.push('openOne'); return {ok: true}; }, ...runner},
    ipcMain: {handle: (name, fn) => handles.set(name, fn)}, log: () => {}, here, toWindow: () => {}, track: () => {}, prepareKitFor: async () => ({}), startClaude: () => ({}),
    getRecipeReporter: () => null, cloud: {}, storage: {settings: () => ({apply: {mode: 'fill', chosenAt: 'c1'}})}});
  return handles;
}

test('Apply on one job and an Apply batch in Chrome say the extension is old; a current copy says nothing', async () => {
  const old = handlers({});
  assert.equal((await old.get('applyOne')({}, 'https://jobs.example.test/a', {})).extensionNote, NOTE);
  assert.equal((await old.get('apply')({}, {n: 2, mode: 'chrome'})).extensionNote, NOTE);
  const current = handlers({note: ''});
  assert.equal((await current.get('applyOne')({}, 'https://jobs.example.test/a', {})).extensionNote, '');
  assert.deepEqual(calls, ['applyOne', 'start', 'applyOne'], 'only the fakes ran');
});

test('a start that failed, and the hidden browser (its own extension copy), carry no note', async () => {
  const failed = handlers({runner: {applyOne: async () => ({ok: false, error: 'no link'})}});
  assert.deepEqual(await failed.get('applyOne')({}, 'https://jobs.example.test/a', {}), {ok: false, error: 'no link'});
  const hidden = handlers({});
  assert.equal((await hidden.get('apply')({}, {n: 1, mode: 'settings'})).extensionNote, undefined, 'Background automation runs in the app\'s own browser');
});

// Review of this change: a store copy is published before the app updates, so a copy AHEAD of the app is current enough and never called "older".
test('the note is for a copy strictly older than the app: not a newer one, not the same, not an unknown one', () => {
  assert.match(staleExtensionNote({version: '0.9.756', id: 'folder'}, '0.9.759'), /older than this app's 0\.9\.759/);
  assert.equal(staleExtensionNote({version: '0.9.760', id: 'store'}, '0.9.759'), '', 'a store copy ahead of the app');
  assert.equal(staleExtensionNote({version: '0.9.759'}, '0.9.759'), '');
  assert.equal(staleExtensionNote(null, '0.9.759'), '', 'the extension never checked in');
  assert.equal(staleExtensionNote({version: '0.9.756'}, ''), '', 'the app does not know its own version');
});
