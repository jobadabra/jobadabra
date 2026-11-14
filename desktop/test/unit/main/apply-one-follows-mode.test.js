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

// Owner, 8 Nov 2026 (R2, "Yes, as drawn"): a mode picked in a job's ⋯ menu is that job's only. Settings is never written; Full automation carries the pick's own fresh confirmation, and with none it
// carries no stamp (Settings' unconfirmed mode lends none), so the hidden browser's queue refuses it (lib/background-apply-controller.js canQueue).
const NOW = Date.parse('2026-11-08T10:00:00.000Z');   // a fixed clock: the pick's confirmation is judged against it
function picking(savedMode) {
  const handles = new Map(), enqueued = [], opened = [], saved = [];
  registerApplyHandlers({DEMO: false, extensionGate: () => null, allowanceBlock: () => null, needsNotion: () => null, claudeConsent: async () => true, staleNote: () => '', clock: () => NOW,
    background: {enqueue: async (jobs, which, batch) => { enqueued.push([which, batch]); return {ok: true}; }, handle: () => ({}), cancelTriage: async () => {}},
    applyRunner: {applyOne: async (_storage, url, details, options) => (options?.hidden ? options.hidden.enqueue([{url}], options.hidden.applyMode) : (opened.push(url), {ok: true})), openOne: () => ({ok: true})},
    ipcMain: {handle: (name, fn) => handles.set(name, fn)}, log: () => {}, here, toWindow: () => {}, track: () => {}, prepareKitFor: async () => ({}), startClaude: () => ({}),
    getRecipeReporter: () => null, cloud: {}, storage: {settings: () => ({apply: {mode: savedMode, chosenAt: 'c1'}}), saveSettings: patch => saved.push(patch)}});
  return {press: (mode, autoConfirmedAt) => handles.get('applyOne')({}, 'https://jobs.example.test/a', {}, {mode, autoConfirmedAt}), enqueued, opened, saved};
}

test("a mode picked in the job's ⋯ menu runs that job in that mode and never writes Settings", async () => {
  const chrome = picking('check'), stamp = '2026-11-08T09:59:00.000Z';
  await chrome.press('fill');
  await chrome.press('auto', stamp);
  await chrome.press('auto', '');
  assert.deepEqual(chrome.enqueued, [['fill', {autoConfirmedAt: '', linkedinConfirmedAt: ''}], ['auto', {autoConfirmedAt: stamp, linkedinConfirmedAt: ''}], ['auto', {autoConfirmedAt: '', linkedinConfirmedAt: ''}]], 'the pick, with its own confirmation or none');
  assert.deepEqual(chrome.opened, [], 'a hidden-browser pick opens no Chrome tab');
  const hidden = picking('fill');
  await hidden.press('check');
  assert.deepEqual([hidden.opened, hidden.enqueued], [['https://jobs.example.test/a'], []], 'a Chrome pick opens Chrome though Settings says Background automation');
  await hidden.press('not-a-mode');
  assert.deepEqual(hidden.enqueued, [['fill', null]], 'an unknown pick follows the saved mode, as a press without one');
  assert.deepEqual([...chrome.saved, ...hidden.saved], [], 'Settings is never written');
});
