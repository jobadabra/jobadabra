// Guard: release — a PR-image tag equal to a branch name makes every image of the PR 404 (jobadabra#3321); tools/pr-assets.mjs must refuse it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {branchNameRefusal} from '../../../../tools/pr-assets.mjs';

test('a tag equal to an existing branch is refused and points at pr-assets-<branch>', () => {
  const refusal = branchNameRefusal('fb-tour-bars', 'jobadabra/jobadabra', ['fb-tour-bars']);
  assert.match(refusal, /also a branch/);
  assert.match(refusal, /pr-assets-<branch>/);
});

test('pr-assets-<branch> and a tag with no branch of that name pass', () => {
  assert.equal(branchNameRefusal('pr-assets-fb-tour-bars', 'jobadabra/jobadabra', []), null);
  assert.equal(branchNameRefusal('pr-assets-x', 'jobadabra/jobadabra', ['other']), null);
});
