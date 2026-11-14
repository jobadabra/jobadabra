// A job's queue (owner, 14 Nov 2026, #4325: "The queue should have only the questions on this particular job. When it finishes… return back to the job apply readiness, or continue with other (general) questions" · "we bring the global pool"): the drawer opened with jobKeys shows only those, then a finish card.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from '../../tiny-dom.js';

const body = install();
const text = {kind: 'text', control: 'text', options: []};
const LIST = ['a', 'b', 'c', 'd'].map(key => ({key, question: `Question ${key}?`, company: 'Acme', format: text}));
const ids = ['questions', 'questions-count', 'questions-details', 'questions-error', 'questions-retry', 'questions-review', 'learned', 'learned-count', 'learned-review', 'review-drawer-layer', 'review-drawer-backdrop', 'review-panel'];
for (const id of ids) { const node = globalThis.document.createElement('div'); node.id = id; body.append(node); }
globalThis.localStorage = {getItem: () => null, setItem: () => {}};
const answered = new Set();
let DETAILS = [];   // Your details items (the job-wide scope test sets one)
let failRead = false;   // the store's read rejects (the IPC failed)
let reads = 0;   // the store's reads, failed ones included
globalThis.window.pilot = new Proxy({
  openQuestions: async () => { reads += 1; if (failRead) throw new Error('ipc down'); return {details: DETAILS.filter(q => !answered.has(q.key)).map(q => ({...q})), learned: LIST.filter(q => !answered.has(q.key)).map(q => ({...q})), hidden: [], consent: 0, dismissed: {details: [], learned: []}}; },
  answerQuestion: async key => { answered.add(key); return {ok: true, homeName: 'What we learned'}; },
}, {get: (all, key) => all[key] || (() => null)});
const {loadQuestions} = await import('../../../renderer/pages/jobs-questions.js');
const review = await import('../../../renderer/pages/question-review.js');
const slot = await import('../../../renderer/overlay-slot.js');
const $ = id => globalThis.document.getElementById(id);
const panel = () => $('review-panel');
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const labels = () => [...panel().querySelectorAll('button')].map(b => b.textContent.trim());
async function answerShown(value = 'x') {
  const field = panel().querySelector('#qr-control');
  field.value = value;
  field.dispatch('input');
  panel().querySelector('#qr-confirm').click();
  await flush(); await flush();
}
const asked = () => (panel().querySelector('.qr-question')?.textContent || '');

test('a job\'s queue shows only its questions; the last one answered shows the finish card with both buttons; Continue brings the global queue; Back calls onClose once', async () => {
  answered.clear();
  await loadQuestions({force: true});
  let closed = 0;
  await review.openQuestionReview({queue: 'learned', start: 'b', jobKeys: ['b', 'c'], onClose: () => { closed += 1; }});
  assert.match(panel().textContent, /Question 1 of 2/, 'only this job\'s two');
  assert.match(panel().textContent, /Fill this job's gaps/, 'a job\'s queue is named for what the person does (owner, 15 Nov 2026)');
  assert.equal(asked(), 'Question b?');
  await answerShown();
  assert.equal(asked(), 'Question c?', 'the next of the set, never a or d');
  await answerShown();
  assert.match(panel().textContent, /This job's questions are done/);
  assert.deepEqual(labels().filter(l => /Back to|Continue/.test(l)), ['Back to Apply readiness', 'Continue with the other questions']);
  assert.equal(closed, 0);
  [...panel().querySelectorAll('button')].find(b => /Continue/.test(b.textContent)).click();
  assert.match(panel().textContent, /Question 1 of 2/, 'the global queue: every open question (a, d)');
  assert.equal(asked(), 'Question a?');
  assert.equal(closed, 0, 'Continue does not leave the drawer');
  assert.doesNotMatch(panel().textContent, /Fill this job's gaps/, 'the global queue keeps its own title');
  review.closeQuestionReview();
  assert.equal(closed, 1);
});

test('Back closes the drawer and calls onClose once; with no other questions there is only Back', async () => {
  answered.clear();
  for (const key of ['a', 'd']) answered.add(key);
  await loadQuestions({force: true});
  let closed = 0;
  await review.openQuestionReview({queue: 'learned', start: 'b', jobKeys: ['b', 'c'], onClose: () => { closed += 1; }});
  await answerShown(); await answerShown();
  assert.deepEqual(labels().filter(l => /Back to|Continue/.test(l)), ['Back to Apply readiness'], 'nothing else is open');
  [...panel().querySelectorAll('button')].find(b => /Back to/.test(b.textContent)).click();
  assert.equal($('review-drawer-layer').hidden, true);
  assert.equal(closed, 1);
});

test('Fix all spans both drawers: the job\'s detail, then its question, and the finish card only after both (#4421 Gitar)', async () => {
  answered.clear();
  DETAILS = [{key: 'n', question: 'What is your nationality?', format: text, details: {kind: 'missing', where: 'Work eligibility', fact: 'Nationality'}}];
  await loadQuestions({force: true});
  await review.openQuestionReview({queue: 'details', start: 'n', jobKeys: ['n', 'b'], onClose: () => {}});
  assert.match(asked(), /nationality/i, 'Your details first');
  await answerShown();
  assert.equal(asked(), 'Question b?', 'then the job\'s question in the other drawer, never the finish card');
  assert.doesNotMatch(panel().textContent, /This job's questions are done/);
  await answerShown();
  assert.match(panel().textContent, /This job's questions are done/);
  review.closeQuestionReview();
  DETAILS = [];
});

test('a job\'s queue displaced by another overlay comes back as that job\'s queue (#4421 Gitar)', async () => {
  answered.clear();
  await loadQuestions({force: true});
  let closed = 0;
  await review.openQuestionReview({queue: 'learned', start: 'b', jobKeys: ['b', 'c'], onClose: () => { closed += 1; }});
  slot.registerOverlay('other', {close: () => {}, open: () => {}});
  slot.claimOverlay('other');
  slot.reopenOverlay('review');
  await flush(); await flush();
  assert.match(panel().textContent, /Question 1 of 2/, 'still only b and c');
  assert.match(panel().textContent, /Fill this job's gaps/);
  review.closeQuestionReview();
  assert.equal(closed, 2, 'away once, then the real close: the job drawer can come back');
});

test('a failed read after the job\'s last answer still shows the finish card: only Back, the failure named, never Continue (#4424/#4425 Gitar)', async () => {
  answered.clear();
  await loadQuestions({force: true});
  await review.openQuestionReview({queue: 'learned', start: 'b', jobKeys: ['b'], onClose: () => {}});
  failRead = true;
  const before = reads;
  await answerShown();
  await flush();
  failRead = false;
  assert.equal(reads, before + 1, 'the re-read was tried, once');
  assert.match(panel().textContent, /This job's questions are done/);
  assert.match(panel().textContent, /could not be read again/);
  assert.deepEqual(labels().filter(l => /Back to|Continue/.test(l)), ['Back to Apply readiness'], 'no Continue from a list that still holds the answered question');
  review.closeQuestionReview();
});
