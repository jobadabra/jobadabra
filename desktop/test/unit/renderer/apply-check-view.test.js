// The check panel of a held Full automation batch ([fa] 2/2, spec docs/superpowers/specs/2026-11-07-full-automation-check-first.md): what the person sees and what Confirm sends.
// Guard: safety — the Full automation jobs Confirm sends are exactly the app's split's auto group; a job still unchecked, unreadable or needing details is never among them.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {applyDialogStart, checkView, mergeHeld} from '../../../renderer/apply-dialog-model.js';
import {splitBatch, urlsOf} from '../../../renderer/apply-split.js';

const simple = {eligible: true, captcha: false, login: false, accountCreation: false, simple: true, why: '', questions: ['Full name'], match: {missing: [], unjudged: 0}};
const JOBS = ['a', 'b', 'c', 'd', 'e'].map(id => ({url: `https://jobs.check-view.example/${id}`, title: `Fictional Role ${id}`, company: `Fictional Co ${id}`, read: null}));
const READS = [simple, simple, {...simple, match: {missing: [{kind: 'detail', label: 'Phone number'}], unjudged: 0}}, {...simple, simple: false, captcha: true, why: 'captcha'}, null];
const all = new Map(JOBS.map((job, i) => [job.url, READS[i]]));

test('the split of a 5-job batch: 2 automatic, 1 Background, 1 in Chrome, 1 not applied; Confirm sends only the automatic ones', () => {
  const view = checkView({plan: 'p', jobs: JOBS}, all);
  assert.deepEqual(view.groups.map(group => [group.key, group.rows.map(row => row.url)]), [['auto', [JOBS[0].url, JOBS[1].url]], ['fill', [JOBS[2].url]], ['check', [JOBS[3].url]], ['none', [JOBS[4].url]]]);
  assert.deepEqual(view.autoUrls, urlsOf(splitBatch(JOBS, url => all.get(url) || null).auto), 'the same split the app checks Confirm against');
  assert.equal(view.title, 'We can apply to 2 jobs automatically');
  assert.deepEqual(view.lines, ['The other 2 need another way.', '1 could not be read.', 'Nothing is queued until you confirm.']);
  assert.equal(view.confirmLabel, 'Apply to 4 jobs');
  assert.match(view.groups[1].rows[0].chip.detail, /Phone number/, 'a Background row names the missing detail');
});

test('while the check runs, an unchecked job is never automatic and its row has no chip yet', () => {
  const view = checkView({plan: 'p', jobs: JOBS}, new Map([[JOBS[0].url, simple]]));
  assert.deepEqual([view.seen, view.total, view.done], [1, 5, false]);
  assert.deepEqual(view.rows.map(row => !!row.chip), [true, false, false, false, false]);
  assert.deepEqual(view.autoUrls, [JOBS[0].url]);
});

test('a read that gave nothing or could not see the form is "Couldn\'t read" with its reason; the batch\'s own eligibility choice is kept', () => {
  const view = checkView({plan: 'p', jobs: JOBS.slice(0, 2)}, new Map([[JOBS[0].url, null], [JOBS[1].url, {unreadable: true, why: 'timeout'}]]));
  assert.deepEqual(view.groups[3].rows.map(row => row.chip.label), ["Couldn't read", "Couldn't read"]);
  assert.equal(view.title, 'None of these can apply automatically');
  assert.equal(view.startable, 0);
  assert.deepEqual(view.lines, ['2 could not be read.', 'None of these forms can be applied in this batch.']);
  const ineligible = new Map([[JOBS[0].url, {...simple, eligible: false}]]);
  assert.deepEqual(checkView({plan: 'p', jobs: JOBS.slice(0, 1)}, ineligible).autoUrls, []);
  assert.deepEqual(checkView({plan: 'p', allowIneligible: true, jobs: JOBS.slice(0, 1)}, ineligible).autoUrls, [JOBS[0].url], 'picked with "Apply to jobs marked not eligible"');
});

test('Start passes the app\'s held batch through to the dialog, so its check is shown before any outcome', async () => {
  const held = {ok: true, mode: 'auto', check: {plan: 'p1', allowIneligible: false, jobs: JOBS}};
  assert.deepEqual(await applyDialogStart({count: '5', start: async () => held}), held);
});

test('nothing automatic: the lines say how many need another way, without "the other"', () => {
  const view = checkView({plan: 'p', jobs: JOBS.slice(2)}, new Map(JOBS.slice(2).map((job, i) => [job.url, READS[i + 2]])));
  assert.equal(view.title, 'None of these can apply automatically');
  assert.deepEqual(view.lines, ['2 need another way.', '1 could not be read.', 'Nothing is queued until you confirm.']);
});

test('the dialog keeps what Start already said (a kit that could not be prepared) beside Confirm\'s answer; Cancel still refreshes the list', () => {
  const held = {ok: true, check: {plan: 'p'}, outcomes: [{url: 'k', status: 'failed', reason: 'The kit could not be prepared'}, {url: JOBS[0].url, status: 'prepared'}]};
  const confirmed = {ok: true, outcomes: [{url: JOBS[0].url, status: 'started'}], message: '1 application started.'};
  assert.deepEqual(mergeHeld(held, confirmed).outcomes.map(item => [item.url, item.status]), [['k', 'failed'], [JOBS[0].url, 'started']], 'Confirm\'s word wins for a job both name');
  assert.deepEqual(mergeHeld(held, {cancelled: true}), {cancelled: true, outcomes: held.outcomes});
  assert.deepEqual(mergeHeld({ok: true, check: {plan: 'p'}}, {ok: false, error: 'The check changed while you looked.'}), {ok: false, error: 'The check changed while you looked.'});
});
