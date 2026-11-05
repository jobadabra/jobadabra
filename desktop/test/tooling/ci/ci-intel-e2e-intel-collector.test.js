// The e2e collector's night reader (tools/ci-intel/jobs/e2e-intel.mjs): a night's prompt-case replay is read on its own, so a run that no quality job scored twice still sends it
// (jobadabra-web#259: the replay rode inside the quality night, and those nights lost it). Played offline with fake job logs. Site half: jobadabra-web#424 (`promptNights`).
import test from 'node:test';
import assert from 'node:assert/strict';
import {nightFromJobs, promptNightFromJobs, readNight} from '../../../../tools/ci-intel/jobs/e2e-intel.mjs';

const SCORES = ['2026-11-04T21:10:00.1Z   scores: 3001=95 3002=85', '2026-11-04T21:11:00.1Z   second scores: 3001=92 3002=75', '2026-11-04T21:12:00.1Z   judged 18 score texts: 16 grounded, 18 useful, 2 with invented facts',
  '2026-11-04T21:13:00.1Z quality: 63/63 facts exact, ranking ok, 0 invented facts, scores stable within ±25'].join('\n');
const REPLAY = '2026-11-04T21:40:00.1Z PROMPT_CASES_NIGHT {"set":"form","status":"asked","sha":"abc1234","total":63,"right":60,"flipped":1,"noise":2,"newWrong":0,"unconfirmed":0,"calls":66}';
const COUNTS = {status: 'asked', total: 63, right: 60, flipped: 1, noise: 2, newWrong: 0, unconfirmed: 0, calls: 66};
const run = {databaseId: 77, createdAt: '2026-11-04T21:00:05Z'};
const JOBS = [{id: 1, name: 'quality'}, {id: 2, name: 'qualityai'}, {id: 3, name: 'prompt-cases-night / Prompt cases, nightly (report only)'}];
const logs = {1: 'no second scoring here', 2: SCORES, 3: `a line\n${REPLAY}\n`};
const logOf = async id => logs[id];

test('a night where no quality job scored twice still gives its replay', async () => {
  const jobs = JOBS.filter(job => job.id !== 2);
  assert.equal(await nightFromJobs(jobs, logOf), null, 'no quality night: the old code stopped here and the replay was never sent');
  assert.deepEqual(await readNight(run, jobs, logOf), {night: null, promptNight: {runId: 77, day: '2026-11-04', promptCases: COUNTS}});
});

test('a night that scored twice gives both, the replay read once', async () => {
  let reads = 0;
  const {night, promptNight} = await readNight(run, JOBS, async id => { if (id === 3) reads += 1; return logs[id]; });
  assert.deepEqual([night.runId, night.day, night.pairs, night.within8], [77, '2026-11-04', 2, 1]);
  assert.deepEqual(promptNight, {runId: 77, day: '2026-11-04', promptCases: COUNTS});
  assert.equal(reads, 1);
});

test('no replay job, or a replay job that printed nothing, sends no replay; the quality night stays', async () => {
  assert.equal(await promptNightFromJobs(JOBS.filter(job => job.id !== 3), logOf), null);
  const printedNothing = await readNight(run, JOBS, async id => (id === 3 ? 'no counts printed' : logs[id]));
  assert.equal(printedNothing.promptNight, null);
  assert.equal(printedNothing.night.pairs, 2);
  assert.deepEqual(await readNight(run, [{id: 1, name: 'quality'}], logOf), {night: null, promptNight: null});
});
