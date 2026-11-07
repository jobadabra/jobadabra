// Guard: release — without it the Microsoft Store gets a version that is a few hours old or red on main, or is flooded daily again while a review takes days (tools/msix-store-weekly.mjs; owner, 7 Nov 2026).
// Owner: "Weekly, a fixed day (Recommended)": "One submission a week (e.g. Monday's stable), only after it has run a day on the .exe without a red." The release list and GitHub's runs are fakes.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {github, MAX_CANDIDATES, MIN_AGE_HOURS, pick, RED_WORKFLOWS} from '../../../../tools/msix-store-weekly.mjs';

const NOW = new Date('2026-11-09T07:00:00Z');   // a Monday
const hoursAgo = hours => new Date(NOW - hours * 3600000).toISOString();
const stable = (version, hours) => ({version, tag: `desktop-v${version}`, publishedAt: hoursAgo(hours)});

test('the newest stable that is a day old and green is the pick; one that is too new or red is skipped for the next older one', async () => {
  const list = [stable('0.9.16', 12), stable('0.9.15', 15), stable('0.9.14', 30), stable('0.9.13', 60)];
  assert.equal((await pick(list, {now: NOW, lastSubmitted: '0.8.86'})).tag, 'desktop-v0.9.14', '0.9.16 and 0.9.15 have not run a day yet');
  const red = await pick(list, {now: NOW, lastSubmitted: '0.8.86', isRed: async s => (s.version === '0.9.14' ? 'has a failure e2e.yml run' : '')});
  assert.equal(red.tag, 'desktop-v0.9.13');
  assert.match(red.reason, /0\.9\.14 has a failure e2e\.yml run/);
  assert.equal((await pick([stable('0.9.16', MIN_AGE_HOURS - 1)], {now: NOW})).tag, '', 'one hour short of a day is too new');
  assert.equal((await pick([stable('0.9.16', MIN_AGE_HOURS)], {now: NOW})).tag, 'desktop-v0.9.16', 'exactly a day is enough');
});

test('nothing is sent when no stable passes, or the one that passes is not newer than the last submitted version', async () => {
  assert.equal((await pick([], {now: NOW})).tag, '');
  assert.equal((await pick([stable('0.9.16', 40)], {now: NOW, isRed: async () => 'has a failure build.yml run'})).tag, '', 'all red');
  const done = await pick([stable('0.9.16', 3), stable('0.9.14', 40)], {now: NOW, lastSubmitted: '0.9.14'});
  assert.equal(done.tag, '', 'the Store wants each submission higher than the last');
  assert.match(done.reason, /already submitted/);
  assert.equal((await pick([stable('0.9.14', 40)], {now: NOW, lastSubmitted: '0.9.9'})).tag, 'desktop-v0.9.14', 'numbers compare as numbers: 0.9.14 is newer than 0.9.9');
});

test('the day counts from the promotion, not from the beta: a beta published days ago and made stable an hour ago is too new', async () => {
  const list = [stable('0.9.16', 100), stable('0.9.14', 200)];
  const promoted = {'0.9.16': hoursAgo(1), '0.9.14': hoursAgo(150)};
  const result = await pick(list, {now: NOW, promotedAt: async s => promoted[s.version]});
  assert.equal(result.tag, 'desktop-v0.9.14');
  assert.match(result.reason, /0\.9\.16 has been stable 1 h/);
  assert.equal((await pick([stable('0.9.16', 100)], {now: NOW})).tag, 'desktop-v0.9.16', 'no promotion date recorded (a stable from before 7 Nov 2026): the beta\'s date');
});

test('a candidate that cannot be checked is skipped, never trusted and never a failed week; only the newest few are looked at', async () => {
  const list = [stable('0.9.16', 40), stable('0.9.15', 50)];
  const result = await pick(list, {now: NOW, isRed: async s => { if (s.version === '0.9.16') throw new Error('GitHub 502'); return ''; }});
  assert.equal(result.tag, 'desktop-v0.9.15');
  assert.match(result.reason, /0\.9\.16 could not be checked \(GitHub 502\)/);
  const many = Array.from({length: 12}, (_, i) => stable(`0.8.${20 - i}`, 40 + i));
  let looked = 0;
  await pick(many, {now: NOW, isRed: async () => { looked++; return 'red'; }});
  assert.equal(looked, MAX_CANDIDATES);
});

test('red = a build.yml or e2e.yml run on the release\'s commit that did not pass (failure, timed_out, startup_failure, on any page, path with or without @ref); other workflows failing there (the Store watcher) are not red', async () => {
  const env = {GITHUB_REPOSITORY: 'o/r', GH_TOKEN: 't'};
  const fakeRuns = pages => async url => {
    const page = Number(/[?&]page=(\d+)/.exec(String(url))?.[1] || 1);
    return {ok: true, status: 200, json: async () => (String(url).includes('/commits/') ? {sha: 'abc'} : {workflow_runs: pages[page - 1] || []})};
  };
  const filler = n => Array.from({length: n}, () => ({path: '.github/workflows/pr-labels.yml', conclusion: 'success'}));
  assert.deepEqual(RED_WORKFLOWS, ['build.yml', 'e2e.yml']);
  const watch = [{path: '.github/workflows/msix-store-watch.yml', conclusion: 'failure'}, {path: '.github/workflows/build.yml', conclusion: 'success'}];
  assert.equal(await github(env, fakeRuns([watch])).isRed(stable('0.9.14', 40)), '');
  assert.equal(await github(env, fakeRuns([[]])).isRed(stable('0.9.14', 40)), '', 'no main-check run at all is not red (0.9.13\'s commit has none)');
  assert.match(await github(env, fakeRuns([[...watch, {path: '.github/workflows/e2e.yml', conclusion: 'failure'}]])).isRed(stable('0.9.14', 40)), /failure e2e\.yml/);
  assert.match(await github(env, fakeRuns([[{path: '.github/workflows/build.yml@refs/heads/main', conclusion: 'timed_out'}]])).isRed(stable('0.9.14', 40)), /timed_out build\.yml/);
  assert.match(await github(env, fakeRuns([[{path: '.github/workflows/e2e.yml', conclusion: 'startup_failure'}]])).isRed(stable('0.9.14', 40)), /startup_failure/);
  assert.match(await github(env, fakeRuns([filler(100), [{path: '.github/workflows/e2e.yml', conclusion: 'failure'}]])).isRed(stable('0.9.14', 40)), /failure e2e\.yml/, 'a failed run on page 2 is seen');
});

test('the promotion date is the annotated tag release-stable.sh recorded; no tag is no date', async () => {
  const env = {GITHUB_REPOSITORY: 'o/r', GH_TOKEN: 't'};
  const answer = (status, body) => async () => ({ok: status < 400, status, json: async () => body});
  assert.equal(await github(env, answer(404, {})).promotedAt(stable('0.9.14', 40)), '');
  const fetcher = async url => String(url).includes('/git/tags/') ? {ok: true, status: 200, json: async () => ({tagger: {date: '2026-11-08T06:00:00Z'}})} : {ok: true, status: 200, json: async () => ({object: {type: 'tag', sha: 'tt'}})};
  assert.equal(await github(env, fetcher).promotedAt(stable('0.9.14', 40)), '2026-11-08T06:00:00Z');
  await assert.rejects(github(env, answer(500, {})).promotedAt(stable('0.9.14', 40)), /GitHub 500/);
});
