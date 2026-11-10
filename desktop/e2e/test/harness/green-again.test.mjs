// Guard: release — a "green again on main" card says a red was closed; one for a suite that never sent a red (report-only, or a failure the alert never counted) tells the owner a verdict on main that was never opened.
// Why (10 Nov 2026, owner, asked via AskUserQuestion, "Only to close a red I saw"): the card came for "Integration shots (report only), Prompt cases (report only) … apply". Fake GitHub only: nothing is sent to Telegram.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {messageOf, openRed} from '../../ci-alert.mjs';
import {checkCard} from '../../lib/tg-card.mjs';

const lanes = {suites: {'prompt-cases': {lane: 'tolerant'}, 'integration-shots': {lane: 'tolerant'}}};
const env = (file = 'e2e.yml', sha = 'ccc') => ({GITHUB_API_URL: 'https://api.test', GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'org/repo', GITHUB_RUN_ID: '99', GITHUB_REF_NAME: 'main', GITHUB_SHA: sha,
  GITHUB_WORKFLOW: file === 'e2e.yml' ? 'E2E' : 'Journeys', GITHUB_WORKFLOW_REF: `org/repo/.github/workflows/${file}@refs/heads/main`, GH_TOKEN: 'x'});
const run = (id, conclusion, sha, extra = {}) => ({id, conclusion, head_sha: sha, created_at: '2026-11-10T00:35:00Z', run_started_at: '2026-11-10T00:35:00Z', display_title: 'E2E check · main', ...extra});
const job = (name, conclusion) => ({name, conclusion, html_url: `https://github.com/org/repo/job/${name}`});
// url fragment -> JSON; the first fragment the URL contains answers. An unlisted URL throws (a read the test did not expect).
const gh = routes => async url => {
  const hit = Object.entries(routes).find(([fragment]) => url.includes(fragment));
  if (!hit) throw new Error(`unexpected read ${url}`);
  return {json: async () => hit[1]};
};
const runs = (...list) => ({'/workflows/': {workflow_runs: list}, ...Object.fromEntries(list.filter(item => item.conclusion === 'success').map(item => [`/actions/runs/${item.id}/jobs`, {jobs: [job('apply', 'success'), job('wizard', 'success')]}]))});
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

test('a report-only failure that passed the red suite closes it, so it is not closed again', async () => {
  const closed = await openRed(env(), gh({...runs(run(12, 'failure', 'ccb'), run(11, 'failure', 'bbb')), ...jobsOf(12, job('prompt-cases', 'failure'), job('apply-1of3', 'success')), ...jobsOf(11, job('apply-1of3', 'failure')), ...jobsOf(99, job('apply-1of3', 'success'))}), lanes);
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

test('a suite that passed in a failed run in between had recovered then: only the suite red in the newest run is closed, red since that run', async () => {
  const closed = await openRed(env(), gh({...runs(run(12, 'failure', 'ccb', {run_started_at: '2026-11-10T04:00:00Z'}), run(11, 'failure', 'bbb')), ...jobsOf(12, job('wizard', 'failure'), job('apply-1of3', 'success')), ...jobsOf(11, job('apply-1of3', 'failure')),
    ...jobsOf(99, job('apply-1of3', 'success'), job('wizard', 'success')), '/compare/ccb...ccc': merged(3650)}), lanes);
  assert.deepEqual(closed.suites, ['wizard']);
  assert.equal(closed.at, '2026-11-10T04:00:00Z');
});

test('a red card with no failed job (the plan broke) is named after the workflow and closed by the next green', async () => {
  const closed = await openRed(env(), gh({...runs(run(11, 'failure', 'bbb')), ...jobsOf(11), ...jobsOf(99, job('apply-1of3', 'success')), '/compare/bbb...ccc': merged(3650)}), lanes);
  assert.deepEqual(closed.suites, ['E2E']);
});

test('another workflow: a failed previous run is its red, named after the workflow; a success before it sends nothing', async () => {
  const closed = await openRed(env('journeys.yml'), gh({...runs(run(11, 'failure', 'bbb'), run(10, 'success', 'aaa')), '/compare/bbb...ccc': merged(3700)}), lanes);
  assert.deepEqual(closed.suites, ['Journeys']);
  assert.match(messageOf({status: 'success', closed, env: env('journeys.yml'), lanes}).text, /<b>Journeys is green again on main<\/b>/);
  assert.deepEqual((await openRed(env('journeys.yml'), gh({...runs(run(10, 'success', 'aaa'))}), lanes)).suites, []);
});

test('a failed status whose jobs are all report-only closes an open red but alone sends nothing', () => {
  const sent = messageOf({status: 'failure', jobs: [{name: 'prompt-cases', url: 'u'}], closed: {suites: ['apply'], at: '2026-11-10T00:35:00Z', fixed: {prs: [], more: 0}, flaky: false}, env: env(), lanes});
  assert.match(sent.text, /green again/, 'a run with only report-only failures can still close a blocking red');
  assert.equal(messageOf({status: 'failure', jobs: [{name: 'prompt-cases', url: 'u'}], env: env(), lanes}), '', 'and with no red to close it is silent');
});


test('an unrun suite carries across a different red and a partial green until it actually passes', async () => {
  const closed = await openRed(env(), gh({...runs(run(13, 'success', 'ccc'), run(12, 'failure', 'ccb'), run(11, 'failure', 'bbb')),
    ...jobsOf(13, job('wizard', 'success'), job('apply', 'skipped')), ...jobsOf(12, job('wizard', 'failure')), ...jobsOf(11, job('apply', 'failure')),
    ...jobsOf(99, job('apply', 'success')), '/compare/bbb...ccc': merged(3650)}), lanes);
  assert.deepEqual(closed.suites, ['apply']);
});

test('mutants never open a red and after-merge greens never close a sent red', async () => {
  const closed = await openRed(env(), gh({...runs(run(14, 'failure', 'zzz', {display_title: 'Mutant wizard'}), run(13, 'success', 'ccc', {display_title: 'E2E after merge · main'}), run(11, 'failure', 'bbb')),
    ...jobsOf(11, job('apply', 'failure')), ...jobsOf(99, job('apply', 'success')), '/compare/bbb...ccc': merged(3650)}), lanes);
  assert.deepEqual(closed.suites, ['apply']);
  const never = await openRed(env(), gh({...runs(run(14, 'failure', 'zzz', {display_title: 'Mutant wizard'})), ...jobsOf(99, job('wizard', 'success'))}), lanes);
  assert.deepEqual(never.suites, []);
});

test('an unreadable jobs response never turns into a workflow red', async () => {
  const closed = await openRed(env(), gh({...runs(run(11, 'failure', 'bbb')), '/actions/runs/11/jobs': {message: 'rate limited'}, ...jobsOf(99, job('apply', 'success'))}), lanes);
  assert.deepEqual(closed.suites, []);
});


test('fix and flaky facts belong to the suite being closed, not a newer unrelated red', async () => {
  const closed = await openRed(env(), gh({...runs(run(12, 'failure', 'ccc'), run(11, 'failure', 'bbb')),
    ...jobsOf(12, job('wizard', 'failure')), ...jobsOf(11, job('apply', 'failure')),
    ...jobsOf(99, job('apply', 'success'), job('wizard', 'skipped')), '/compare/bbb...ccc': merged(3650)}), lanes);
  assert.deepEqual(closed.suites, ['apply']);
  assert.equal(closed.flaky, false);
  assert.equal(closed.sha, 'bbb');
  assert.deepEqual(closed.fixed.prs, ['3650', '3649']);
});
