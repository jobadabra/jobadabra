// Owner, 7 Nov 2026 (Apply on one job opened a visible Chrome tab while the saved mode was Background automation; coordinator: "Follow the saved mode"): the Apply button on one job
// starts like the batch does. Background or Full automation queues the job for the hidden browser; Standard automation opens Chrome. Every runner here is a fake that records its call.
import assert from 'node:assert/strict';
import path from 'node:path';
import {test} from 'node:test';
import {registerApplyHandlers} from '../../../lib/apply-handlers.js';
import {applyOne} from '../../../lib/apply.js';

const here = path.resolve(import.meta.dirname, '../../..');
const calls = [];
function handlers(savedMode, {gate = () => { calls.push('extensionGate'); return null; }} = {}) {
  const handles = new Map();
  registerApplyHandlers({DEMO: false, extensionGate: gate, allowanceBlock: () => null, needsNotion: () => null, claudeConsent: async () => true, staleNote: () => '',
    applyRunner: {applyOne: async (_storage, url, details, options) => { calls.push(['applyOne', options?.hidden?.applyMode || 'chrome']); return {ok: true, session: {id: 's1'}}; }, openOne: () => ({ok: true})},
    ipcMain: {handle: (name, fn) => handles.set(name, fn)}, log: () => {}, here, toWindow: () => {}, track: () => {}, prepareKitFor: async () => ({}), startClaude: () => ({}),
    getRecipeReporter: () => null, cloud: {}, storage: {settings: () => ({apply: {mode: savedMode, chosenAt: 'c1'}})}});
  return handles;
}

test('the Apply button on one job hands the saved hidden-browser mode to the runner and asks for no Chrome extension; Standard automation does neither', async () => {
  calls.length = 0;
  for (const mode of ['fill', 'auto']) assert.equal((await handlers(mode).get('applyOne')({}, 'https://jobs.example.test/a', {})).background, true, 'the window is told it was queued');
  assert.deepEqual(calls, [['applyOne', 'fill'], ['applyOne', 'auto']], 'no extension gate for the hidden browser, which carries its own copy');
  calls.length = 0;
  assert.equal((await handlers('check').get('applyOne')({}, 'https://jobs.example.test/a', {})).background, undefined);
  assert.deepEqual(calls, ['extensionGate', ['applyOne', 'chrome']], 'Standard automation still needs the extension and opens Chrome');
});

test('applyOne in a hidden-browser mode queues the job like the batch does and opens nothing', async () => {
  const queued = [], released = [];
  const refusing = () => { throw new Error('a hidden-browser press must not open Chrome or a session'); };
  const result = await applyOne({}, 'https://jobs.example.test/a#top', {title: 'Lead', company: 'Acme', location: 'Berlin', workMode: 'remote'}, {
    hidden: {applyMode: 'fill', enqueue: async (jobs, mode) => { queued.push([jobs, mode]); return {ok: true, mode, sessions: ['s1'], message: '1 application queued in the background.'}; }},
    open: refusing, focus: refusing, term: {list: refusing, startForm: refusing, remove: refusing}, run: refusing, release: async job => { released.push(job); throw new Error('enqueue drops an ended run itself'); }});
  assert.deepEqual(queued, [[[{url: 'https://jobs.example.test/a', title: 'Lead', company: 'Acme', location: 'Berlin', workMode: 'remote'}], 'fill']]);
  assert.deepEqual(released, [], 'as in the batch, an ended run is dropped by enqueue (dropFinished), after its checks pass, not before');
  assert.equal(result.message, '1 application queued in the background.');
  assert.deepEqual(await applyOne({}, 'not a link', {}, {hidden: {applyMode: 'fill', enqueue: refusing}}), {ok: false, error: 'This job has no link to open.'});
});
