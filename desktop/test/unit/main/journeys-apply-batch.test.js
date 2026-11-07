// Apply batch outcome journey: prepared, ineligible and failed jobs reach the dialog with their reasons.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as apply from '../../../lib/apply.js';
import {applyDialogOutcome} from '../../../renderer/apply-dialog-model.js';

test('scenario: a prepared Apply job refused by the background browser stays visible as not started', async () => {
  const jobs = [{code: '1', url: 'https://jobs.example.test/1', title: 'Fictional role', company: 'Example Air', status: 'saved', stage: 'Saved', fit: 90}];
  const result = await apply.start({}, {n: 1, mode: 'background', applyMode: 'fill'}, undefined, async () => ({jobs}), undefined, undefined,
    async () => { jobs[0].kit = true; return {ok: true}; }, undefined, {enqueue: async () => ({ok: false, error: 'Download Jobadabra\'s browser first.', outcomes: [{...jobs[0], status: 'not-started', reason: 'Download Jobadabra\'s browser first.'}]})});
  const dialog = applyDialogOutcome(result);
  assert.equal(dialog.close, false, 'the refusal keeps the outcome visible');
  assert.equal(dialog.error, 'Download Jobadabra\'s browser first.');
  assert.deepEqual(dialog.outcomes.map(({status, reason}) => [status, reason]), [['not-started', 'Download Jobadabra\'s browser first.']]);
});
