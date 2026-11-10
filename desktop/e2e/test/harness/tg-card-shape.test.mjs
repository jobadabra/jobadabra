// Guard: privacy — every owner Telegram message of the public repo (CI, AI, releases, Store watcher, tests) is built from fictional data and held to the one card shape (shared/tg-card.js checkCard): dot + bold headline, ≤12 lines, one link, no raw JSON, no secret or e-mail address.
// Why (10 Nov 2026, owner: "how I should like to see all the others, in terms of readability"): ~40 kinds were each their own string; one loop over every sender means a new message cannot be a wall of text or leak a token/address.
// A sender that cannot be built here (missing export) fails the loop: a new owner message is added to SAMPLES below.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {checkCard} from '../../lib/tg-card.mjs';

const root = new URL('../../../../', import.meta.url).pathname;
const imp = file => import(path.join(root, file));

async function samples() {
  const out = {};
  const env = {GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'org/repo', GITHUB_RUN_ID: '4242', GITHUB_REF_NAME: 'main', GITHUB_WORKFLOW: 'E2E', GITHUB_WORKFLOW_REF: 'org/repo/.github/workflows/e2e.yml@refs/heads/main', GITHUB_SHA: 'd0bec43aa1', GH_TOKEN: 'x'};
  const now = new Date('2026-11-08T17:25:00Z');
  const keep = (id, group, fn) => (async () => { try { const v = await fn(); const text = typeof v === 'string' ? v : v?.text; if (text) out[id] = {group, text, html: typeof v === 'object' && v.parse_mode === 'HTML'}; else out[id] = {group, skipped: true}; } catch (e) { out[id] = {group, error: String(e.message).slice(0, 160)}; } })();
  const run = 'https://github.com/org/repo/actions/runs/4242';
  const ci = await imp('desktop/e2e/ci-alert.mjs');
  const jobs = [{name: 'apply-1of3', url: run + '/job/1'}];
  const lanes = {suites: {}};
  const dialogJson = 'the dialog never named job 2 of 4 while its read was held (last read: {"screen":{"shown":true,"text":"Checking apply…"}}';
  const stepA = {suite: 'apply', step: 'the triage bar moves per real read and Cancel during a held read stops before the next job', message: dialogJson, job: 'apply-1of3', url: run + '/job/1'};
  await keep('main-red', 'CI', () => ci.messageOf({status: 'failure', causes: [stepA], jobs, since: {prs: [3630, 3629, 3628, 3626, 3627], more: 1}, env, now, lanes}));
  await keep('main-red-many', 'CI', () => ci.messageOf({status: 'failure', causes: [stepA, {...stepA, step: 'Cancel closes the page', message: 'not run: over its 12-minute budget; the suite is too long: split it'}, {suite: 'wizard', step: 'the third step shows the CV', message: 'a required field is missing; +2 more', job: 'wizard-1of1'}, {suite: 'jobs', step: 'the list sorts', message: 'row 3 shows null', job: 'jobs-1of2', flaky: {green: {sha: 'abc1234', url: run}, sameCommit: false}}],
    jobs: [...jobs, {name: 'wizard-1of1', url: run}, {name: 'jobs-1of2', url: run}], since: {prs: [3630], more: 0}, env, now, lanes}));
  await keep('main-green', 'CI', () => ci.messageOf({status: 'success', previous: 'failure', recovered: ['apply-1of3'], since: {prs: [3631], more: 0}, jobs: [], env, now, lanes}));
  await keep('harness-daily', 'CI', () => ci.messageOf({status: 'failure', what: 'An E2E tooling test no longer passes', next: 'The failing test is in the run, step Every E2E tooling test', jobs: [{name: 'harness', url: run}], env: {...env, GITHUB_WORKFLOW: 'Harness daily', GITHUB_WORKFLOW_REF: 'o/r/.github/workflows/harness-daily.yml@main'}, since: {prs: [], more: 0}, now, lanes}));
  const gate = `Red suites: apply\nRed step: changed | the triage bar moves per real read | -\nRed step: flaky | Cancel closes the page | https://github.com/org/repo/actions/runs/4100\nStops the beta: apply · the triage bar moves per real read and Cancel during a held read stops before the next job, closes its page, and fills or sends nothing: a safety step failed\n`;
  await keep('nightly-skipped', 'CI', async () => (await imp('desktop/e2e/lib/nightly-alert.mjs')).nightlyNotice(gate, env).message);
  const credit = await imp('desktop/e2e/credit-alert.mjs');
  await keep('ai-credit', 'AI', () => credit.creditMessage({provider: 'codex', text: "budget: the Codex plan's budget for CI is used up (week)", env}));
  const fw = await imp('desktop/e2e/lib/ai-failure-words.mjs');
  await keep('ai-calls-failed', 'AI', () => fw.failureAlert({jobs: ['central-scout'], summaries: [{calls: 200, ok: 177, failed: 23, causes: [{key: 'connection', icon: '📡', label: 'The connection to the AI service dropped', count: 22}, {key: 'timeout', icon: '⏱', label: 'The AI took too long', count: 1}]}], run}));
  await keep('ai-step-skipped', 'AI', async () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-')); fs.mkdirSync(path.join(dir, 'e2e-artifacts-qualityai')); fs.writeFileSync(path.join(dir, 'e2e-artifacts-qualityai', 'ai-capped.json'), JSON.stringify({why: "budget: the broker's share for this job is used up (week)", job: 'qualityai'}));
    let sent = ''; await credit.alertCappedSteps({artifacts: dir, env: {...env, CI_ALERTS_TELEGRAM_BOT_TOKEN: 't', CI_ALERTS_TELEGRAM_CHAT_ID: 'c'}, fetcher: async (u, i) => { sent = JSON.parse(i.body); return {ok: true}; }, log: () => {}}); return sent; });
  await keep('ai-refused', 'AI', async () => { const r = await imp('tools/ci-intel/lib/ai-refusal.mjs'); let sent = ''; await r.reportRefusal(new r.AiRefused(503, 'connection reset (UND_ERR_SOCKET)'), {job: 'Changelog publish', effect: 'A plain entry was published.', workflow: '', zurichHour: 3, env: {...env, CI_ALERTS_TELEGRAM_BOT_TOKEN: 't', CI_ALERTS_TELEGRAM_CHAT_ID: 'c'}, fetch: async (u, i) => { sent = JSON.parse(i.body); return {ok: true}; }}); return sent; });
  const fx = await imp('tools/fixer/follow.mjs');
  await keep('ai-fixer', 'AI', () => fx.fixerCard ? fx.fixerCard('same-failure', {source: 'ci', ref: 'e2e-3f2a', pr: 3640, repo: 'org/repo'}) : 'AI fixer: the same failure came back after a fix (ci e2e-3f2a)');
  const ra = await imp('desktop/e2e/release-alert.mjs');
  const commit = {sha: '3e72f158abcd', subject: 'P3 A finished Find jobs run says what comes next (#3631)', date: '2026-11-09T14:02:00Z'};
  await keep('beta-published', 'Releases', () => ra.releaseMessage({kind: 'beta', tag: 'desktop-v0.9.18', commit, lanes: [['Mac', 'success'], ['Windows', 'success']], env}));
  await keep('beta-one-lane', 'Releases', () => ra.releaseMessage({kind: 'beta', tag: 'desktop-v0.9.18', commit, lanes: [['Mac', 'success'], ['Windows', 'failure']], env}));
  await keep('stable-promoted', 'Releases', () => ra.releaseMessage({kind: 'stable', tag: 'desktop-v0.9.17', commit, env}));
  const rf = await imp('desktop/e2e/release-failed-alert.mjs');
  await keep('release-failed', 'Releases', () => rf.failedMessage({kind: 'beta', version: '0.9.18', lanes: [{lane: 'Mac', step: 'E2E gate', result: 'failure'}, {lane: 'Windows', step: 'Build', result: 'cancelled'}], env}));
  await keep('stable-not-shipped', 'Releases', () => rf.failedMessage({kind: 'stable', version: '0.9.17', lanes: [{lane: 'Promote to stable', step: 'Promote to stable', result: 'failure'}], env}));
  const ms = await imp('tools/msix-store-watch.mjs');
  const m = {version: '0.9.17', reason: 'The package failed validation: 1004 manifest error', run, repo: 'org/repo'};
  for (const k of ['live', 'failed', 'ended', 'broken']) await keep('msstore-' + k, 'Releases', () => ms.messageOf(k, k === 'ended' ? {...m, reason: '0.9.18'} : m));
  const sn = await imp('desktop/e2e/lib/store-notices.mjs');
  await keep('store-publish-failed', 'Releases', () => sn.storeNotice('chrome-store-publish', {TAG: 'desktop-v0.9.17', GITHUB_REPOSITORY: 'org/repo', RUN: run})?.message);
  await keep('feedback-not-told', 'Releases', async () => { const f = await imp('tools/feedback-released.mjs'); return f.note ? f.note('Feedback reporters were not told', 'The site did not answer after 3 tries', 'desktop-v0.9.17', env) : ''; });
  await keep('pr-scorecard', 'Tests', async () => (await imp('tools/pr-check-scorecard.mjs')).message({days: 30, checks: [
    {name: 'unit-python', verdict: 'proven', runs: 410, realCatches: 12, catchPrs: [3401, 3410], falseReds: 3, p90Min: 6, addedMin: 0.4}, {name: 'integration-app', verdict: 'review', runs: 380, realCatches: 0, falseReds: 9, p90Min: 9, addedMin: 2.1},
    {name: 'spec-proof', verdict: 'review', runs: 300, realCatches: 0, falseReds: 1, p90Min: 2, addedMin: 0.2}, {name: 'lint', verdict: 'proven', runs: 400, realCatches: 5, catchPrs: [3390], falseReds: 0, p90Min: 1, addedMin: 0.1}]}));
  const wk = await imp('tools/ci-intel/lib/e2e-weekly.mjs');
  const grey = ['interactions', 'notion-real', 'personas', 'quality', 'qualityai', 'wander'].map(suite => ({suite, lane: 'tolerant', ageText: '8 days', nights: [{green: false}, {green: true}, {green: true}], expired: false, below: false}));
  const prune = ['qualityai', 'calendar', 'recorded', 'stores', 'interviews', 'focusdismiss', 'harness', 'foryou'].map(suite => ({suite, reds: 20, min: 90}));
  await keep('e2e-weekly', 'Tests', () => wk.telegramText({day: '2026-11-09', runs: 352, redRuns: 31, reds: 44, byGroup: {ours: 8, tests: 5, app: 2, none: 29}, causes: [], caught: [{suite: 'apply'}], idle: [{suite: 'applyflows', noise: 9, ours: 0, unnamed: 0}, {suite: 'wizard', noise: 2, ours: 0, unnamed: 0}, {suite: 'jobs', noise: 2, ours: 0, unnamed: 0}],
    prune, grey: {read: true, rows: grey}, speed: {main: [{suite: 'recorded-1of5', median: 646, n: 18}, {suite: 'recorded-1of4', median: 591, n: 3}], slowPr: [], prRead: true}, work: {week: '2026-11-02', counts: {plumbing: 169}, total: 563, plumbing: 0.3}, files: []}));
  const dj = await imp('desktop/e2e/lib/discovery-judge.mjs');
  const judged = [{shape: 'wd-a', host: 'careers.example-one.com', verdict: 'fields-left', detail: 'phone'}, {shape: 'gh-b', host: 'jobs.example-two.org', verdict: 'wrong', detail: ''}, {shape: 'lv-c', host: 'example-three.io', verdict: 'fine'}, {shape: 'ab-d', host: 'example-four.eu', verdict: 'fine'}, {shape: 'sm-e', host: 'example-five.ch', verdict: 'not-measured'}];
  await keep('discovery', 'Tests', () => dj.telegramText({day: '2026-11-09', judged, usd: 0.42, weekSpent: 1.1, weekCap: 3}));
  await keep('discovery-cap', 'Tests', () => dj.capText({week: '2026-11-09', spent: 3, cap: 3}));
  const wl = await imp('desktop/e2e/lib/watch-list.mjs');
  await keep('watch-worse', 'Tests', () => wl.telegramText({day: '2026-11-09', judged: {worse: [{shape: 'workday-a', why: 'stopped at the CV step (was: reached the form)'}, {shape: 'greenhouse-b', why: '3 fields left (was 0)'}], held: ['x', 'y', 'z'], measured: Array(9).fill(0)}, usd: 0.3, monthSpent: 4.2}));
  return out;
}

test('every owner message of the public repo is one card: dot + bold headline, ≤12 lines, one link, no raw JSON, no secret or e-mail', async () => {
  const log = console.log;
  console.log = () => {};
  let made;
  try { made = await samples(); } finally { console.log = log; }
  const kinds = Object.keys(made);
  assert.ok(kinds.length >= 25, `positive control: ${kinds.length} kinds were built`);
  for (const id of kinds) {
    const one = made[id];
    assert.ok(!one.error, `${id}: the sender could not be built: ${one.error}`);
    assert.ok(!one.skipped, `${id}: the sender gave no message`);
    assert.deepEqual(checkCard(one.text), [], `${id}\n${one.text}`);
  }
});

test('checkCard refuses the shapes the owner called unreadable', () => {
  assert.ok(checkCard('plain text, no headline').length, 'no dot and bold headline');
  assert.ok(checkCard('🔴 <b>x</b>\n' + 'line\n'.repeat(13)).length, 'a wall of lines');
  assert.ok(checkCard('🔴 <b>x</b>\n<a href="https://a.b">one</a> <a href="https://c.d">two</a>').length, 'two links');
  assert.ok(checkCard('🔴 <b>x</b>\nsee https://example.com/run').length, 'a bare URL');
  assert.ok(checkCard('🔴 <b>x</b>\n{"screen":{"shown":true}}').length, 'raw JSON');
  assert.ok(checkCard('🔴 <b>x</b>\nwrite to someone@example.com').length, 'an e-mail address');
  assert.deepEqual(checkCard('🟢 <b>fine</b>\n✅ nothing to do\n<a href="https://a.b">Open it</a>'), []);
});
