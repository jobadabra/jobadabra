// #3108 (a tester on 0.9.2, Windows): a Find jobs run that stopped at the 3-minute limit was a green "Completed" with "No jobs added to your list", as if the search
// had finished and found nothing. The verdict is the run's own (`endedByTime`, written once by lib/search-steps.js); the pill, the result card and the Find card only draw it.
// Scenario: the run read 2 of 14 employer sites in the time (the engine's own line), added nothing, and ended at the limit.
import test from 'node:test';
import assert from 'node:assert/strict';
import {runStatus, runWarned, runPill} from '../../../renderer/run-status.js';
import {cleanTop} from '../../../renderer/run-result-card.js';
import {findCard} from '../../../renderer/find-card-model.js';

const log = ['Searching job boards…', 'Employers: read 2 of 14 sites in the time, best first; the other 12 are read first next time.', 'Added 0 new job(s)'];
const run = {kind: 'search', ok: true, new: 0, log, endedByTime: true};

test('a search that ended at the limit is Partial in amber, never Completed', () => {
  assert.deepEqual(runPill(run), ['Partial', 'warn']);
  assert.deepEqual(runPill(run, {long: true}), ['Partial', 'warn'], 'the long pill keeps the word');
  assert.deepEqual(runStatus({...run, endedByTime: false}, false), ['Completed', 'good'], 'positive control: the same run that reached every site');
  assert.equal(runWarned(run), false, 'Partial is its own state, not a folded "With warnings"');
});

test('the result card says it ended at the limit and how many sites it read, not "No jobs added"', () => {
  const top = cleanTop(run, {kind: 'search', added: 0});
  assert.equal(top.tone, 'warn');
  assert.equal(top.title, 'Partial: ended at the 3-minute limit, 2 of 14 sites searched');
  assert.doesNotMatch(top.title, /No jobs added/);
  assert.equal(cleanTop({...run, endedByTime: false}, {kind: 'search', added: 0}).title, 'No jobs added to your list', 'positive control');
});

test('the count is the engine\'s own; without it the card says only that it ended at the limit and invents no number', () => {
  const top = cleanTop({...run, log: ['Searching job boards…']}, {kind: 'search', added: 0});
  assert.equal(top.title, 'Partial: ended at the 3-minute limit');
});

test('jobs it did add stay in the words', () => {
  assert.equal(cleanTop(run, {kind: 'search', added: 3}).title, 'Partial: ended at the 3-minute limit, 2 of 14 sites searched · 3 jobs added to your list');
});

test('the Find card of that run is Partial, with the same count', () => {
  const card = findCard({last: run, finishedHere: true, listed: 5});
  assert.equal(card.state, 'done');
  assert.deepEqual(card.partial, {done: 2, total: 14});
  assert.equal(findCard({last: {...run, endedByTime: false}, finishedHere: true, listed: 5}).partial, undefined, 'positive control');
});
