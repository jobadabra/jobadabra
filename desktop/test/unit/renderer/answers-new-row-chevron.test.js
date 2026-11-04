// Profile → What we learned: pressing the chevron (or the bar) of a New question must not crash the list (issue #3152; AI user agent replays 41857211406 and 41857218091, 4 Nov 2026:
// "TypeError: field is not a function" at application-answers.js:103, then "1 of 1 open" over an empty list). A New row has no answer control of its own: its review is the drawer.
// Guard: ui — without it a New question's chevron throws inside the redraw and the whole What we learned list goes blank.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from '../../tiny-dom.js';

const body = install();
const DETAIL = {key: 'details:notice', question: 'Notice period', details: {kind: 'unclear', where: 'Availability', fact: 'Notice period'}};

globalThis.localStorage = {getItem: () => null, setItem: () => {}};
globalThis.window.pilot = new Proxy({
  textOutline: async name => ({ok: true, items: name === 'answers' ? [{id: 'h1', type: 'heading_2', text: 'Eligibility'}, {id: 'e1', type: 'bulleted_list_item', text: 'Authorised to work in Switzerland?: Yes, B permit'}] : [], store: 'sqlite', link: null}),
  openQuestions: async () => ({details: [], learned: [{key: 'q1', question: 'Will you need sponsorship?'}, DETAIL], letter: null, hidden: [], consent: 0}),
}, {get: (all, key) => all[key] || (() => null)});

const node = globalThis.document.createElement('div');
node.id = 'answers-body';
body.append(node);
const layer = globalThis.document.createElement('div');   // the review drawer's own layer (pages/question-review.js shows it)
layer.id = 'review-drawer-layer';
layer.hidden = true;
body.append(layer);
const answers = await import('../../../renderer/pages/application-answers.js');
await answers.loadApplicationAnswers();
await new Promise(resolve => setTimeout(resolve, 20));
answers.searchAnswers('');
const view = key => node.querySelectorAll('.segmented button').find(button => button.dataset.view === key);
view('new').listeners.click[0]();

test('the chevron of a New question redraws the list, still whole, and opens the review drawer, not an editor', async () => {
  const rows = () => node.querySelectorAll('.qa-learned .qa-row');
  const before = rows().length;
  assert.equal(before, 2, 'the two New questions of the drawer\'s list');
  for (const chevron of node.querySelectorAll('.qa-learned .qa-chevron')) chevron.listeners.click[0]();   // throws "field is not a function" on the old code
  assert.equal(rows().length, before, 'the list is still drawn');
  assert.equal(node.querySelectorAll('.qa-learned .qa-edit').length, 0, 'no editor opens in the row');
  await new Promise(resolve => setTimeout(resolve, 50));   // the drawer module loads on the first press
  assert.equal(layer.hidden, false, 'the review drawer opened');
});
