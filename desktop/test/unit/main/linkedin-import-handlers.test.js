// "Import from LinkedIn" over IPC (lib/linkedin-import-handlers.js): the whole press with a stand-in LinkedIn, a stand-in site socket and a fake store: sign-in, reads, the AI match,
// the rows, ticking, and that nothing is saved before it. Recorded-shape fixtures only (test/fixtures/linkedin-snapshot.json), never the live API, never the real Keychain.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {receive as handedOver} from '../../../lib/oauth-handoff.js';
import {registerLinkedinImportHandlers} from '../../../lib/linkedin-import-handlers.js';
import * as experience from '../../../lib/experience.js';

const FIXTURE = JSON.parse(fs.readFileSync(new URL('../../fixtures/linkedin-snapshot.json', import.meta.url), 'utf8'));
const TOKEN = 'AQV-fake-dma-token-1234567890';
const json = (body, status = 200) => new Response(JSON.stringify(body), {status});

const MAIN = {jobs: [{company: 'Acme', roles: [{title: 'Product Manager', period: '2021 – Present', bullets: ['Led the pricing relaunch']}]}], skills: 'SQL'};
// The AI answers the experience bank's match: LinkedIn role 0 is Acme's Product Manager with one new bullet.
const client = {messages: {create: async () => ({stop_reason: 'end_turn', usage: {input_tokens: 1, output_tokens: 1}, content: [{type: 'text', text: JSON.stringify({roles: [
  {source_role: 0, main_job: 0, main_role: 0, new_bullets: [1]}, {source_role: 1, main_job: -1, main_role: -1, new_bullets: []}, {source_role: 2, main_job: -1, main_role: -1, new_bullets: []}]})}]})}};
const fixtureFetcher = calls => async url => {
  calls.push(String(url));
  const u = new URL(url);
  const page = FIXTURE[u.searchParams.get('domain')]?.[Number(u.searchParams.get('start') || 0)];
  return page ? json(page) : json({message: 'No data found for this memberId'}, 404);
};

const NOW = new Date('2026-11-03T09:00:00Z');   // pinned: a held key is valid one day from here, whatever the real date

async function rig({main = null, fetcher = null, held = false} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'li-import-'));
  let settings = {};
  const storage = {settings: () => settings, saveSettings: patch => { settings = {...settings, ...patch}; }, path: name => path.join(dir, name), secret: () => ''};
  if (main) {
    const {dir: cvDir} = await import('../../../lib/cv.js');
    fs.mkdirSync(cvDir(storage), {recursive: true});
    fs.writeFileSync(path.join(cvDir(storage), 'cv.json'), JSON.stringify(main));
  }
  const handlers = {}, sent = [], saved = [], calls = [], items = new Map(), contact = {first_name: 'Anna', location: 'Vienna'};
  if (held) { items.set('jobadabra.linkedin.dma_token', TOKEN); settings = {linkedinImport: {connectedAt: NOW.toISOString(), expiresAt: new Date(NOW.getTime() + 86400000).toISOString()}}; }
  const keychain = {write: (s, v) => { items.set(s, v); return true; }, read: s => items.get(s) ?? null, remove: s => { items.delete(s); }};
  registerLinkedinImportHandlers({DEMO: false, ipcMain: {handle: (name, fn) => { handlers[name] = fn; }}, storage, deps: {keychain, fetcher: fetcher || fixtureFetcher(calls), sleep: async () => {}, now: NOW},
    openExternal: url => { const state = new URL(url).searchParams.get('state'); calls.push('SIGN-IN'); setImmediate(() => handedOver('linkedin-import', new URLSearchParams({state, access_token: TOKEN, expires_in: '5184000'}))); },
    sendStep: (channel, payload) => sent.push([channel, payload]), aiOf: () => ({apiKey: '', client}),
    readContact: async () => ({...contact}), saveContact: async contact => { saved.push(contact); }});
  return {handlers, storage, sent, saved, items, calls, contact, cleanup: () => fs.rmSync(dir, {recursive: true, force: true})};
}

test('an import signs in, reads the five domains here, shows rows and saves NOTHING until rows are ticked', async t => {
  const r = await rig({main: MAIN});
  t.after(r.cleanup);
  const answer = await r.handlers.linkedinImportRun({}, {});
  assert.equal(answer.ok, true, JSON.stringify(answer));
  assert.deepEqual(answer.review.positions.map(p => [p.label, p.chip]), [['Product Manager · Acme', 'new-bullets'], ['Associate Product Manager · Acme', 'new'], ['Data Analyst · Northwind', 'new']]);
  assert.deepEqual(answer.review.details.map(d => [d.field, d.chip, d.ticked]), [['last_name', 'new', true], ['location', 'differs', false], ['street', 'new', true], ['postal_code', 'new', true], ['website', 'new', true]], 'first name is the same and left out; Vienna vs Wien, Austria differs and is unticked')
  assert.equal(r.items.get('jobadabra.linkedin.dma_token'), TOKEN, 'the key went to the Keychain');
  assert.ok(!JSON.stringify(answer).includes(TOKEN) && !JSON.stringify(r.sent).includes(TOKEN), 'the key is in no answer and no step');
  assert.deepEqual(experience.list(r.storage), [], 'nothing saved before a row is ticked');
  assert.deepEqual(r.saved, []);
  const applied = await r.handlers.linkedinImportApply({}, ['p:1:0', 'd:postal_code']);
  assert.deepEqual([applied.ok, applied.positions, applied.details], [true, 1, 1]);
  assert.deepEqual(experience.list(r.storage).map(s => s.kind), ['linkedin']);
  assert.deepEqual(r.saved, [{first_name: 'Anna', location: 'Vienna', postal_code: '1010'}], 'only the ticked value, merged into what they have');
  assert.equal((await r.handlers.linkedinImportApply({}, ['p:1:0'])).ok, false, 'a second apply has nothing held');
});

test('Update uses the kept key with no sign-in; with no main CV the CV step builds it', async t => {
  const r = await rig({held: true});
  t.after(r.cleanup);
  const answer = await r.handlers.linkedinImportRun({}, {update: true});
  assert.equal(answer.ok, true, JSON.stringify(answer));
  assert.equal(answer.mainless, true);
  assert.ok(!r.calls.includes('SIGN-IN') && r.calls.every(url => url.startsWith('https://api.linkedin.com/rest/memberSnapshotData')), 'no sign-in was opened: only LinkedIn\'s reads');
  const applied = await r.handlers.linkedinImportApply({}, ['p:0:0', 's:0']);
  assert.equal(applied.mainless, true);
  assert.deepEqual(experience.list(r.storage), [], 'no main CV: nothing goes to the bank (PR 3/3 builds the CV from `cv`)');
  assert.ok(applied.cv.jobs.length === 1 && applied.cv.skills);
  assert.equal(applied.cv.name, 'Anna Rossi', 'the CV carries the person\'s name: buildCvSave names the file from it');
});

test('a key LinkedIn refuses is deleted and the press ends with the reason; a 429 stops and is not retried', async t => {
  const calls = [];
  const r = await rig({held: true, fetcher: async url => { calls.push(String(url)); return json({message: 'x'}, 401); }});
  t.after(r.cleanup);
  const answer = await r.handlers.linkedinImportRun({}, {update: true});
  assert.deepEqual([answer.ok, answer.stopped], [false, 'unauthorized']);
  assert.equal(r.items.size, 0, 'a refused key is deleted');
  assert.equal(r.storage.settings().linkedinImport, null);
  assert.equal(calls.filter(url => url.startsWith('https://api.linkedin.com')).length, 1, 'one read, no retry');
  const limited = await rig({held: true, fetcher: async () => json({}, 429)});
  t.after(limited.cleanup);
  assert.equal((await limited.handlers.linkedinImportRun({}, {update: true})).stopped, 'rate');
  assert.equal(limited.items.size, 1, 'a 429 keeps the key');
});

// The independent review (3 Nov 2026): an Update that ticks one row must not delete what an earlier import saved, rows already imported are not offered again, a Your details
// line the person filled in since the review is not overwritten, and a cancelled run saves nothing.
test('a second import keeps the first: nothing already imported is offered again and nothing is deleted', async t => {
  const r = await rig({main: MAIN});
  t.after(r.cleanup);
  const first = await r.handlers.linkedinImportRun({}, {});
  await r.handlers.linkedinImportApply({}, ['p:0:0', 'p:1:0', ...first.review.skills.map(s => s.id), ...first.review.languages.map(l => l.id)]);   // Product Manager, Data Analyst, skills, languages
  const again = await r.handlers.linkedinImportRun({}, {update: true});
  assert.deepEqual(again.review.positions.map(p => p.label), ['Associate Product Manager · Acme'], 'only the role never ticked is still new');
  assert.deepEqual([again.review.skills.length, again.review.languages.length], [0, 0]);
  await r.handlers.linkedinImportApply({}, ['p:0:1']);
  const sources = experience.list(r.storage).filter(s => s.kind === 'linkedin');
  assert.equal(sources.length, 1, 'still one LinkedIn source');
  const roles = sources[0].cv.jobs.flatMap(j => j.roles.map(x => x.title));
  assert.deepEqual(roles.sort(), ['Associate Product Manager', 'Data Analyst', 'Product Manager'], 'the first import is still there');
  assert.ok(sources[0].cv.skills.includes('Looker'), 'its skills too');
  assert.equal(sources[0].match.length, roles.length, 'one match entry per role');
});

test('a Your details line filled in after the review is not overwritten; a cancelled run saves nothing', async t => {
  const r = await rig({main: MAIN});
  t.after(r.cleanup);
  await r.handlers.linkedinImportRun({}, {});
  r.contact.postal_code = '5020';   // typed after the review, in a line that was empty then
  const applied = await r.handlers.linkedinImportApply({}, ['d:postal_code', 'd:street']);
  assert.deepEqual([applied.ok, applied.details], [true, 1]);
  assert.deepEqual(r.saved, [{first_name: 'Anna', location: 'Vienna', postal_code: '5020', street: r.saved[0].street}], 'their own postal code stays; the street (still empty) is added');
  assert.ok(r.saved[0].street, 'the street came in');
  const c = await rig({main: MAIN});
  t.after(c.cleanup);
  await c.handlers.linkedinImportRun({}, {});
  await c.handlers.linkedinImportCancel({}, {});
  assert.equal((await c.handlers.linkedinImportApply({}, ['d:postal_code'])).ok, false, 'a cancelled run left nothing to add');
});
