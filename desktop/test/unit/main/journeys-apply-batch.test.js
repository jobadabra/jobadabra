// Apply batch outcome journey: prepared, ineligible and failed jobs reach the dialog with their reasons.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as apply from '../../../lib/apply.js';
import {applyDialogOutcome} from '../../../renderer/apply-dialog-model.js';

test('scenario: a mixed Apply batch keeps each attempted job and reason available for inspection', async () => {
  const jobs = [1, 2, 3].map(number => ({code: String(number), url: `https://jobs.example.test/${number}`, title: `Fictional role ${number}`, company: 'Example Air', status: 'saved', stage: 'Saved', fit: 90 - number}));
  const enqueued = [];
  const result = await apply.start({}, {n: 3, mode: 'background', applyMode: 'fill'}, undefined, async () => ({jobs}), undefined, undefined,
    async code => {
      const job = jobs.find(row => row.code === code);
      if (code === '2') { job.kit = true; job.ineligible = 'Required credential missing.'; return {ok: true, ineligible: job.ineligible}; }
      if (code === '3') return {ok: false, error: 'The application kit could not be saved.'};
      job.kit = true; return {ok: true};
    }, undefined, {enqueue: async selected => {
      enqueued.push(...selected.map(job => job.url));
      return {ok: true, message: '1 application queued.', outcomes: selected.map(job => ({url: job.url, title: job.title, company: job.company, status: 'started', reason: ''}))};
    }});
  const dialog = applyDialogOutcome(result);
  assert.deepEqual(enqueued, [jobs[0].url], 'only the eligible job enters the background queue');
  assert.equal(dialog.close, false, 'the dialog keeps mixed results inspectable');
  assert.deepEqual(dialog.outcomes.map(({status, reason}) => [status, reason]), [
    ['started', ''], ['ineligible', 'Required credential missing.'], ['failed', 'The application kit could not be saved.'],
  ]);
});
