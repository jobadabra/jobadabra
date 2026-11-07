// The card for the owner's answer to a feedback (renderer/pages/feedback-reply.js): what it says for a fix and for a "not now", and that the markup and the bridge are wired.
import {readScreenSource} from '../../static-screen-source.js';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {cardText} from '../../../renderer/feedback-reply-text.js';

const read = file => readScreenSource(new URL(`../../../${file}`, import.meta.url), 'utf8');
const fixed = {ref: 'a1b2c3d4e5f60718', on: '2026-10-28', excerpt: 'The CV upload hangs', kind: 'fixed', message: 'Fixed in 0.9.12. Thank you.', arrival: 'It arrives in 0.9.12.'};

test('a fix says what was written, the owner\'s line and when it arrives', () => {
  const text = cardText(fixed);
  assert.equal(text.title, 'Your feedback was fixed');
  assert.match(text.said, /^You wrote on .+: "The CV upload hangs"$/);
  assert.equal(cardText({...fixed, on: ''}).said, 'You wrote: "The CV upload hangs"');
  assert.equal(text.answer, 'Fixed in 0.9.12. Thank you.');
  assert.equal(text.tone, 'good');
});

test('the arrival line is not said twice when the owner\'s own line already names the version', () => {
  assert.equal(cardText({...fixed, message: 'Fixed in 0.9.12. Thank you.', arrival: 'It arrives in 0.9.12.'}).answer, 'Fixed in 0.9.12. Thank you.');
  assert.equal(cardText({...fixed, message: 'Thank you.', arrival: 'It arrives in 0.9.12.'}).answer, 'Thank you. It arrives in 0.9.12.');
});

test('a "not now" is a thank-you in the info tone with no arrival line', () => {
  const text = cardText({...fixed, kind: 'deferred', message: 'Noted: not now.', arrival: ''});
  assert.deepEqual([text.title, text.tone, text.answer], ['Your feedback was heard', 'info', 'Noted: not now.']);
});

test('the window holds the container and the bridge the page uses', () => {
  assert.match(read('renderer/index.html'), /<div id="feedback-replies" hidden><\/div>/);
  assert.match(read('renderer/app.js'), /await feedbackReply\(\)/);
  assert.match(read('preload.cjs'), /feedbackReplies: call\('feedbackReplies'\), feedbackReplyClose: call\('feedbackReplyClose'\)/);
});

test('the window asks the main process at least as often as the main process retries a failed ask (a 15-minute retry that is asked for hourly is an hour)', () => {
  const minutes = (file, name) => { const [, a, b = 1] = read(file).match(new RegExp(`${name} = (\\d+) \\* 60(?: \\* (\\d+))? \\* 1000`)) || []; return Number(a) * Number(b); };
  const poll = minutes('renderer/pages/feedback-reply.js', 'EVERY'), retry = minutes('lib/app-feedback-replies.js', 'RETRY');
  assert.ok(poll > 0 && retry > 0, 'both intervals are found');
  assert.ok(poll <= retry, `window polls every ${poll} min, retry is ${retry} min`);
});
