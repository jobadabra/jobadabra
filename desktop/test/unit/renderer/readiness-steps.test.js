// An Apply readiness check's steps, each with its own seconds, kept per job for the drawer (renderer/readiness-steps.js, #4325).
// Owner, 14 Nov 2026: "Getting started / Reading the form … Each of them with seconds of how much it took. and then I should see the end result, the outcome".
import test from 'node:test';
import assert from 'node:assert/strict';
import {addStep, endSteps, moveStep, startSteps, stepsOf} from '../../../renderer/readiness-steps.js';

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
