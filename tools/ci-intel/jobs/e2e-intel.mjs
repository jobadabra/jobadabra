#!/usr/bin/env node
// Publishes every finished e2e run of the last 30 days (beta, nightly, main after a merge, scheduled, soak, canary, PR, the daily harness tests) and the cause of
// each red suite to /admin/testing/e2e (e2e-intel.yml, hourly). The pure part (kinds, reds, causes) is tools/ci-intel/jobs/e2e-intel-rows.mjs; this file reads GitHub, asks the AI
// and publishes. A run is read once; a red whose cause is "open" or "unknown" is read again until its fix lands. Log text is searched for the failure line only:
// the line (a test step's own words, no personal data) is stored, the log never is. Guard: desktop/test/tooling/ci/ci-intel-e2e-intel-collector.test.js.
//   node tools/ci-intel/jobs/e2e-intel.mjs [--dry [--out rows.json]]    needs gh with GH_TOKEN; publishing needs SELFHEAL_PUBLISH_KEY (optional E2E_INTEL_URL)
//   AI for the reds no fact names: E2E_CAUSE_CF_TOKEN + E2E_CAUSE_CF_ACCOUNT (its own Workers AI token, never production's); without them those reds stay "unknown".
import {execFile, execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {nightOf, promptCasesOf} from '../lib/e2e-quality.mjs';
import {pathToFileURL} from 'node:url';
import {CAUSES, DIFF_MAX, RULES_VERSION} from '../lib/e2e-causes.mjs';
import {answerText, betaRunRow, betaRunsToRead, kindOf, namedToRedo, rateJobs, redJobs, rowsOf, runsToRead, nightRunsToRead} from './e2e-intel-rows.mjs';
import {WORK_IDS, parseLog, workRows, weekOf} from '../lib/e2e-work.mjs';
import {cleanLanes} from '../lib/e2e-grey.mjs';

const repo = process.env.REPO || process.env.GITHUB_REPOSITORY || 'jobadabra/jobadabra';
const base = process.env.E2E_INTEL_URL || 'https://www.jobpilotto.top/e2e/data';
const execAsync = promisify(execFile);
const WORKFLOWS = ['desktop.yml', 'e2e.yml', 'e2e-windows.yml', 'harness-daily.yml'];
const MAX_RUNS = 200, MAX_LOGS = 150, MAX_AI = 60;   // per pass (hourly): the newest first; the rest the next pass. A red with no log read stays "unknown" and is read again.
const MODEL = '@cf/qwen/qwen3-30b-a3b-fp8';   // the small Workers AI model CI already uses
const gh = (...args) => JSON.parse(execFileSync('gh', args, {encoding: 'utf8', maxBuffer: 1 << 28}) || 'null');
const ghAsync = async (...args) => { try { return JSON.parse((await execAsync('gh', args, {maxBuffer: 1 << 28, timeout: 60000})).stdout || 'null'); } catch { return null; } };
async function eight(items, work) { for (let at = 0; at < items.length; at += 8) await Promise.all(items.slice(at, at + 8).map(work)); }   // eight GitHub calls at a time
const memo = fn => { const seen = new Map(); return (...args) => { const key = JSON.stringify(args); if (!seen.has(key)) seen.set(key, fn(...args)); return seen.get(key); }; };

// The failing jobs' logs, searched in memory (never stored or sent).
async function readLogs(runs, jobsOf = redJobs) {
  const ids = runs.flatMap(run => jobsOf(run).map(job => job.jobId)).slice(0, MAX_LOGS), logs = new Map();
  await eight(ids, async id => {
    try { logs.set(id, (await execAsync('gh', ['api', '--allow-escape-sequences', `repos/${repo}/actions/jobs/${id}/logs`], {maxBuffer: 1 << 28, timeout: 90000})).stdout.replace(/\x1b\[[0-9;]*m/g, '')); } catch { logs.set(id, null); }
  });
  return logs;
}

// The night's live quality run -> its counts (tools/ci-intel/lib/e2e-quality.mjs) and the same run's prompt-case replay. A night is a scheduled run that holds a live quality job, found by that job and not by
// its title's pass number or its hour, so a re-plan of the night cannot silently empty the card (a8, 1 Nov 2026: "pick the night by its job"). Only runs of the last two days are looked at (a run
// without a live quality job is never stored, so it is read again each hour until it ages out): the other titles of e2e.yml (after merge, beta, bisect, PR) never hold one.
// Why (1 Nov 2026, found by reading git history, not yet by the D1 row): the filter was "E2E check" runs started 21-22 UTC, and the live run now rides "Night burn-in 1/5" (afe3595, 21:00 UTC);
// before that, 341cf97 (29 Oct) split quality into an exact `quality` job and the live `qualityai` job, which `/^quality\b/` does not match. listed: gh run list rows; stored: run ids the site has.
const NIGHT_DAYS = 2;
export const liveNights = (listed, stored, now = new Date()) => listed.filter(run => /^(E2E check|Night burn-in \d\/\d)/.test(run.displayTitle || '') && ['success', 'failure'].includes(run.conclusion)
  && new Date(run.createdAt).getTime() >= now.getTime() - NIGHT_DAYS * 86400000 && !stored.has(run.databaseId));

/**
 * One run's jobs -> its night: the counts of the first quality job whose log scored the jobs twice (the live `qualityai`; the exact `quality` job logs no second scoring), plus the counts the
 * run's "Prompt cases" job printed (none while that job is absent or printed nothing: promptCases null). null when no job of the run scored twice.
 * @param {{id: number, name: string}[]} jobs the run's jobs
 * @param {(id: number) => Promise<string>} logOf a job's log text
 */
export async function nightFromJobs(jobs, logOf) {
  const candidates = jobs.filter(job => /^quality/.test(job.name)).sort((a, b) => /^qualityai/.test(b.name) - /^qualityai/.test(a.name));
  let night = null;
  for (const job of candidates) { night = nightOf(await logOf(job.id)); if (night) break; }
  if (!night) return null;
  const prompt = jobs.find(job => /prompt cases/i.test(job.name));
  return {...night, promptCases: prompt ? promptCasesOf(await logOf(prompt.id)) : null};
}

/**
 * One run's jobs -> the counts its "Prompt cases" job printed, or null (no such job, or it printed nothing). Read on its own: a night that no quality job scored twice has no quality night
 * (nightFromJobs is null) but still has this replay. Why (jobadabra-web#259): the replay used to be sent only inside the quality night, so the site lost it on those nights.
 * @param {{id: number, name: string}[]} jobs the run's jobs
 * @param {(id: number) => Promise<string>} logOf a job's log text
 */
export async function promptNightFromJobs(jobs, logOf) {
  const prompt = jobs.find(job => /prompt cases/i.test(job.name));
  return prompt ? promptCasesOf(await logOf(prompt.id)) : null;
}

/**
 * One run's jobs -> {night, promptNight}: the quality night when a quality job scored twice (else null), and the run's replay beside it as `promptNights` row data (else null), each independent of
 * the other. The replay is read once: from the quality night when there is one.
 */
export async function readNight(run, jobs, logOf) {
  const night = await nightFromJobs(jobs, logOf);
  const promptCases = night ? night.promptCases : await promptNightFromJobs(jobs, logOf);
  return {night: night ? {runId: run.databaseId, day: run.createdAt.slice(0, 10), ...night} : null, promptNight: promptCases ? {runId: run.databaseId, day: run.createdAt.slice(0, 10), promptCases} : null};
}

async function readNights(runs) {
  const nights = [], promptNights = [];
  const logOf = async id => (await execAsync('gh', ['api', '--allow-escape-sequences', `repos/${repo}/actions/jobs/${id}/logs`], {maxBuffer: 1 << 28})).stdout;
  for (let at = 0; at < runs.length; at += 8) {
    await Promise.all(runs.slice(at, at + 8).map(async run => {
      try {
        const jobs = JSON.parse((await execAsync('gh', ['api', `repos/${repo}/actions/runs/${run.databaseId}/jobs?per_page=100`], {maxBuffer: 1 << 28})).stdout).jobs || [];
        const {night, promptNight} = await readNight(run, jobs, logOf);
        if (night) nights.push(night);
        if (promptNight) promptNights.push(promptNight);
      } catch { /* a run whose log cannot be read is read again next hour */ }
    }));
  }
  return {nights, promptNights};
}

const ESCAPE = /^Escaped-e2e:[ \t]*([^\r\n]*)$/im;

/** Parse an escape trailer without I/O; absent or malformed records return null. */
// Guard: desktop/test/ci-intel-e2e-intel-collector.test.js.
export function escapeOf(message) {
  const value = ESCAPE.exec(String(message))?.[1].trim() || '';
  const parts = /^(.+?)[ \t]+—[ \t]+(\S.*)$/.exec(value);
  if (!parts) return null;
  const [, list, journey] = parts;
  if (list === 'no suite') return {suites: [], none: true, journey};
  const suites = list.split(',').map(suite => suite.trim());
  if (suites.some(suite => !/^[a-z0-9][a-z0-9-]*$/i.test(suite))) return null;
  return {suites, none: false, journey};
}

// Where e2e work goes (tools/ci-intel/lib/e2e-work.mjs): the public repo's main since `since`, from one blob-less shallow clone (no API call per commit). The clone starts two
// days earlier: git lists every file of a shallow clone's oldest commit as added. A failed read sends no work rows this hour and says so.
/** Read work counts and escaped journeys from the same public-main clone; omit escapes on failure so the snapshot retains its last successful read. */
export function readWork(since, git = execFileSync) {
  const dir = mkdtempSync(path.join(tmpdir(), 'e2e-work-')), from = new Date(Date.parse(since) - 2 * 86400000).toISOString().slice(0, 10);
  try {
    git('git', ['clone', '-q', '--filter=blob:none', '--no-checkout', '--single-branch', '--branch=main', `--shallow-since=${from}`, `https://github.com/${repo}.git`, dir], {timeout: 180000});
    // Why (28 Oct 2026, measured on 35 days): rename detection fetches every renamed file's contents into the blob-less clone, 37 s and +10 MB; --no-renames reads trees only, 0.4 s.
    const work = workRows(parseLog(git('git', ['-C', dir, 'log', '--no-merges', '--no-renames', `--since=${since}`, '--format=@@%H %cs', '--name-only'], {encoding: 'utf8', maxBuffer: 1 << 28})));
    // Include merge commits too: a trailer on a main commit is an escape regardless of how it landed.
    const log = git('git', ['-C', dir, 'log', `--since=${since}`, '--format=%x1e%H%x00%cs%x00%B'], {encoding: 'utf8', maxBuffer: 1 << 28});
    const escapes = log.split('\x1e').slice(1).flatMap(record => {
      const [sha, day, message] = record.split('\0'), escape = escapeOf(message);
      return escape ? [{week: weekOf(day), sha, ...escape}] : [];
    });
    return {...work, escapes};
  } catch (error) {
    console.log(`::warning::where e2e work goes was not read this hour: ${String(error?.message || error).slice(0, 200)}`);
    return {work: [], files: []};
  } finally { rmSync(dir, {recursive: true, force: true}); }
}

/** Read this repo's lane registry from main; an unreadable registry is omitted so the snapshot retains its last read. */
export async function readLanes(read = ghAsync) {
  const lanes = cleanLanes(await read('api', `repos/${repo}/contents/desktop/e2e/lanes.json?ref=main`, '-H', 'Accept: application/vnd.github.raw+json'));
  if (!lanes) console.log('::warning::lane registry not read this hour');
  return lanes || undefined;
}

let aiCalls = 0, aiNeurons = 0;
async function ask({system, user}) {
  const token = process.env.E2E_CAUSE_CF_TOKEN, account = process.env.E2E_CAUSE_CF_ACCOUNT;
  if (!token || !account || aiCalls >= MAX_AI) return null;
  aiCalls += 1;
  try {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${MODEL}`, {method: 'POST', headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({messages: [{role: 'system', content: system}, {role: 'user', content: `${user}\n/no_think`}], max_tokens: 800, temperature: 0}), signal: AbortSignal.timeout(60000)});   // /no_think: qwen3 spent the whole answer on its reasoning (27 Oct 2026)
    const data = await response.json();
    aiNeurons += Number(data?.result?.usage?.total_tokens) || 0;
    return answerText(data);
  } catch { return null; }
}

const deps = {
  commitsBetween: memo(async (from, to) => (await ghAsync('api', `repos/${repo}/compare/${from}...${to}`, '--jq', '[.commits[] | {sha, message: .commit.message}]'))),
  filesBetween: memo(async (from, to) => (from === to ? [] : await ghAsync('api', `repos/${repo}/compare/${from}...${to}`, '--jq', '[.files[].filename]'))),
  filesOf: memo(async sha => ghAsync('api', `repos/${repo}/commits/${sha}`, '--jq', '[.files[].filename]')),
  diffOf: memo(async sha => { try { return (await execAsync('gh', ['api', '-H', 'Accept: application/vnd.github.diff', `repos/${repo}/commits/${sha}`], {maxBuffer: 1 << 26, timeout: 60000})).stdout.slice(0, DIFF_MAX); } catch { return null; } }),
  prFiles: memo(async pr => {
    if (!pr) return [];
    try { return (await execAsync('gh', ['api', '--paginate', `repos/${repo}/pulls/${pr}/files?per_page=100`, '--jq', '.[].filename'], {maxBuffer: 1 << 26, timeout: 60000})).stdout.split('\n').filter(Boolean); } catch { return null; }
  }),
  ask,
};

// Why (2 Nov 2026, owner: "has this caught bug been counted?"): the main commits whose "E2E-cause:" trailer may name run ids, newest first (tools/ci-intel/lib/e2e-causes.mjs namedCause reads the exact words;
// this filter only keeps the list short). A read that fails gives none: the window rule answers this pass and the next pass asks again.
async function readNamedCommits(since) {
  try {
    const out = (await execAsync('gh', ['api', '--paginate', `repos/${repo}/commits?sha=main&since=${since}T00:00:00Z&per_page=100`, '--jq',
      '.[] | select(.commit.message | test("(^|\\n)[ \\t]*E2E-cause:[^\\n]*[0-9]{6}"; "i")) | {sha, message: .commit.message} | tojson'], {maxBuffer: 1 << 26, timeout: 120000})).stdout;
    return out.split('\n').filter(Boolean).map(line => JSON.parse(line));
  } catch (error) { console.log(`::warning::named fixes not read this pass (${String(error?.message || error).slice(0, 120)}): the window rule answers; the next pass asks again`); return []; }
}

async function main() {
  const key = process.env.SELFHEAL_PUBLISH_KEY, dry = process.argv.includes('--dry');
  if (!key && !dry) { console.log('::warning::SELFHEAL_PUBLISH_KEY is not set: nothing published.'); return; }
  const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const prOf = Object.fromEntries((gh('pr', 'list', '--repo', repo, '--state', 'all', '--limit', '1000', '--search', `created:>=${since}`, '--json', 'number,headRefName') || []).map(pr => [pr.headRefName, pr.number]));
  const listed = WORKFLOWS.flatMap(workflow => (gh('run', 'list', '--repo', repo, '--workflow', workflow, '--limit', '1000', '--created', `>=${since}`, '--json', 'databaseId,conclusion,createdAt,updatedAt,displayTitle,headSha,headBranch,event') || [])
    .map(run => ({...run, workflow, kind: kindOf(run, workflow)})))
    .filter(run => run.kind && ['success', 'failure', 'cancelled'].includes(run.conclusion)).map(run => ({...run, pr: run.kind === 'pr' ? prOf[run.headBranch] || null : null}))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  let have = [], pending = [], reds = [], quality = [], prompts = [], suiteNights = [], betaStored = [];
  if (key) ({have, pending, reds = [], quality = [], prompts = [], suiteNights = [], betaRuns: betaStored = []} = await (await fetch(`${base}?v=${RULES_VERSION}`, {headers: {Authorization: `Bearer ${key}`}})).json());
  const settled = new Set(have), waiting = new Set(pending);
  // A run is stored once it has a quality night or a replay (the site lists both): a replay-only night is not read again every hour.
  const {nights, promptNights} = await readNights(liveNights(listed.filter(run => run.workflow === 'e2e.yml'), new Set([...quality, ...prompts])).slice(0, 40));
  const namedCommits = await readNamedCommits(since);
  const todo = runsToRead(listed, settled, waiting, MAX_RUNS, namedToRedo(namedCommits, reds));   // a trailer that names a run reads it again, once
  const lanes = await readLanes();
  const work = readWork(new Date(Date.now() - 35 * 86400000).toISOString().slice(0, 10));
  console.log(`${listed.length} finished e2e runs in 30 days, ${settled.size} stored, ${todo.length} to read; ${nights.length} new live quality night(s), ${promptNights.length} prompt-case replay(s); ${work.work.length / WORK_IDS.length} days of commits`);
  // A fix is looked for in the later runs of the same line (main, or the PR's branch): read the jobs from the oldest run to read onwards (at most 400 runs).
  const fixes = todo.length ? listed.slice(listed.findIndex(run => run.databaseId === todo[0].databaseId)).slice(0, 400) : [];
  // Backfill already-settled nights too: old snapshots have no suite greens. These are existing jobs, not new suite runs or AI calls.
  const history = nightRunsToRead(listed, new Set(suiteNights));
  const needed = [...new Map([...history, ...fixes].map(run => [run.databaseId, run])).values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  // The beta runs the site has no suite counts for (tools/ci-intel/lib/e2e-beta.mjs): their jobs are read too; a failed read leaves jobs unset so the run is tried again next hour, never stored as zero suites.
  const betas = betaRunsToRead(listed, new Set(betaStored));
  const readJobs = async run => { const read = await ghAsync('api', `repos/${repo}/actions/runs/${run.databaseId}/jobs?per_page=100`); run.jobs = read ? read.jobs || [] : undefined; };
  await eight([...new Map([...needed, ...betas].map(run => [run.databaseId, run])).values()], readJobs);
  const wanted = new Set(todo.map(run => run.databaseId));
  // Why (1 Nov 2026, mac-07 for the owner): the nights not stored yet also give their interactions job's log, green or red, for its rates (tools/ci-intel/lib/e2e-rates.mjs); a stored night is not read again.
  const logs = new Map([...await readLogs(needed.filter(run => wanted.has(run.databaseId)).reverse()), ...await readLogs(history, rateJobs)]);
  const rows = await rowsOf(needed, {logOf: id => (logs.has(id) ? logs.get(id) : null), ...deps, namedCommits});
  const send = {runs: rows.runs.filter(row => wanted.has(row.runId)), fails: rows.fails.filter(row => wanted.has(row.runId)), quality: nights, promptNights, work: work.work, workFiles: work.files, escapes: work.escapes, lanes, suiteNights: rows.suiteNights, betaRuns: betas.map(run => betaRunRow(run)).filter(Boolean)};
  console.log(JSON.stringify(Object.fromEntries(CAUSES.map(cause => [cause.id, send.fails.filter(fail => fail.cause === cause.id).length]))));
  console.log(`AI: ${aiCalls} call(s), ${aiNeurons} tokens on ${MODEL}${process.env.E2E_CAUSE_CF_TOKEN ? '' : ' (no E2E_CAUSE_CF_TOKEN: reds no fact names stay unknown)'}`);
  const out = process.argv.indexOf('--out');
  if (out > 0) writeFileSync(process.argv[out + 1], JSON.stringify(send));
  if (dry) return;
  const response = await fetch(base, {method: 'PUT', headers: {Authorization: `Bearer ${key}`, 'Content-Type': 'application/json'}, body: JSON.stringify({rules: RULES_VERSION, ...send})});
  console.log(`published ${send.runs.length} runs, ${send.fails.length} reds, ${nights.length} quality nights, ${promptNights.length} replays: HTTP ${response.status} ${await response.text()}`);
  if (!response.ok) process.exitCode = 1;
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main();
