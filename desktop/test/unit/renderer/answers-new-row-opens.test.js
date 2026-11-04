// #3152 (the AI user agent, a replay on main: "a New learned question leaves the list empty", `TypeError: field is not a function` at application-answers.js:103):
// a New row has no inline answer control (its button opens the review drawer), so its chevron and its bar must not open it in place. Scenario: What we learned shows
// one New question; the person presses its chevron (or the bar). The list stays drawn and the row stays one line.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from '../../tiny-dom.js';

const body = install();
for (const id of ['questions', 'questions-count', 'questions-details', 'questions-error', 'questions-retry', 'questions-review', 'questions-manage', 'review-drawer-layer', 'review-panel']) {
  const node = globalThis.document.createElement('div');
  node.id = id;
  body.append(node);
}
globalThis.localStorage = {getItem: () => null, setItem: () => {}};
globalThis.window.pilot = new Proxy({
  textOutline: async name => ({ok: true, items: name === 'answers' ? [{id: 'h1', type: 'heading_2', text: 'Eligibility'}, {id: 'e1', type: 'bulleted_list_item', text: 'Authorised to work in Switzerland?: Yes, B permit'}] : [], store: 'sqlite', link: null}),
  openQuestions: async () => ({details: [], learned: [{key: 'q1', question: 'Will you need sponsorship?'}], letter: null, hidden: [], consent: 0}),
}, {get: (all, key) => all[key] || (() => null)});

const node = globalThis.document.createElement('div');
node.id = 'answers-body';
body.append(node);
const answers = await import('../../../renderer/pages/application-answers.js');
await answers.loadApplicationAnswers();
await new Promise(resolve => setTimeout(resolve, 20));   // the queue's own read (jobs-questions.js), then the redraw it triggers
answers.searchAnswers('', 'new');
const newRows = () => node.querySelectorAll('.qa-learned .qa-row');

test('a New row is drawn (positive control), and pressing its chevron neither throws nor empties the list', () => {
  const before = newRows();
  assert.ok(before.length >= 1, 'the New row is on the page');
  const chevron = before[0].querySelector('.qa-chevron');
  assert.ok(chevron, 'the row has its chevron');
  assert.doesNotThrow(() => chevron.listeners.click[0]({currentTarget: chevron}));   // before the fix: TypeError: field is not a function
  assert.equal(newRows().length, before.length, 'the list is still drawn');
  assert.equal(node.querySelectorAll('.qa-edit').length, 0, 'no inline editor opened for a row that has none');
});

test('the chevron does what the row\'s button does: it opens the review drawer at that question', async () => {
  const layer = globalThis.document.getElementById('review-drawer-layer');
  layer.hidden = true;
  const chevron = newRows()[0].querySelector('.qa-chevron');
  chevron.listeners.click[0]({currentTarget: chevron});
  await new Promise(resolve => setTimeout(resolve, 30));   // the drawer module loads on the first press
  assert.equal(layer.hidden, false, 'the drawer opened');
});

test('pressing the row\'s bar does the same', async () => {
  const layer = globalThis.document.getElementById('review-drawer-layer');
  layer.hidden = true;
  const head = newRows()[0];
  const bar = head.listeners?.click?.[0];
  assert.ok(bar, 'the bar takes a click');
  assert.doesNotThrow(() => bar({target: head, currentTarget: head}));
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(layer.hidden, false, 'the drawer opened');
  assert.ok(newRows().length >= 1, 'the list is still drawn');
});

test('a confirmed row still opens in place next to a New row (the sibling case: only a row with no answer control changes)', () => {
  answers.searchAnswers('', 'all');
  const rows = () => node.querySelectorAll('.qa-learned .qa-row');
  const confirmed = rows().find(each => !each.querySelector('.qa-chevron') ? false : !/New/.test(each.textContent || ''));
  assert.ok(rows().length >= 2 && confirmed, 'a New row and a confirmed row are both on the page (positive control)');
  assert.equal(node.querySelectorAll('.qa-edit').length, 0, 'nothing is open yet');
  const chevron = confirmed.querySelector('.qa-chevron');
  chevron.listeners.click[0]({currentTarget: chevron});
  assert.equal(node.querySelectorAll('.qa-edit').length, 1, 'the confirmed row opened its editor in place');
});
