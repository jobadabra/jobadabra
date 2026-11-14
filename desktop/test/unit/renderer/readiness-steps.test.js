// An Apply readiness check's steps, each with its own seconds, kept per job for the drawer (renderer/readiness-steps.js, #4325).
// Owner, 14 Nov 2026: "Getting started / Reading the form … Each of them with seconds of how much it took. and then I should see the end result, the outcome".
import test from 'node:test';
import assert from 'node:assert/strict';
import {addStep, beginCheck, endSteps, moveStep, startSteps, stepsOf} from '../../../renderer/readiness-steps.js';

const URL_A = 'https://jobs.example.test/a';

test('a check of one job keeps each step with its own seconds, the kit draft as its own step', () => {
  const log = startSteps(URL_A, 0);
  assert.equal(moveStep(log, 'drafting', 1_000), true);
  assert.equal(moveStep(log, 'opening', 42_000), true);
  assert.equal(moveStep(log, 'looking', 45_000), true);
  assert.equal(moveStep(log, 'judging', 48_000), false, 'judging reads as "Reading the form": no second line');
  endSteps(log, 53_000);
  addStep(URL_A, 'matching', 4_000);
  assert.deepEqual(stepsOf(URL_A).map(({seconds}) => seconds), [1, 41, 3, 8, 4]);
  assert.equal(stepsOf(URL_A).length, 5);
});

test('an unknown step changes nothing, and a job never checked has no steps', () => {
  const log = startSteps('https://jobs.example.test/b', 0);
  assert.equal(moveStep(log, 'somewhere', 5_000), false);
  assert.deepEqual(stepsOf('https://jobs.example.test/never'), []);
});

test('an ended log moves no more and a new check replaces the job\'s last one', () => {
  const log = startSteps(URL_A, 0);
  endSteps(log, 2_000);
  assert.equal(moveStep(log, 'opening', 3_000), false);
  assert.deepEqual(stepsOf(URL_A).map(({seconds}) => seconds), [2]);
});

test('a read Stop cut short leaves the job\'s last check as it was (Gitar on #4342)', () => {
  const url = 'https://jobs.example.test/stopped';
  const done = startSteps(url, 0);
  endSteps(done, 5_000);
  const stopped = startSteps(url, 10_000);
  moveStep(stopped, 'opening', 11_000);
  endSteps(stopped, 12_000, {keep: false});
  assert.deepEqual(stepsOf(url).map(({seconds}) => seconds), [5]);
});

test('the match\'s step goes only to a log this check wrote, never to an earlier check\'s (Gitar on #4370)', () => {
  const url = 'https://jobs.example.test/earlier';
  endSteps(startSteps(url, 0), 4_000);
  beginCheck();   // a new check: this job's log is from the one before
  const stored = startSteps(url, 10_000);
  endSteps(stored, 10_500, {keep: false});   // answered from the store: nothing kept this time
  addStep(url, 'matching', 6_000);
  assert.deepEqual(stepsOf(url).map(({seconds}) => seconds), [4], 'the earlier log stays as it was: no Matching mixed in');
  endSteps(startSteps(url, 20_000), 21_000);   // read again in this check
  addStep(url, 'matching', 6_000);
  assert.deepEqual(stepsOf(url).map(({seconds}) => seconds), [1, 6]);
});
