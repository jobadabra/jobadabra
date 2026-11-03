// The Windows tester's steps (0.9.2, 3 Nov 2026): Profile → Experience → Your background, press Edit on Education (a table's rows) and on "What I told the AI",
// type, Save all changes. In Electron querySelectorAll returns a NodeList, which has no .map: the old editors threw `row.querySelectorAll(...).map is not a
// function` (experience-editors.js:33 and :107) and the save bar froze. tiny-dom's realNodeLists mode returns that NodeList, so the test fails the same way.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

const body = install({realNodeLists: true});
const PROFILE = [
  {id: 'h1', type: 'heading_1', text: 'Summary (from CV)'}, {id: 's1', type: 'paragraph', text: 'Finance and accounting lead, 8 years.'},
  {id: 'h3', type: 'heading_1', text: 'Education'},
  {id: 't1', type: 'table', header: true, rows: [{id: 'r0', cells: ['School', 'Degree', 'Discipline']}, {id: 'r1', cells: ['Example University', 'MSc', 'Accounting']}]},
  {id: 'h4', type: 'heading_1', text: 'What I told the AI'},
  {id: 'w1', type: 'paragraph', text: 'I prefer audit roles.'}, {id: 'w2', type: 'paragraph', text: 'No travel over 20%.'},
];
const sent = [];
globalThis.window.pilot = new Proxy({textOutline: async () => ({ok: true, items: PROFILE, store: 'sqlite'}),
  textEdit: async (name, changes) => { sent.push([name, changes]); return {ok: true, items: PROFILE}; }}, {get: (all, key) => all[key] || (() => null)});
const page = await import('../renderer/pages/experience-profile.js');
const {profileBar} = await import('../renderer/pages/profile-save-bar.js');

const all = (node, selector) => [...node.querySelectorAll(selector)];
const cardOf = (node, key) => all(node, 'details.qa-fold').find(each => each.dataset.part === key);
const press = (node, key) => cardOf(node, key).querySelector('button.card-edit').listeners.click[0]({preventDefault() {}});
const type = (input, value) => { input.value = value; input.dispatch('input'); };

test('Edit on Education (table rows) and on "What I told the AI" opens the editor; typing then Save all changes writes it', async () => {
  const node = globalThis.document.createElement('div');
  node.id = 'exp-profile';
  body.replaceChildren(node);
  await page.loadExperienceProfile('experience');
  const keys = all(node, 'details.qa-fold').map(card => card.dataset.part);
  assert.ok(keys.includes('education') && keys.some(key => key.startsWith('section:')), `both cards are on the tab: ${keys}`);
  const told = keys.find(key => key.startsWith('section:'));
  for (const key of ['education', told]) {
    assert.doesNotThrow(() => press(node, key), `Edit on ${key} must open its editor`);
    assert.ok(all(cardOf(node, key), 'input').length, `${key} shows its fields`);
  }
  assert.equal(profileBar().count(), 0, 'opened, nothing typed: no change');
  type(all(cardOf(node, 'education'), 'input')[0], 'Example University of Oslo');
  type(all(cardOf(node, told), 'input')[0], 'I prefer audit and tax roles.');
  assert.equal(profileBar().count(), 2);
  const saved = await profileBar().saveAll();
  assert.equal(saved.ok, true, JSON.stringify(saved));
  assert.equal(sent.length, 1, 'one write');
  assert.deepEqual(sent[0][1].map(change => change.id), ['r1', 'w1']);
});

test('Discard all after a table-row edit still answers', async () => {
  const node = globalThis.document.createElement('div');
  node.id = 'exp-profile';
  body.replaceChildren(node);
  await page.loadExperienceProfile('experience');
  press(node, 'education');
  type(all(cardOf(node, 'education'), 'input')[0], 'Changed');
  assert.equal(profileBar().count(), 1);
  assert.equal(profileBar().discardAll({ask: false}), true);
  assert.equal(profileBar().count(), 0);
});

test('Discard all after a "What I told the AI" edit drops it and the card closes', async () => {
  const node = globalThis.document.createElement('div');
  node.id = 'exp-profile';
  body.replaceChildren(node);
  await page.loadExperienceProfile('experience');
  const told = all(node, 'details.qa-fold').map(card => card.dataset.part).find(key => key.startsWith('section:'));
  press(node, told);
  type(all(cardOf(node, told), 'input')[0], 'Changed');
  assert.equal(profileBar().count(), 1);
  assert.equal(profileBar().discardAll({ask: false}), true);
  assert.equal(profileBar().count(), 0);
  assert.equal(all(cardOf(node, told), 'input').length, 0, 'back to the read view');
});
