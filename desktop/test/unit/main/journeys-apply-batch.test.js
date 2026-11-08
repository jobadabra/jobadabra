// Apply batch outcome journey: prepared, ineligible and failed jobs reach the dialog with their reasons.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as apply from '../../../lib/apply.js';
import * as terminals from '../../../lib/terminals.js';
import {sharedRead} from '../../../lib/shared-read.js';
import {applyDialogOutcome} from '../../../renderer/apply-dialog-model.js';
import {resultView} from '../../../renderer/apply-result-model.js';

test('scenario: a prepared Apply job refused by the background browser stays visible as not started', async () => {
  const jobs = [{code: '1', url: 'https://jobs.example.test/1', title: 'Fictional role', company: 'Example Air', status: 'saved', stage: 'Saved', fit: 90}];
  const result = await apply.start({}, {n: 1, mode: 'background', applyMode: 'fill'}, undefined, async () => ({jobs}), undefined, undefined,
    async () => { jobs[0].kit = true; return {ok: true}; }, undefined, {enqueue: async () => ({ok: false, error: 'Download Jobadabra\'s browser first.', outcomes: [{...jobs[0], status: 'not-started', reason: 'Download Jobadabra\'s browser first.'}]})});
  const dialog = applyDialogOutcome(result);
  assert.equal(dialog.close, false, 'the refusal keeps the outcome visible');
  const view = resultView(result);   // what the person reads: the refusal once, no per-row repeat
  assert.deepEqual(view.note, {text: 'Download Jobadabra\'s browser first.', tone: 'error'});
  assert.deepEqual(view.rows.map(row => row.reason), ['']);
  assert.deepEqual(dialog.outcomes.map(({status, reason}) => [status, reason]), [['not-started', 'Download Jobadabra\'s browser first.']]);
});

test('scenario: Apply keeps the captured ineligible opt-in from drafting through a hidden-browser queue item', async () => {
  let settings = {apply: {allowIneligible: true}};
  const storage = {settings: () => settings};
  const job = {code: 'fixture-job', url: 'https://jobs.example.test/ineligible', status: 'saved', stage: 'Kit ready', fit: 90, ineligible: 'needs a work permit'};
  const queued = [];
  const result = await apply.start(storage, {n: 1, mode: 'background', applyMode: 'fill'}, undefined, async () => ({jobs: [job]}), undefined, undefined,
    async () => { job.kit = true; settings = {apply: {allowIneligible: false}}; return {ok: true}; }, undefined,
    {enqueue: async (jobs, mode, eligibility) => { queued.push({jobs, mode, eligibility}); return {ok: true}; }});
  assert.equal(result.ok, true);
  assert.deepEqual(queued.map(item => [item.mode, item.eligibility.allowIneligible, item.jobs[0].url]), [['fill', true, job.url]]);
});

test('scenario: Apply answers after its job is marked Applying: a list read asked then is a fresh one, so the Jobs chips count it (#1737, 24 Oct 2026)', async () => {
  terminals._reset();
  const jobs = sharedRead('jobs', () => new Promise(() => {}));   // a read that began before the press, still running
  const running = jobs();
  const run = () => new Promise(resolve => setTimeout(() => resolve({}), 10));   // the engine's Stage write takes a moment
  const result = await apply.applyOne({}, 'https://jobs.example.test/apply-1737', {company: 'E2E'}, {open: () => ({unref() {}}), term: terminals, run, id: () => 'j1737', focus: () => {}});
  assert.equal(result.ok, true);
  assert.notEqual(jobs(), running, 'Apply answered while its Applying write was still running: the window re-read the old stage');
  terminals._reset();
});
