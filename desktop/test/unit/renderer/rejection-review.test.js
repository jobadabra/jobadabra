// The rejection review shared by the Jobs menu and "Add job activity" (owner, 13 Nov 2026: a rejection's feedback also starts the AI review).
// Plays the owner's scenario: feedback saved on a Rejected job starts one review; not when a review exists or the job is not Rejected; never twice at once.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from '../../tiny-dom.js';

install();
const calls = [];
let answer = {ok: true, text: '❌ Why rejected: Hard skills'}, gate = Promise.resolve();
globalThis.window.pilot = {reviewRejection: async url => { calls.push(url); await gate; if (answer instanceof Error) throw answer; return answer; }};
const {reviewDue, runRejectionReview} = await import('../../../renderer/pages/rejection-review.js');

const job = (extra = {}) => ({url: 'https://jobs.example.test/a', stage: 'Rejected', employer_feedback: 'We needed deeper Go.', rejection: '', ...extra});
const harness = () => { const toasts = [], reloads = []; return {toasts, reloads, toast: (...args) => toasts.push(args), reload: () => reloads.push(1)}; };

test('a review is due only for a Rejected job holding feedback and no review yet', () => {
  assert.equal(reviewDue(job()), true);
  assert.equal(reviewDue(job({rejection: 'Hard skills'})), false, 'already reviewed');
  assert.equal(reviewDue(job({stage: 'Applied'})), false, 'not rejected');
  assert.equal(reviewDue(job({employer_feedback: ''})), false, 'no feedback');
  assert.equal(reviewDue(undefined), false);
});

test('a good review is read once, said in a toast and reloads the jobs', async () => {
  calls.length = 0; answer = {ok: true, text: '❌ Why rejected: Hard skills'};
  const h = harness();
  assert.equal(await runRejectionReview(job(), h), true);
  assert.deepEqual(calls, ['https://jobs.example.test/a']);
  assert.equal(h.toasts.length, 1);
  assert.equal(h.toasts[0][3], 'good');
  assert.equal(h.reloads.length, 1);
});

test('a second start while the same job is under review reads nothing more', async () => {
  calls.length = 0; answer = {ok: true, text: 'done'};
  let release; gate = new Promise(done => { release = done; });
  const first = runRejectionReview(job(), harness());
  const second = await runRejectionReview(job(), harness());   // the menu pressed while the dialog's review runs
  assert.equal(second, false);
  release(); gate = Promise.resolve();
  await first;
  assert.deepEqual(calls, ['https://jobs.example.test/a'], 'one review, not two');
  assert.equal(await runRejectionReview(job(), harness()), true, 'free again once it ended');
});

test('a review that throws is a bad toast, never an unhandled rejection, and frees the job', async () => {
  calls.length = 0; answer = new Error('engine gone');
  const h = harness();
  assert.equal(await runRejectionReview(job({url: 'https://jobs.example.test/b'}), h), true);
  assert.equal(h.toasts[0][3], 'bad');
  assert.match(h.toasts[0][1], /engine gone/);
  assert.equal(h.reloads.length, 0);
  answer = {ok: true, text: 'ok'};
  assert.equal(await runRejectionReview(job({url: 'https://jobs.example.test/b'}), harness()), true, 'not stuck busy after the failure');
});
