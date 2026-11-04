// Always on's Test button, the app's side (lib/always-on-test.js): one state per check from the test run's steps, the engine's own words for a failed one,
// a run started in the person's repository only, and an older repo brought up to date once. All with fake GitHub answers: no network, no real run.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {STEPS, readTest, startTest, stepStates, verdictOf} from '../../../lib/always-on-test.js';

const step = (name, status, conclusion = null) => ({name, status, conclusion});
const jobWith = (...steps) => ({id: 7, name: 'engine / test', status: 'in_progress', html_url: 'https://github.com/me/r/actions/runs/5/job/7', steps});
const idle = {listRuns: async () => [], wait: async () => {}};   // no network, no real pause
const storage = (repo = 'me/r', token = 'ghu_x') => ({settings: () => ({cloud: repo ? {repo} : null}), secret: name => (name === 'GITHUB_TOKEN' ? token : '')});

test('before the job exists every check waits', () => {
  assert.deepEqual(stepStates(null, null).map(item => item.state), ['waiting', 'waiting', 'waiting']);
  assert.deepEqual(stepStates(null, null).map(item => item.id), STEPS.map(item => item.id));
});

test('each check follows its own step: ok, running, waiting', () => {
  const states = stepStates(jobWith(step('Check · GitHub run', 'completed', 'success'), step('Check · Notion', 'in_progress')), null);
  assert.deepEqual(states.map(item => item.state), ['ok', 'running', 'waiting']);
  assert.equal(verdictOf(states, jobWith(), {status: 'in_progress'}), 'running');
});

test('a failed check carries the engine\'s sentence, or says it could not, and the later ones still count', () => {
  const job = jobWith(step('Check · GitHub run', 'completed', 'success'), step('Check · Notion', 'completed', 'success'), step('Check · AI key', 'completed', 'failure'));
  const said = stepStates(job, {steps: {ai: {ok: false, line: 'Your AI key was refused (401). Paste a working key in the app, then press Test again.'}}});
  assert.match(said[2].line, /refused \(401\)/);
  assert.equal(said[2].state, 'failed');
  assert.match(stepStates(job, null)[2].line, /failed before it could say why/);
  assert.equal(stepStates(job, null)[0].line, '', 'a passing check has no failure line');
});

test('the verdict: passed only when every check is ok; cancelled is not failed; a run that ended with a check never started is failed', () => {
  const ok = stepStates(jobWith(...STEPS.map(item => step(item.step, 'completed', 'success'))), null);
  assert.equal(verdictOf(ok, jobWith(), {status: 'completed', conclusion: 'success'}), 'passed');
  assert.equal(verdictOf(ok, jobWith(), {status: 'completed', conclusion: 'cancelled'}), 'cancelled');
  const never = stepStates(jobWith(step('Check · GitHub run', 'completed', 'success')), null);
  assert.equal(verdictOf(never, jobWith(), {status: 'completed', conclusion: 'failure'}), 'failed');
});

test('a test starts only in the person\'s own connected repository, as mode test', async () => {
  const sent = [];
  const dispatch = async (inputs, workflow, why) => { sent.push({inputs, workflow, why}); return {ok: true}; };
  assert.equal((await startTest(storage(''), {dispatch, ...idle})).ok, false);
  assert.equal((await startTest(storage('me/r', ''), {dispatch, ...idle})).ok, false);
  assert.deepEqual(sent, [], 'nothing is sent while GitHub is not connected');
  const started = await startTest(storage(), {dispatch, now: () => 1_000_000, listRuns: async () => [{id: 40}, {id: 38}], wait: idle.wait});
  assert.equal(started.ok, true);
  assert.equal(started.after, 40, 'the newest run listed before the press: only a higher id is this press\'s');
  assert.equal(started.since, 985_000, 'looks 15 s back: GitHub stamps the run with its own clock');
  assert.deepEqual(sent, [{inputs: {mode: 'test'}, workflow: 'daily.yml', why: 'always-on test button'}]);
});

test('an older repo that does not list the test mode is updated once, then asked again', async () => {
  const calls = [];
  const dispatch = async () => { calls.push('dispatch'); return calls.filter(item => item === 'dispatch').length === 1 ? {ok: false, error: "Provided value 'test' for input 'mode' not in the list of allowed values"} : {ok: true}; };
  const update = async () => { calls.push('update'); return []; };
  assert.equal((await startTest(storage(), {dispatch, update, ...idle})).ok, true);
  assert.deepEqual(calls, ['dispatch', 'update', 'dispatch']);
});

test('any other refusal is reported and the repo is left alone', async () => {
  const calls = [];
  const result = await startTest(storage(), {dispatch: async () => ({ok: false, error: 'Resource not accessible by integration'}), update: async () => { calls.push('update'); }, ...idle});
  assert.equal(result.ok, false);
  assert.match(result.error, /not accessible/);
  assert.deepEqual(calls, []);
});

function fakeGitHub({runs, jobs, artifacts = [], file = null}) {
  const asked = [];
  const json = value => ({ok: true, status: 200, json: async () => value});
  const fetcher = async url => {
    const route = url.replace('https://api.github.com', '');
    asked.push(route);
    if (route.includes('/workflows/daily.yml/runs')) return json({workflow_runs: runs});
    if (route.endsWith('/jobs?per_page=20')) return json({jobs});
    if (route.endsWith('/artifacts')) return json({artifacts});
    if (route === 'https://download/result') return {ok: true, arrayBuffer: async () => new ArrayBuffer(4)};
    throw new Error(route);
  };
  const unzip = async (_zip, folder) => { if (file) fs.writeFileSync(path.join(folder, 'selftest.json'), JSON.stringify(file)); };
  return {fetcher, unzip, asked};
}
const run = (extra = {}) => ({id: 5, html_url: 'https://github.com/me/r/actions/runs/5', status: 'in_progress', conclusion: null, created_at: '2026-11-04T13:00:10Z', display_title: 'test', ...extra});

test('before GitHub lists the run it is still running, and nothing else is asked', async () => {
  const gh = fakeGitHub({runs: []});
  const read = await readTest(storage(), {since: Date.parse('2026-11-04T13:00:00Z'), fetcher: gh.fetcher});
  assert.deepEqual([read.found, read.verdict], [false, 'running']);
  assert.equal(gh.asked.length, 1);
});

test('a running test is read from the job\'s steps and the result file is not asked for yet', async () => {
  const gh = fakeGitHub({runs: [run()], jobs: [{id: 3, name: 'engine / run', status: 'completed', conclusion: 'skipped', steps: []},
    jobWith(step('Check · GitHub run', 'completed', 'success'), step('Check · Notion', 'in_progress'))]});
  const read = await readTest(storage(), {since: 0, fetcher: gh.fetcher});
  assert.deepEqual(read.steps.map(item => item.state), ['ok', 'running', 'waiting']);
  assert.equal(read.verdict, 'running');
  assert.match(read.url, /job\/7$/);
  assert.ok(!gh.asked.some(route => route.endsWith('/artifacts')));
});

test('a finished failed test says which check failed and why, from the result file', async () => {
  const job = {...jobWith(step('Check · GitHub run', 'completed', 'success'), step('Check · Notion', 'completed', 'success'), step('Check · AI key', 'completed', 'failure')), status: 'completed', conclusion: 'failure'};
  const file = {steps: {ai: {ok: false, line: 'Your AI key was refused (401). Paste a working key in the app, then press Test again.'}}};
  const gh = fakeGitHub({runs: [run({status: 'completed', conclusion: 'failure'})], jobs: [job], artifacts: [{name: 'jobadabra-selftest', expired: false, archive_download_url: 'https://download/result'}], file});
  const read = await readTest(storage(), {since: 0, fetcher: gh.fetcher, unzip: gh.unzip});
  assert.equal(read.verdict, 'failed');
  assert.match(read.steps[2].line, /refused \(401\)/);
});

test('a missing result file is not a crash: the failed check says to open the run', async () => {
  const job = {...jobWith(step('Check · GitHub run', 'completed', 'failure')), status: 'completed', conclusion: 'failure'};
  const gh = fakeGitHub({runs: [run({status: 'completed', conclusion: 'failure'})], jobs: [job], artifacts: []});
  const read = await readTest(storage(), {since: 0, fetcher: gh.fetcher});
  assert.equal(read.verdict, 'failed');
  assert.match(read.steps[0].line, /Open the run/);
});

test('another dispatch in the same minute is not the test', async () => {
  const gh = fakeGitHub({runs: [run({id: 6, display_title: 'scheduled'})], jobs: []});
  assert.equal((await readTest(storage(), {since: 0, fetcher: gh.fetcher})).found, false);
});

test('a 422 that is not the mode list leaves the repo\'s files alone', async () => {
  const calls = [];
  const result = await startTest(storage(), {dispatch: async () => ({ok: false, error: 'HTTP 422: Workflow does not have workflow_dispatch trigger'}), update: async () => { calls.push('update'); }, ...idle});
  assert.equal(result.ok, false);
  assert.deepEqual(calls, []);
});

test('a run at or below the id seen before the press is the previous test, not this one', async () => {
  const gh = fakeGitHub({runs: [run({id: 40, status: 'completed', conclusion: 'success'})], jobs: []});
  assert.equal((await readTest(storage(), {since: 0, after: 40, fetcher: gh.fetcher})).found, false);
  const newer = fakeGitHub({runs: [run({id: 40, status: 'completed', conclusion: 'success'}), run({id: 41})], jobs: [jobWith(step('Check · GitHub run', 'in_progress'))]});
  const read = await readTest(storage(), {since: 0, after: 40, fetcher: newer.fetcher});
  assert.deepEqual([read.found, read.runId], [true, 41]);
});

test('once a run was found a later read stays on it, even when a newer test run appears', async () => {
  const gh = fakeGitHub({runs: [run({id: 41}), run({id: 42})], jobs: [jobWith(step('Check · GitHub run', 'in_progress'))]});
  assert.equal((await readTest(storage(), {since: 0, after: 40, runId: 41, fetcher: gh.fetcher})).runId, 41);
});

test('the test job ending before the run list says so still reads the result file (the two lists are read a moment apart)', async () => {
  const job = {...jobWith(step('Check · GitHub run', 'completed', 'success'), step('Check · Notion', 'completed', 'success'), step('Check · AI key', 'completed', 'failure')), status: 'completed', conclusion: 'failure'};
  const file = {steps: {ai: {ok: false, line: 'Your AI key was refused (401). Paste a working key in the app, then press Test again.'}}};
  const gh = fakeGitHub({runs: [run({status: 'in_progress'})], jobs: [job], artifacts: [{name: 'jobadabra-selftest', expired: false, archive_download_url: 'https://download/result'}], file});
  const read = await readTest(storage(), {since: 0, fetcher: gh.fetcher, unzip: gh.unzip, wait: async () => {}});
  assert.match(read.steps[2].line, /refused \(401\)/);
  assert.equal(read.verdict, 'failed');
});

test('a failed check whose result file is not listed yet is asked for once more before it is shown without words', async () => {
  const job = {...jobWith(step('Check · GitHub run', 'completed', 'failure')), status: 'completed', conclusion: 'failure'};
  const gh = fakeGitHub({runs: [run({status: 'completed', conclusion: 'failure'})], jobs: [job], artifacts: []});
  await readTest(storage(), {since: 0, fetcher: gh.fetcher, wait: async () => {}});
  assert.equal(gh.asked.filter(route => route.endsWith('/artifacts')).length, 2);
});
