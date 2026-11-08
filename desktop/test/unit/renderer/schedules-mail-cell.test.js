// Settings → Automation → Schedules draws Find jobs' e-mail switch in the "E-mail me" cell (pages/mail-switches.js drawSlots, owner 8 Nov 2026: V1): the column exists only while a mail row is shown, the cell is never hidden (a hidden cell leaves the grid), and a refused save says so under the table.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from '../../tiny-dom.js';

const body = install();
const make = (tag, props = {}) => Object.assign(globalThis.document.createElement(tag), props);
const panel = make('div', {id: 'setting-schedule'}), head = make('div', {className: 'is-head'}), headCell = make('span', {className: 'mail-cell', textContent: 'E-mail me'});
const cell = make('span', {className: 'mail-cell'}), note = make('p', {id: 'schedule-mail-note', hidden: true});
cell.dataset.mailSlot = 'app-matches';
head.append(headCell); panel.append(head, cell, note); body.append(panel);

const rows = () => ({ok: true, mode: 'always', where: 'From Always on: on schedule, even with your Mac off.', macWhere: 'From your Mac', rows: [{id: 'app-matches', name: 'New matches', when: 'a search finds new jobs', on: true}]});
const state = {read: async () => rows(), set: async () => ({ok: true})};
globalThis.window.pilot = {state: async () => ({}), mailChoices: () => state.read(), mailChoiceSet: (...args) => state.set(...args)};
const {showMailSwitches} = await import('../../../renderer/pages/mail-switches.js');

test('a mail row draws one plain switch in the cell, the column turns on, and the sentence is its tooltip, not a line', async () => {
  await showMailSwitches();
  assert.equal(panel.classList.contains('has-mail'), true);
  assert.equal(cell.hidden, false, 'a hidden cell would leave the grid and shift Status left');
  const track = cell.children[0];
  assert.equal(track.tagName, 'SPAN', 'a span: the global label margin would push a label-switch off the row centre');
  assert.match(track.title, /When a search finds new jobs\. From Always on/);
  assert.equal(track.children[0].checked, true);
  assert.equal(note.hidden, true);
});

test('hidden mail switches take the column away: no has-mail, an empty cell, no words', async () => {
  state.read = async () => ({ok: true, hidden: true, rows: []});
  await showMailSwitches();
  assert.equal(panel.classList.contains('has-mail'), false);
  assert.equal(cell.children.length, 0);
  assert.equal(note.hidden, true);
  state.read = async () => rows();
});

test('a refused save puts the switch back and says so under the table, then clears when the next press works', async () => {
  await showMailSwitches();
  state.set = async () => ({ok: false, error: 'Add your e-mail address first.'});
  cell.children[0].children[0].dispatch('change');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(note.hidden, false);
  assert.match(note.textContent, /Add your e-mail address first/);
  assert.equal(cell.children[0].children[0].checked, true, 'back where it was');
  state.set = async () => ({ok: true});
  cell.children[0].children[0].dispatch('change');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(note.hidden, true);
});
