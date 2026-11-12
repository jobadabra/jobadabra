// Work rights live only in Profile → Work eligibility (owner, 12 Nov 2026, #3850: "Work rights doesn't really make sense. They should be only in the Profile").
// The owner's scenario: the Profile says where the person may work, the Strategy searches elsewhere; the engine's copy (config/work-rights.json) comes from the
// Profile, and the older Strategy list moves into the Profile once, never lost on the way. Values are fictional.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../../../lib/storage.js';
import {registerDetailsFactsHandlers} from '../../../lib/details-facts-handlers.js';
import * as sections from '../../../lib/profile-sections.js';
import * as store from '../../../lib/store/index.js';
import {INSTRUCTIONS as OLDER} from '../../../lib/eligibility-older.js';
import {FILE, rightsOf, writeRights} from '../../../lib/work-rights.js';
import {LABEL, moveRights} from '../../../lib/work-rights-move.js';

const zone = (label, value) => ({label, value, kind: 'per_country'});
const fresh = () => { const s = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-rights-')), {encrypt: v => v, decrypt: v => v}); s.saveSettings({store: 'sqlite', profileMovedAt: '2026-10-01T00:00:00Z'}); return s; };
const kept = storage => JSON.parse(storage.readText(FILE));

test('freely clears the whole zone, a permit only the person\'s own places (a zone, never zone words), sponsorship nothing; the nationality counts', () => {
  const got = rightsOf([{label: 'Nationality', value: 'Moldova'}, zone('EU / EEA + Switzerland', 'yes, with a permit'), zone('United Kingdom', 'yes, freely'),
    zone('United States', 'no, needs sponsorship')]);
  assert.deepEqual(got.work_rights, ['Moldova', 'United Kingdom']);
  assert.deepEqual(got.permit_zones, ['EU / EEA + Switzerland']);
  assert.ok(!got.work_rights.includes('EU'), 'a Swiss permit gives no right to work in Germany');
  assert.deepEqual(rightsOf([{label: 'Nationality', value: 'Romania'}]).work_rights, ['Romania', 'EU', 'Switzerland', 'Norway', 'Iceland', 'Liechtenstein'], 'a citizenship opens its zone');
  assert.deepEqual(rightsOf([{label: LABEL, value: 'Swiss B permit'}]).unread, [`${LABEL}: Swiss B permit`], 'an older line not folded yet is kept');
});

test('before the move, a Profile save keeps the older Strategy list in the engine\'s copy; after it, the Profile alone', () => {
  const storage = fresh();
  storage.writeText('config/preferences.json', JSON.stringify({work_rights: ['\\beu\\b']}));
  writeRights(storage, [zone('United States', 'yes, freely')]);
  assert.deepEqual(kept(storage).work_rights, ['United States', 'eu']);
  storage.saveSettings({workRightsMovedAt: '2026-11-12T00:00:00Z'});
  writeRights(storage, [zone('United States', 'yes, freely')]);
  assert.deepEqual(kept(storage).work_rights, ['United States']);
});

test('the move adds each older right to Work eligibility once, a copy first, read back; a second run adds nothing', async () => {
  const storage = fresh();
  storage.writeText('config/preferences.json', JSON.stringify({work_rights: ['\\beu\\b', 'Canada']}));
  await store.openStore(storage).page('profile').write('## 🛂 Work eligibility\n- Nationality: United Kingdom\n');
  const copies = [];
  assert.equal(await moveRights(storage, {copy: async () => copies.push((await sections.read(storage)).eligibility.length)}), 2);
  assert.deepEqual(copies, [1], 'the copy holds the section as it was');
  assert.deepEqual((await sections.read(storage)).eligibility.filter(line => line.label === LABEL).map(line => line.value), ['eu', 'Canada']);
  assert.ok(kept(storage).unread.length === 2, 'the engine reads them while they wait for the fold');
  assert.equal(await moveRights(storage), 0);
});

test('owner\'s scenario on open: the rights fold into the zones, an answered zone stays, a right outside them is dropped, the engine follows the Profile', async () => {
  const storage = fresh();
  storage.writeText('config/preferences.json', JSON.stringify({work_rights: ['\\beu\\b', 'Canada']}));
  storage.writeText('config/search.json', JSON.stringify({locations: {country_wide: ['germany']}}));
  await store.openStore(storage).page('profile').write('## 🛂 Work eligibility\n- Nationality: United Kingdom\n- EU / EEA + Switzerland: yes, with a permit [per country]\n');
  const fold = {lines: [{id: '0', about: 'eligibility', nationality: [], rows: [{row: 'eu', status: 'yes, freely'}]}, {id: '1', about: 'eligibility', nationality: [], rows: []}]};
  const client = {messages: {create: async request => { if (request.system === OLDER) return {content: [{type: 'text', text: JSON.stringify(fold)}]}; throw new Error('not this test'); }}};
  const handlers = {};
  registerDetailsFactsHandlers({ipcMain: {handle: (name, fn) => { handlers[name] = (...args) => fn(null, ...args); }}, storage, DEMO: false, connected: () => true,
    needsNotion: () => null, log: () => {}, ai: () => ({client}), copy: async () => {}});
  await handlers.detailsFacts();
  const lines = (await sections.read(storage)).eligibility;
  assert.equal(lines.find(line => line.label === 'EU / EEA + Switzerland')?.value, 'yes, with a permit', 'the person\'s own answer is never overwritten');
  assert.deepEqual(lines.filter(line => line.label === LABEL), [], 'both older lines folded; Canada fits no zone and is dropped');
  const rights = kept(storage);
  assert.deepEqual(rights.permit_zones, ['EU / EEA + Switzerland']);
  assert.ok(rights.work_rights.includes('United Kingdom') && !rights.work_rights.includes('Canada') && !rights.work_rights.includes('eu'));
  assert.deepEqual(rights.unread, []);
});

test('a failed write of the engine\'s copy never fails the Profile read or save: it is logged and returns false (#3862 review)', () => {
  const storage = fresh();
  const broken = {...storage, settings: storage.settings, readText: storage.readText, writeText: () => { throw new Error('ENOSPC: no space left'); }};
  assert.equal(writeRights(broken, [zone('United States', 'yes, freely')]), false);
});
