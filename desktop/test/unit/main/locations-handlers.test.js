// "Which locations are right?" over IPC (owner, 17 Oct 2026): the first read moves the Profile's places in once and lists the conflicts, a pick is written and
// read back and says "Your search changed", no AI means nothing moves and it is tried again, an unknown choice is refused, demo shows one fictional conflict.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {withDisplay} from '../../../i18n/display-values.js';
import {setLocale} from '../../../i18n/index.js';
import {createStorage} from '../../../lib/storage.js';
import * as store from '../../../lib/store/index.js';
import {registerLocationsHandlers} from '../../../lib/locations-handlers.js';
import {sharedRead} from '../../../lib/shared-read.js';

const PROFILE = '## Hard constraints\n\n| Constraint | Value |\n|---|---|\n| Countries | Switzerland (anywhere) |\n| Home base | Zurich |\n';
const SEARCH = {locations: {top_tier: [], country_wide: ['netherlands', 'germany'], abroad: []}};
const GOOD = {client: {messages: {create: async () => ({content: [{type: 'text', text: JSON.stringify({preferred: [], acceptable: ['Switzerland'], relocation: 'unspecified', destinations: []})}]})}}};

async function harness({ai = () => ({}), DEMO = false, settings = {store: 'sqlite'}, backup = () => ({file: 'backup.zip'})} = {}) {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-locw-')), {encrypt: v => v, decrypt: v => v});
  storage.saveSettings(settings);
  await store.openStore(storage).page('profile').write(PROFILE);
  storage.writeText('config/search.json', JSON.stringify(SEARCH));
  const handlers = {}, logged = [];
  registerLocationsHandlers({ipcMain: {handle: (name, fn) => { handlers[name] = (...args) => fn(null, ...args); }}, storage, DEMO, needsNotion: () => null,
    settingsDeps: null, log: (...line) => logged.push(line), ai, backup});   // never the real backup folders
  return {storage, handlers, logged};
}

test('no AI: nothing moves, nothing is marked, the next read tries again', async () => {
  const {storage, handlers} = await harness();
  const got = await handlers.locationsWhich();
  assert.deepEqual(got.conflicts, []);
  assert.equal(storage.settings().locationsMovedAt, undefined);
});

test('the first read moves once, lists the conflict, a pick closes it and says the search changed', async () => {
  const {storage, handlers, logged} = await harness({ai: () => GOOD});
  const got = await handlers.locationsWhich();
  assert.equal(got.error, '');
  assert.equal(got.conflicts.length, 1);
  assert.equal(got.conflicts[0].kind, 'acceptable');
  assert.ok(storage.settings().locationsMovedAt);
  assert.deepEqual(logged[0].slice(0, 2), ['strategy', 'places moved into Locations']);
  assert.ok(!JSON.stringify(logged).includes('Switzerland'), 'counts only, never a place');
  await handlers.locationsWhich();
  assert.equal(logged.length, 1, 'never moves twice');
  assert.deepEqual(await handlers.resolveLocationConflict('acceptable', 'nonsense'), {ok: false, error: 'Unknown choice'});
  assert.equal(storage.settings().searchChangedAt, undefined);
  assert.equal((await handlers.resolveLocationConflict('acceptable', 'profile')).ok, true);
  assert.deepEqual(JSON.parse(storage.readText('config/search.json')).locations.country_wide, ['Switzerland']);
  assert.ok(storage.settings().searchChangedAt);
  assert.deepEqual((await handlers.locationsWhich()).conflicts, []);
});

test('demo shows one fictional conflict and writes nothing', async () => {
  const {storage, handlers} = await harness({DEMO: true});
  assert.equal((await handlers.locationsWhich()).conflicts.length, 1);
  assert.deepEqual(await handlers.resolveLocationConflict('acceptable', 'profile'), {ok: true});
  assert.deepEqual(JSON.parse(storage.readText('config/search.json')), SEARCH);
});

// Why (4 Nov 2026, code review of the Locations redraw): the page reloads Strategy right after a pick, and `strategyData` is a sharedRead. A read asked while an
// older one runs joins it, so a read that began before the pick came back with the OLD places and the section stayed stale (the reporter's symptom again).
// The two writes close that join (afterWrite, shared-read.js), as the Focus and Interviews writes do (#325).
test('a pick and an Undo each close the running reads\' join: the reload after them starts its own read', async () => {
  const {handlers} = await harness({ai: () => GOOD});
  await handlers.locationsWhich();
  const slow = () => {
    let runs = 0, release;
    const gate = new Promise(resolve => { release = resolve; });
    return {read: sharedRead('strategyData', async () => { runs += 1; await gate; return runs; }), release: () => release(), runs: () => runs};
  };
  const pick = slow(), first = pick.read();
  assert.equal((await handlers.resolveLocationConflict('acceptable', 'profile')).ok, true, 'the pick was written (positive control)');
  const second = pick.read();
  pick.release();
  await Promise.all([first, second]);
  assert.equal(pick.runs(), 2, 'a read asked after the pick did not join the one that began before it');

  const entry = (await handlers.locationsWhich()).setAside[0];
  assert.ok(entry, 'the pick set a value aside (positive control)');
  const undone = slow(), began = undone.read();
  assert.equal((await handlers.undoSetAside(entry.id)).ok, true, 'the Undo was written (positive control)');
  const after = undone.read();
  undone.release();
  await Promise.all([began, after]);
  assert.equal(undone.runs(), 2, 'a read asked after the Undo did not join the one that began before it');
});

test('actual Locations IPC projects a tagged error after logging its canonical text', async t => {
  const forbidden = [];
  t.mock.method(globalThis, 'fetch', () => { forbidden.push('network'); throw Error('No live service'); });
  const raw = 'Fictional this Mac Keychain ⌘K {path}', canonical = 'canonical Locations diagnostic';
  const error = withDisplay(new Error(canonical), 'storeError.locationsVerify', {fields: 'acceptable', path: raw});
  try {
    setLocale('ru');
    const {handlers, logged} = await harness({ai: () => GOOD, backup: () => { throw error; }});
    const got = await handlers.locationsWhich();
    assert.notEqual(got.error, canonical);
    assert.ok(got.error.startsWith('Перенос мест:'), got.error);
    assert.ok(got.error.includes(raw));
    assert.equal(logged.find(line => line[1] === 'the Locations move stopped')[2].error, canonical);
    assert.equal(error.message, canonical);
    assert.deepEqual(forbidden, []);
  } finally { setLocale('en'); }
});
