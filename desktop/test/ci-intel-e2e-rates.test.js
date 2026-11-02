// admin/e2e-rates.js: the interactions suite's log -> rates for the night (owner via mac-07, 1 Nov 2026), and tools/ci-intel/jobs/e2e-intel-rows.mjs putting them on suiteNights.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {interactionRates, ratesOf} from '../../tools/ci-intel/lib/e2e-rates.mjs';
import {rateJobs, rowsOf} from '../../tools/ci-intel/jobs/e2e-intel-rows.mjs';
import {greyData, greySummary} from '../../tools/ci-intel/lib/e2e-grey.mjs';

const stamp = text => `2026-11-01T21:30:00.1Z ${text}`;
const LOG = [
  '  focus: 0 layout shift(s) after it was ready', '  jobs: 2 layout shift(s) after it was ready (1.2s score 0.050 by input .card)', '  ! [jobs] late-shift: a card pushed the list down',
  '  strategy: 0 layout shift(s) after it was ready', '  actions: 0 layout shift(s) after it was ready',
  '  focus: 20 controls pressed, 1 flagged, 3 left alone (a | b)', '  jobs: 30 controls pressed, 3 flagged, 0 left alone ()',
  '  recall: 7 of 8 planted bugs caught (missed: overlap)',
  // the retry repeats the red steps after the first try: never counted
  '  focus: 20 controls pressed, 20 flagged, 0 left alone ()', '  recall: 0 of 8 planted bugs caught'].map(stamp).join('\n');

test('the interactions log gives the share of controls not flagged, of pages that held still, and the recall, first try only', () => {
  assert.deepEqual(interactionRates(LOG), {clean: 0.92, still: 0.75, recall: 0.875});   // 46 of 50 not flagged; 3 of 4 pages still; 7 of 8
  assert.equal(interactionRates(''), null);
  assert.equal(interactionRates('nothing measured here'), null);
  assert.deepEqual(interactionRates(stamp('  recall: 0 of 8 planted bugs caught')), {recall: 0}, 'a recall of zero is a rate, not a missing one');
  assert.equal(ratesOf('wander', LOG), null, 'a suite without a reader has no rates');
});

test('every rate is a share the Grey card accepts (0..1), and a log cut before its lines gives only the rates it has', () => {
  for (const value of Object.values(interactionRates(LOG))) assert.ok(value >= 0 && value <= 1);
  assert.deepEqual(interactionRates(stamp('  focus: 20 controls pressed, 5 flagged, 0 left alone ()')), {clean: 0.75});
});

const job = (id, name, conclusion) => ({id, name, conclusion, steps: [{name: `Run the ${name} suite (first try)`, conclusion}]});
const run = (databaseId, kind, jobs) => ({databaseId, createdAt: '2026-11-01T21:01:00Z', updatedAt: '2026-11-01T21:20:00Z', headSha: 'a', headBranch: 'main', conclusion: 'success', kind, workflow: 'e2e.yml', jobs});

test('a night\'s interactions job (green or red) puts its rates on the suite night; other suites and other kinds carry none', async () => {
  const jobs = [job(7, 'interactions', 'success'), job(8, 'wander', 'success')];
  const logs = {7: LOG, 8: LOG};
  const rows = await rowsOf([run(90, 'scheduled', jobs), run(91, 'pr', jobs)], {logOf: id => logs[id] ?? null, commitsBetween: async () => [], filesBetween: async () => [], filesOf: async () => [], prFiles: async () => [], ask: async () => null});
  assert.deepEqual(rows.suiteNights.map(row => [row.suite, row.runId, row.rates || null]), [['interactions', 90, {clean: 0.92, still: 0.75, recall: 0.875}], ['wander', 90, null]]);
  assert.deepEqual(rateJobs(run(90, 'scheduled', jobs)), [{jobId: 7}], 'only the interactions job is read for rates, and only on a night run');
  assert.deepEqual(rateJobs(run(91, 'pr', jobs)), []);
  const unread = await rowsOf([run(92, 'scheduled', jobs)], {logOf: () => null});
  assert.equal(unread.suiteNights.find(row => row.suite === 'interactions').rates, undefined, 'a log that could not be read leaves the night without rates, never zeros');
});

test('the site keeps the rates and the Grey card shows the night with them', () => {
  const now = new Date('2026-11-02T10:00:00Z');
  const data = greyData({}, {lanes: {suites: {interactions: {lane: 'tolerant', input: 'clock', since: '2026-11-01', why: 'x'}}},
    suiteNights: [{runId: 90, day: '2026-11-01', kind: 'scheduled', suite: 'interactions', platform: 'mac', green: true, rates: {clean: 0.92, still: 0.75, recall: 0.875, bogus: 3}}]}, now);
  assert.deepEqual(data.suiteNights[0].rates, {clean: 0.92, still: 0.75, recall: 0.875}, 'a value outside 0..1 is dropped');
  assert.deepEqual(greySummary(data, now).rows[0].nights[0].rates, {clean: 0.92, still: 0.75, recall: 0.875});
});
