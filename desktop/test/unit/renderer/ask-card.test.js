// The invitation card (renderer/pages/ask-card.js, PR 3/7 of docs/superpowers/specs/2026-11-05-report-instead-of-leaving-design.md): its words promise the 24 hour answer, and its buttons do what they say.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ASK_WORDS, answerAsk} from '../../../renderer/ask-card-text.js';

const bridge = () => { const calls = []; return {calls, pilot: {asksAnswer: async (...args) => { calls.push(args); }}, openFeedback: () => calls.push(['open'])}; };

test('every ask says it is read and answered within a day, and does not beg', () => {
  assert.deepEqual(Object.keys(ASK_WORDS).sort(), ['crashed', 'failed-application', 'failed-run', 'thin-search']);
  for (const [kind, words] of Object.entries(ASK_WORDS)) {
    assert.match(words.body, /write back within a day/, kind);
    assert.doesNotMatch(`${words.title} ${words.body}`, /please|sorry to bother|rate|review us/i, kind);
  }
});

test('"Tell us" records the answer and opens Send feedback; "Not now" only records it', () => {
  const tell = bridge(); answerAsk('failed-application', 'tell', tell);
  assert.deepEqual(tell.calls, [['failed-application', 'tell'], ['open']]);
  const later = bridge(); answerAsk('failed-application', 'later', later);
  assert.deepEqual(later.calls, [['failed-application', 'later']]);
});

test('an unknown ask or button does nothing', () => {
  const none = bridge();
  answerAsk('something-else', 'tell', none); answerAsk('failed-application', 'maybe', none);
  assert.deepEqual(none.calls, []);
});
