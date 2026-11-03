// The read step's "nothing read it yet" check waits for the store's fresh copy of its job, never the saved list the Jobs page paints first after a reload.
// Main run 41558018005 (b4d6411): the submit step left this form's job Applied, the page painted that saved row first, and since #3026 its chip says N/A;
// "any chip" took it, so the step said "the job already had a chip before any read". The next run, with the same step code, was green.
import assert from 'node:assert/strict';
import {test} from 'node:test';

const {chipBeforeRead} = await import('../../lib/apply-read-steps.mjs');
const STALE = {stage: 'Applied', chip: 'N/A'}, FRESH = {stage: 'Saved', chip: 'Not checked'};
// A wait that is accepted returns at once, so its cap is only a hang guard (a loaded Mac never trips it); the one that must run out has a short cap.
const wait = {capMs: 10000, tickMs: 5, log: () => {}}, runsOut = {...wait, capMs: 100};
/** A read that answers each value in turn, then keeps answering the last one. */
const reads = (...values) => { let index = 0; return async () => values[Math.min(index++, values.length - 1)]; };

test('the saved list\'s Applied row painted first is waited past: the fresh Saved row is the one judged', async () => {
  await chipBeforeRead(reads(STALE, STALE, {stage: 'Saved', chip: ''}, FRESH), wait);
});

test('a fresh Saved row that already shows a read fails and names its chip', async () => {
  await assert.rejects(chipBeforeRead(reads(STALE, {stage: 'Saved', chip: 'You review and submit'}), wait),
    error => { assert.equal(error.message, 'the job already had a chip before any read: "You review and submit"'); return true; });
});

test('a list that never shows the job as Saved fails with the last row it saw', async () => {
  await assert.rejects(chipBeforeRead(reads(STALE), runsOut),
    error => { assert.equal(error.message, 'the Jobs list never showed the fixture job as Saved, last seen {"stage":"Applied","chip":"N/A"}'); return true; });
});
