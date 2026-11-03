// Remove on a CV version (Windows tester on 0.9.2, 3 Nov 2026, issue #3056): "deletes immediately, with no confirmation or undo. One misclick loses a
// version, and the list rows move up after each removal, so repeated clicks hit the next version." Drives the REAL page (pages/experience.js showExperience)
// over a fake app: a press asks first, naming the version; "No" removes nothing; "Yes" removes that one version.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from '../../tiny-dom.js';

install();
// Why (fx, 3 Nov 2026): importing a renderer page can start timers; unref-ed so the test process exits (see test/cv-replace.test.js).
const realInterval = globalThis.setInterval;
globalThis.setInterval = (...args) => realInterval(...args).unref();
const doc = globalThis.document, found = doc.getElementById.bind(doc);
doc.getElementById = id => {
  let node = found(id);
  if (!node) { node = doc.createElement('div'); node.id = id; doc.body.append(node); }
  return node;
};
globalThis.window.dispatchEvent = () => true;   // showExperience tells Focus and the Jobs bar (#2397)
globalThis.Event ??= class {};
const removed = [];
globalThis.window.pilot = new Proxy({experienceRemove: async id => { removed.push(id); return {ok: false, error: 'stop here'}; }}, {get: (all, key) => all[key] || (async () => null)});
const asked = [];
let answer = false;
globalThis.confirm = text => { asked.push(text); return answer; };
const {showExperience} = await import('../../../renderer/pages/experience.js');

const source = (id, name) => ({id, kind: 'cv', name, addedAt: '2026-10-08T09:00:00Z', stale: false, roles: 3, added: 2, onlyHere: []});
const view = {main: {name: 'Ada Example', roles: 2, skills: 'AWS'}, sources: [source('a', 'Data CV'), source('b', 'Cloud CV')], roles: [], extraSkills: '', added: []};
const removeButtons = () => globalThis.document.getElementById('exp-versions').all().filter(node => node.tagName === 'BUTTON' && node.textContent === 'Remove');
const tick = () => new Promise(resolve => setImmediate(resolve));

test('pressing Remove on a CV version asks first, naming it, and removes nothing on "No"', async () => {
  showExperience(view);
  assert.equal(removeButtons().length, 2, 'the page draws a Remove per version');
  asked.length = 0; removed.length = 0; answer = false;
  removeButtons()[1].click();
  await tick();
  assert.equal(asked.length, 1, 'it asked');
  assert.match(asked[0], /Cloud CV/, 'and named the version the press was on');
  assert.deepEqual(removed, [], 'a "No" removes nothing');
});

test('"Yes" removes that version only', async () => {
  showExperience(view);
  asked.length = 0; removed.length = 0; answer = true;
  removeButtons()[0].click();
  await tick();
  assert.deepEqual(removed, ['a']);
});

test('the tester\'s repeated press: after a removal the rows move up, and the next press asks about the version now in that place', async () => {
  const after = {...view, sources: [view.sources[1]]};
  globalThis.window.pilot.experienceRemove = async id => { removed.push(id); return {ok: true, ...after, changes: {}}; };
  showExperience(view);
  asked.length = 0; removed.length = 0; answer = true;
  removeButtons()[0].click();
  await tick();
  assert.deepEqual(removed, ['a']);
  removeButtons()[0].click();
  await tick();
  assert.match(asked.at(-1), /Cloud CV/, 'the second press names the version that moved into that place, and asks again');
});

test('"Added by you" Remove asks first too (the same one-press delete)', async () => {
  const {addedBlock} = await import('../../../renderer/pages/experience.js');
  const gone = [];
  const [, list] = addedBlock([{id: 'k1', kind: 'skill', text: 'Kafka'}], id => gone.push(id));
  const button = list.all().find(node => node.tagName === 'BUTTON');
  answer = false; asked.length = 0;
  button.click();
  assert.deepEqual(gone, [], 'a "No" removes nothing');
  assert.match(asked[0], /Kafka/);
  answer = true;
  button.click();
  assert.deepEqual(gone, ['k1']);
});
