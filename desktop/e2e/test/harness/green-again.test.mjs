// Guard: release — a "green again on main" card says a red was closed; one for a suite that never sent a red (report-only, or a failure the alert never counted) tells the owner a verdict on main that was never opened.
// Why (10 Nov 2026, owner, asked via AskUserQuestion, "Only to close a red I saw"): the card came for "Integration shots (report only), Prompt cases (report only) … apply". Fake GitHub only: nothing is sent to Telegram.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {messageOf, openRed} from '../../ci-alert.mjs';
import {checkCard} from '../../lib/tg-card.mjs';

const lanes = {suites: {'prompt-cases': {lane: 'tolerant'}, 'integration-shots': {lane: 'tolerant'}}};
const env = (file = 'e2e.yml', sha = 'ccc') => ({GITHUB_API_URL: 'https://api.test', GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'org/repo', GITHUB_RUN_ID: '99', GITHUB_REF_NAME: 'main', GITHUB_SHA: sha,
  GITHUB_WORKFLOW: file === 'e2e.yml' ? 'E2E' : 'Journeys', GITHUB_WORKFLOW_REF: `org/repo/.github/workflows/${file}@refs/heads/main`, GH_TOKEN: 'x'});
const run = (id, conclusion, sha, extra = {}) => ({id, conclusion, head_sha: sha, created_at: '2026-11-10T00:35:00Z', run_started_at: '2026-11-10T00:35:00Z', display_title: 'E2E', ...extra});
const job = (name, conclusion) => ({name, conclusion, html_url: `https://github.com/org/repo/job/${name}`});
// url fragment -> JSON; the first fragment the URL contains answers. An unlisted URL throws (a read the test did not expect).
const gh = routes => async url => {
  const hit = Object.entries(routes).find(([fragment]) => url.includes(fragment));
  if (!hit) throw new Error(`unexpected read ${url}`);
  return {json: async () => hit[1]};
};
const runs = (...list) => ({'/workflows/': {workflow_runs: list}});
const jobsOf = (id, ...list) => ({[`/actions/runs/${id}/jobs`]: {jobs: list}});
const merged = number => ({commits: [{commit: {message: `Some change (#${number - 1})`}}, {commit: {message: `Fix the step (#${number})\n\nbody`}}]});
const card = closed => messageOf({status: 'success', closed, env: env(), lanes, now: new Date('2026-11-10T08:00:00Z')});

test('a red that was sent, then a green that passed the suite: one card, red since, fixed by the PR', async () => {
  const closed = await openRed(env(), gh({...runs(run(11, 'failure', 'bbb'), run(10, 'success', 'aaa')), ...jobsOf(11, job('apply-1of3', 'failure'), job('plan', 'success')),
    ...jobsOf(99, job('apply-1of3', 'success'), job('plan', 'success')), '/compare/bbb...ccc': merged(3650)}), lanes);
  assert.deepEqual(closed.suites, ['apply']);
  assert.equal(closed.flaky, false);
  assert.deepEqual(closed.fixed, {prs: ['3650', '3649'], more: 0});
  const text = card(closed).text;
  assert.deepEqual(checkCard(card(closed)), []);
  assert.match(text, /<b>apply is green again on main<\/b>/);
  assert.match(text, /Red since 10 Nov, 01:35/);
  assert.match(text, /Fixed by #3650 · #3649/);
  assert.doesNotMatch(text, /flaky/);
});

test('the same commit green after a red says flaky, not fixed by a PR', async () => {
  const closed = await openRed(env('e2e.yml', 'bbb'), gh({...runs(run(11, 'failure', 'bbb')), ...jobsOf(11, job('apply-1of3', 'failure')), ...jobsOf(99, job('apply-1of3', 'success'))}), lanes);
  assert.equal(closed.flaky, true);
  const text = messageOf({status: 'success', closed, env: env('e2e.yml', 'bbb'), lanes}).text;
  assert.match(text, /Passed again on the same code \(flaky\)/);
  assert.doesNotMatch(text, /Fixed by/);
});

test('a previous run that failed only report-only suites sent no red, so no green follows it', async () => {
  const closed = await openRed(env(), gh({...runs(run(11, 'failure', 'bbb'), run(10, 'success', 'aaa')), ...jobsOf(11, job('prompt-cases', 'failure'), job('integration-shots', 'failure')), ...jobsOf(99, job('apply-1of3', 'success'))}), lanes);
  assert.deepEqual(closed.suites, []);
  assert.equal(card(closed), '', 'nothing is sent, not even a card named after the workflow');
});

test('a report-only failure after a sent red ends the streak: the run counted as green, so the red was closed then', async () => {
  const closed = await openRed(env(), gh({...runs(run(12, 'failure', 'ccb'), run(11, 'failure', 'bbb')), ...jobsOf(12, job('prompt-cases', 'failure')), ...jobsOf(11, job('apply-1of3', 'failure')), ...jobsOf(99, job('apply-1of3', 'success'))}), lanes);
  assert.deepEqual(closed.suites, []);
});

test('a green names only the suites that sent a red and passed now; report-only ones that failed beside them are not named', async () => {
  const closed = await openRed(env(), gh({...runs(run(11, 'failure', 'bbb')), ...jobsOf(11, job('apply-1of3', 'failure'), job('wizard', 'failure'), job('prompt-cases', 'failure')),
    ...jobsOf(99, job('apply-1of3', 'success'), job('wizard', 'skipped'), job('prompt-cases', 'success')), '/compare/bbb...ccc': merged(3650)}), lanes);
  assert.deepEqual(closed.suites, ['apply'], 'wizard did not run this time, prompt-cases never sent a red');
});

test('a red held across two failed runs is closed once, red since the first run', async () => {
  const closed = await openRed(env(), gh({...runs(run(12, 'failure', 'ccb', {run_started_at: '2026-11-10T04:00:00Z'}), run(11, 'failure', 'bbb', {run_started_at: '2026-11-09T22:00:00Z'})),
    ...jobsOf(12, job('apply-1of3', 'failure')), ...jobsOf(11, job('apply-1of3', 'failure')), ...jobsOf(99, job('apply-1of3', 'success')), '/compare/ccb...ccc': merged(3650)}), lanes);
  assert.deepEqual(closed.suites, ['apply']);
  assert.equal(closed.at, '2026-11-09T22:00:00Z');
  assert.equal(closed.sha, 'ccb', 'the fix is looked for after the newest red');
});

test('a by-hand bisect run and a cancelled run are no main check: neither closes nor breaks a red', async () => {
  const closed = await openRed(env(), gh({...runs(run(13, 'success', 'zzz', {display_title: 'Bisect apply zzz'}), run(12, 'cancelled', 'ccb'), run(11, 'failure', 'bbb')),
    ...jobsOf(11, job('apply-1of3', 'failure')), ...jobsOf(99, job('apply-1of3', 'success')), '/compare/bbb...ccc': merged(3650)}), lanes);
  assert.deepEqual(closed.suites, ['apply']);
});

test('no earlier failure, or an unreadable GitHub, sends nothing', async () => {
  assert.deepEqual((await openRed(env(), gh({...runs(run(10, 'success', 'aaa'))}), lanes)).suites, []);
  assert.deepEqual((await openRed(env(), async () => { throw new Error('offline'); }, lanes)).suites, []);
  assert.equal(card(undefined), '');
});

test('another workflow: a failed previous run is its red, named after the workflow; a success before it sends nothing', async () => {
  const closed = await openRed(env('journeys.yml'), gh({...runs(run(11, 'failure', 'bbb'), run(10, 'success', 'aaa')), '/compare/bbb...ccc': merged(3700)}), lanes);
  assert.deepEqual(closed.suites, ['Journeys']);
  assert.match(messageOf({status: 'success', closed, env: env('journeys.yml'), lanes}).text, /<b>Journeys is green again on main<\/b>/);
  assert.deepEqual((await openRed(env('journeys.yml'), gh({...runs(run(10, 'success', 'aaa'))}), lanes)).suites, []);
});

test('a failure run whose failed jobs are all report-only is not a red either', () => {
  const sent = messageOf({status: 'failure', jobs: [{name: 'prompt-cases', url: 'u'}], closed: {suites: ['apply'], at: '2026-11-10T00:35:00Z', fixed: {prs: [], more: 0}, flaky: false}, env: env(), lanes});
  assert.match(sent.text, /green again/, 'a run with only report-only failures can still close a blocking red');
  assert.equal(messageOf({status: 'failure', jobs: [{name: 'prompt-cases', url: 'u'}], env: env(), lanes}), '', 'and with no red to close it is silent');
});
