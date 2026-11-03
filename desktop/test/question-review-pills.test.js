// The Review drawer's source pill and answer-kind line for a Your details item (a Windows tester's finance profile, 3 Nov 2026: a contact field read "Needed by every form" whatever
// the AI rated it; Gitar on #3043: the first fix also replaced every other kind's pill). A contact detail's two lines follow its rating; every other kind keeps its own source words.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

const body = install();
const ids = ['questions', 'questions-count', 'questions-details', 'questions-error', 'questions-retry', 'questions-review', 'learned', 'learned-count', 'learned-review', 'review-drawer-layer', 'review-drawer-backdrop', 'review-panel'];
for (const id of ids) { const node = globalThis.document.createElement('div'); node.id = id; body.append(node); }
const SOURCES = {which: 'Two copies disagree', unclear: 'Unclear', cvcheck: 'Read from your CV'};
const item = (key, details) => ({key, question: `Q ${key}`, company: '', hint: '', format: {kind: 'text', control: 'text', options: []}, details});
const LIST = [
  item('details:contact:a', {kind: 'contact', source: 'Asked by forms', importance: 3}),
  item('details:contact:b', {kind: 'contact', source: 'Asked by forms', importance: 2}),
  ...Object.entries(SOURCES).map(([kind, source]) => item(`details:${kind}:x`, {kind, source})),
];
globalThis.window.pilot = new Proxy({openQuestions: async () => ({details: LIST, learned: [], hidden: [], consent: 2, dismissed: {details: [], learned: []}})},
  {get: (all, key) => all[key] || (() => null)});
const review = await import('../renderer/pages/question-review.js');
const {ASKS} = await import('../renderer/question-nav.js');
const text = selector => body.querySelector(selector)?.textContent || '';

test('a contact detail\'s pill and answer-kind line follow its rating; the other kinds keep their own source words', async () => {
  const seen = {};
  for (const entry of LIST) {
    await review.openQuestionReview({queue: 'details', start: entry.key});
    seen[entry.key] = [text('.qr-asked .ui-pill'), text('.qr-answer-kind')];
  }
  assert.deepEqual(seen['details:contact:a'], ['Needed by every form', 'Needed by every form']);
  assert.deepEqual(seen['details:contact:b'], ['Asked by many forms', 'Asked by many forms']);
  for (const [kind, source] of Object.entries(SOURCES)) assert.deepEqual(seen[`details:${kind}:x`], [source, ASKS[kind]], kind);
});
