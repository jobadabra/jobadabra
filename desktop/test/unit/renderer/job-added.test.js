// After "Add a job" or "Applied elsewhere" worked (renderer/pages/job-added.js): the dialog closes and the added job's drawer opens; a dialog that must stay
// open (Applied elsewhere asks for the posting's text) gets an "Open job" button in its actions row, never a link run on inside the result text.
// Why (owner, 14 Nov 2026, on a screenshot of "fit 35/100, tier C Open job →": "bad UI" · "It should feel like a button" · "it should close the popup and open the job drawer with the added job when finished"
// · "we should get a toast notification and the job drawer shuold be opened").
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {afterAdded, clearOpenJob} from '../../../renderer/pages/job-added.js';

// A dialog with a result line and an actions row (Close, Add it), as index.html draws #import-dialog and #applied-dialog.
function dialog() {
  const el = (cls, children = []) => ({className: cls, children, dataset: {}, listeners: {}, removed: false,
    addEventListener(kind, fn) { this.listeners[kind] = fn; }, remove() { this.removed = true; }});
  const message = el('message ok', ['Added · Example role — Example GmbH · fit 35/100']);
  const actions = el('actions', [el('ghost'), el('primary')]);
  actions.insertBefore = (node, before) => actions.children.splice(actions.children.indexOf(before), 0, node);
  const d = {open: true, message, actions, close() { this.open = false; },
    querySelector: sel => (sel === '.actions' ? actions : sel === '[data-open-job]' ? actions.children.find(c => 'openJob' in c.dataset && !c.removed) || null : null)};
  return d;
}
const job = {url: 'https://jobs.example.test/1', title: 'Example role'};
const button = () => ({dataset: {}, listeners: {}, removed: false, addEventListener(kind, fn) { this.listeners[kind] = fn; }, remove() { this.removed = true; }});

test('when the job is added the dialog closes, a toast says the result and the job\'s drawer opens, with nothing to press', () => {
  const d = dialog(), opened = [], said = [];
  afterAdded({dialog: d, job, openJob: one => opened.push(one), button, label: 'Open job', say: () => said.push('toast')});
  assert.deepEqual(said, ['toast'], 'one toast with the result');
  assert.equal(d.open, false, 'the popup closed');
  assert.deepEqual(opened, [job], 'the added job\'s drawer opened');
  assert.deepEqual(d.message.children, ['Added · Example role — Example GmbH · fit 35/100'], 'nothing appended to the result text');
});

test('a dialog that stays open shows "Open job" as a button in its actions row, not inside the result text', () => {
  const d = dialog(), opened = [];
  afterAdded({dialog: d, job, openJob: one => opened.push(one), button, label: 'Open job', stay: true});
  assert.equal(d.open, true);
  const open = d.actions.children[0];
  assert.equal(open.className, 'secondary', 'the app\'s follow-up button, first in the row before Close and Track it');
  assert.equal(open.textContent, 'Open job');
  assert.equal(d.message.children.length, 1, 'the result text has no link run on');
  open.listeners.click();
  assert.deepEqual([d.open, opened], [false, [job]], 'pressed: the popup closes and the drawer opens');
});

test('a second result never leaves the first job\'s button behind', () => {
  const d = dialog();
  afterAdded({dialog: d, job, openJob() {}, button, label: 'Open job', stay: true});
  clearOpenJob(d);   // the dialog opened again, or a new link is being added
  assert.equal(d.querySelector('[data-open-job]'), null);
  afterAdded({dialog: d, job: {url: 'https://jobs.example.test/2'}, openJob() {}, button, label: 'Open job', stay: true});
  assert.equal(d.actions.children.filter(c => 'openJob' in c.dataset && !c.removed).length, 1, 'one button, for the newest job');
});

test('a worked add whose result names no job still closes with its toast, and opens no drawer or button', () => {
  const d = dialog(), opened = [], said = [];
  afterAdded({dialog: d, job: null, openJob: one => opened.push(one), button, label: 'Open job', say: () => said.push('toast')});
  assert.deepEqual([said, d.open, opened], [['toast'], false, []], 'toast, closed, no drawer for a job it cannot name');
  const s = dialog();
  assert.equal(afterAdded({dialog: s, job: null, openJob: one => opened.push(one), button, label: 'Open job', stay: true}), null);
  assert.equal(s.actions.children.length, 2, 'no "Open job" button that would open nothing');
});
