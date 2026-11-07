// Guard: release — without it the Microsoft Store gets a version that is a few hours old or red on main, or is flooded daily again while a review takes days (tools/msix-store-weekly.mjs; owner, 7 Nov 2026).
// Owner: "Weekly, a fixed day (Recommended)": "One submission a week (e.g. Monday's stable), only after it has run a day on the .exe without a red." The release list and GitHub's runs are fakes.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {github, MIN_AGE_HOURS, pick, RED_WORKFLOWS} from '../../../../tools/msix-store-weekly.mjs';

const NOW = new Date('2026-11-09T07:00:00Z');   // a Monday
const hoursAgo = hours => new Date(NOW - hours * 3600000).toISOString();
const stable = (version, hours) => ({version, tag: `desktop-v${version}`, publishedAt: hoursAgo(hours)});

test('the newest stable that is a day old and green is the pick; one that is too new or red is skipped for the next older one', async () => {
  const list = [stable('0.9.16', 12), stable('0.9.15', 15), stable('0.9.14', 30), stable('0.9.13', 60)];
  assert.equal((await pick(list, {now: NOW, lastSubmitted: '0.8.86'})).tag, 'desktop-v0.9.14', '0.9.16 and 0.9.15 have not run a day yet');
  const red = await pick(list, {now: NOW, lastSubmitted: '0.8.86', isRed: async s => s.version === '0.9.14'});
  assert.equal(red.tag, 'desktop-v0.9.13');
  assert.match(red.reason, /0\.9\.14 has a red run/);
  assert.equal((await pick([stable('0.9.16', MIN_AGE_HOURS - 1)], {now: NOW})).tag, '', 'one hour short of a day is too new');
  assert.equal((await pick([stable('0.9.16', MIN_AGE_HOURS)], {now: NOW})).tag, 'desktop-v0.9.16', 'exactly a day is enough');
});

test('nothing is sent when no stable passes, or the one that passes is not newer than the last submitted version', async () => {
  assert.equal((await pick([], {now: NOW})).tag, '');
  assert.equal((await pick([stable('0.9.16', 40)], {now: NOW, isRed: async () => true})).tag, '', 'all red');
  const done = await pick([stable('0.9.16', 3), stable('0.9.14', 40)], {now: NOW, lastSubmitted: '0.9.14'});
  assert.equal(done.tag, '', 'the Store wants each submission higher than the last');
  assert.match(done.reason, /already submitted/);
  assert.equal((await pick([stable('0.9.14', 40)], {now: NOW, lastSubmitted: '0.9.9'})).tag, 'desktop-v0.9.14', 'numbers compare as numbers: 0.9.14 is newer than 0.9.9');
});

test('red = a failed build.yml or e2e.yml run on the release\'s commit; other workflows failing there (the Store watcher) are not red', async () => {
  const runs = {workflow_runs: [{path: '.github/workflows/msix-store-watch.yml', conclusion: 'failure'}, {path: '.github/workflows/build.yml', conclusion: 'success'}]};
  const fetcher = async url => ({ok: true, status: 200, json: async () => (String(url).includes('/commits/') ? {sha: 'abc'} : runs)});
  const env = {GITHUB_REPOSITORY: 'o/r', GH_TOKEN: 't'};
  assert.deepEqual(RED_WORKFLOWS, ['build.yml', 'e2e.yml']);
  assert.equal(await github(env, fetcher).isRed(stable('0.9.14', 40)), false);
  runs.workflow_runs.push({path: '.github/workflows/e2e.yml', conclusion: 'failure'});
  assert.equal(await github(env, fetcher).isRed(stable('0.9.14', 40)), true);
});
