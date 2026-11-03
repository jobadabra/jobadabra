// Extra details are capped at 6 per job (MAX_EXTRA_PER_ROLE) and the rest were dropped without a word (Windows tester on 0.9.2, 3 Nov 2026, issue #3057:
// "My master CV shows 19 extra details, 9 of them on one role, but 3 can never reach tailoring, and the screen does not say so").
// Plays it: one other CV version with 9 new details for one job -> lib/experience.js view() lists the 3 left out, and the real page (pages/experience.js roleBlock) says so.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as cv from '../../../lib/cv.js';
import * as experience from '../../../lib/experience.js';
import {createStorage} from '../../../lib/storage.js';
import {install} from '../../tiny-dom.js';

install();
// Why (fx, 3 Nov 2026): importing a renderer page can start timers; unref-ed so the test process exits (see test/unit/renderer/cv-replace.test.js).
const realInterval = globalThis.setInterval;
globalThis.setInterval = (...args) => realInterval(...args).unref();
const doc = globalThis.document, found = doc.getElementById.bind(doc);
doc.getElementById = id => found(id) || Object.assign(doc.createElement('div'), {id});
globalThis.window.dispatchEvent = () => true;
globalThis.Event ??= class {};
globalThis.window.pilot = new Proxy({}, {get: (all, key) => all[key] || (async () => null)});
const {roleBlock} = await import('../../../renderer/pages/experience.js');

const NEW = Array.from({length: 9}, (_, i) => `Extra detail number ${i + 1}.`);
const MAIN = {name: 'Ada Example', skills: 'AWS', jobs: [{company: 'Acme', roles: [{title: 'SRE', period: '2024 – Present', place: 'Zurich', bullets: ['Ran incidents.']}]}]};
const OTHER = {name: 'Ada Example', skills: 'AWS', jobs: [{company: 'Acme', roles: [{title: 'SRE', period: '2024 – Present', place: 'Zurich', bullets: ['Ran incidents.', ...NEW]}]}]};
const MATCH = {roles: [{source_role: 0, main_job: 0, main_role: 0, new_bullets: NEW.map((_, i) => i + 1)}]};
const client = {messages: {create: async request => ({stop_reason: 'end_turn', usage: {input_tokens: 1, output_tokens: 1},
  content: [{type: 'text', text: JSON.stringify(/compare/.test(request.system) ? MATCH : OTHER)}]})}};
const pdf = () => { const file = path.join(os.tmpdir(), `cap-${Math.random().toString(36).slice(2)}.pdf`); fs.writeFileSync(file, `%PDF ${Math.random()}`); return file; };

const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-cap-')), {encrypt: v => v, decrypt: v => v});
fs.mkdirSync(cv.dir(storage), {recursive: true});
fs.writeFileSync(path.join(cv.dir(storage), 'cv.json'), JSON.stringify(MAIN));
await experience.addCv(storage, pdf(), 'Data CV', {client});

test('the view says which details a job had no room for, and what the cap is', () => {
  const view = experience.view(storage), role = view.roles[0];
  assert.equal(view.maxExtra, experience.MAX_EXTRA_PER_ROLE);
  assert.equal(role.bullets.filter(b => b.from !== 'Main CV').length, experience.MAX_EXTRA_PER_ROLE, 'six are used');
  assert.deepEqual(role.dropped.map(d => d.text), NEW.slice(experience.MAX_EXTRA_PER_ROLE), 'the other three are listed, in order');
  assert.ok(role.dropped.every(d => d.from === 'Data CV'), 'each names its version');
});

test('what tailoring reads is unchanged: the first six in order, and no new field on the role', () => {
  const role = experience.withExtras(storage, cv.baseCv(storage)).jobs[0].roles[0];
  assert.deepEqual(role.bullets.slice(1), NEW.slice(0, experience.MAX_EXTRA_PER_ROLE), 'the main CV bullet, then the first six extras');
  assert.equal(role.extra.length, experience.MAX_EXTRA_PER_ROLE);
  assert.equal(role.dropped, undefined, 'no new field leaks into the CV the tailor reads');
});

test('the same detail in two versions is one detail not used, not two', async () => {
  await experience.addCv(storage, pdf(), 'Cloud CV', {client});   // a second version carrying the same nine details
  const view = experience.view(storage);
  assert.equal(view.roles[0].dropped.length, 3, 'still three distinct details left out');
  assert.equal(view.roles[0].bullets.filter(b => b.from !== 'Main CV').length, experience.MAX_EXTRA_PER_ROLE);
});

test('the Work history row says "3 not used" and lists them, so nothing is dropped silently', () => {
  const view = experience.view(storage);
  const box = roleBlock({...view.roles[0], maxExtra: view.maxExtra});
  const text = box.textContent;
  assert.match(text, /3 not used/);
  assert.match(text, /at most 6 extra details per job/);
  for (const dropped of NEW.slice(6)) assert.ok(text.includes(dropped), `lists "${dropped}"`);
});

test('one detail left out reads "this one is", and a row without the cap says no number', () => {
  const one = roleBlock({company: 'Acme', title: 'SRE', bullets: [{text: 'Ran incidents.', from: 'Main CV'}], dropped: [{text: 'Mentored four engineers.', from: 'Data CV'}]}).textContent;
  assert.match(one, /1 not used/);
  assert.match(one, /so this one is left out/);
  assert.doesNotMatch(one, /these 1|\b6\b/, 'no plural slip and no hard-coded cap');
});
