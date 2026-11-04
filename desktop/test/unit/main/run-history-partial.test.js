// #3108: a Find jobs run cut at the 3-minute limit must not reach the person as "Find jobs done · No jobs added this time" through the pop-up, nor as an "OK" row when the app writes
// the run's row itself; the pill and cards say Partial (renderer/run-status.js), so these say it too. Scenario: 2 of 14 employer sites read, nothing added.
import test from 'node:test';
import assert from 'node:assert/strict';
import {localRow, notice} from '../../../lib/run-history.js';

const run = {id: 1, kind: 'search', ok: true, new: 0, startedAt: '2026-11-03T11:35:00Z', endedAt: '2026-11-03T11:38:00Z', endedByTime: true,
  log: ['Employers: read 2 of 14 sites in the time, best first; the other 12 are read first next time.']};

test('the pop-up for a search cut at the limit says so, with the count', () => {
  const said = notice(run);
  assert.equal(said.title, 'Find jobs ended at the time limit');
  assert.match(said.body, /^Partial: ended at the 3-minute limit, 2 of 14 sites searched/);
  assert.doesNotMatch(said.body, /No jobs added this time/);
  assert.equal(notice({...run, endedByTime: false}).title, 'Find jobs done', 'positive control: the same run that finished');
});

test('a row the app writes for it is not "OK"', () => {
  assert.equal(localRow(run).properties.Status.select.name, 'Warnings');
  assert.equal(localRow({...run, endedByTime: false}).properties.Status.select.name, 'OK', 'positive control');
});
