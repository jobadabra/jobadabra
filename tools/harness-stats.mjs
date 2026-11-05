#!/usr/bin/env node
// The numbers behind https://www.jobadabra.top/admin/ai/harness (tab "Agent harness", owner, 4 Nov 2026: "details about each run. What happened. Some logs, some achievements, errors"): the CI fixer's plan rows (done / in progress / next),
// the context layers and sources as FILE FACTS (a fetcher file in the repo proves nothing about its key or a live read), and the last 30 days of run records the fixer writes (artifact `ai-fixer-record`, file `record.json`, schema v1).
// Reads data, runs nothing from it: a record is parsed as JSON (64 KB at most, only that one file); its run_id and url are replaced by GitHub's own for that run, so a record cannot point at another run. The site clamps and escapes every field.
// A run with no record is normal (a run before the record existed has none) and is left out: nothing is invented for it. Report only, never blocks anything. No AI, $0.
//   node tools/harness-stats.mjs [--out harness.json] [--plan docs/superpowers/plans/2026-11-04-ci-agent-until-green.md] [--keys keys.json] [--now 2026-11-05T04:41:00Z]
// Needs gh with GH_TOKEN. Fed by .github/workflows/harness-stats.yml (daily, and when "CI · AI fixer" completes). Test: desktop/test/tooling/ci/harness-stats.test.js.
import {execFileSync} from 'node:child_process';
import {existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PUBLIC_REPO, WEB_REPO} from '../desktop/e2e/lib/repos.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const PLAN = 'docs/superpowers/plans/2026-11-04-ci-agent-until-green.md';
export const WORKFLOW = 'ai-fixer.yml', ARTIFACT = 'ai-fixer-record', FILE = 'record.json';
const WINDOW_DAYS = 30, LIST_RUNS = 100, MAX_RUNS = 60, MAX_RECORD = 64 * 1024, MAX_BODY = 350000;   // the site refuses a body over 400,000 characters
// Where each source's fetcher lives (docs/superpowers/specs/2026-11-03-harness-map-design.md, L3): a file there = "built".
// [name, fetcher file, the GitHub secret holding its read-only key]; GitHub reads with the run's own token (no stored key).
export const SOURCES = [['Linear', 'tools/context/sources/linear.mjs', 'LINEAR_READ_KEY'], ['Sentry', 'tools/context/sources/sentry.mjs', 'SENTRY_READ_TOKEN'], ['GitHub', 'tools/context/sources/github.mjs', ''], ['PostHog', 'tools/context/sources/posthog.mjs', 'POSTHOG_READ_KEY'], ['Cloudflare', 'tools/context/sources/cloudflare.mjs', 'CLOUDFLARE_READ_TOKEN'], ['Notion', 'tools/context/sources/notion.mjs', 'NOTION_READ_TOKEN']];

/** The Progress list of the plan -> {rows, web}: `- [x] 3/7 Name` rows (the chain, N = its last number) and `- [ ] web 1/3 Name` rows (this plan's pages on the private site). Every row {n, of, name, checked}. */
export function parsePlan(markdown) {
  const section = (String(markdown).split(/^## Progress\s*$/m)[1] || '').split(/^## /m)[0], rows = [], web = [];   // Why (review, 4 Nov 2026): up to the next heading, not the end of the file
  for (const line of section.split('\n')) {
    const found = /^- \[([ xX])\]\s+(web\s+)?(\d+)\/(\d+)\s+(.+?)\s*$/.exec(line);
    if (found) (found[2] ? web : rows).push({n: Number(found[3]), of: Number(found[4]), name: found[5].replace(/[`*]/g, ''), checked: found[1] !== ' '});
  }
  return {rows, web};
}

/** Rows + the PRs that carry them -> [{n, name, state, pr}]: done (ticked, or a merged PR titled `[tag] n/N ...`), doing (an open one), else next. `prs` = [{number, title, body, state, mergedAt, createdAt}].
 * A PR counts only for the N of its own group AND when its body names this plan's file (the PR template's "Plan progress" block carries it), so another plan's `3/6` never flips a row (review, 4 Nov 2026). */
export function chain(rows, prs, since = '', plan = PLAN) {
  return rows.map(row => {
    const title = new RegExp(`^(?:\\[[^\\]]*\\]\\s+)+${row.n}/${row.of}\\s`);
    const mine = prs.filter(pr => title.test(String(pr.title)) && String(pr.body || '').includes(plan.split('/').pop()) && String(pr.createdAt) >= since).sort((a, b) => b.number - a.number);
    const merged = mine.find(pr => pr.mergedAt), open = mine.find(pr => pr.state === 'OPEN');
    const state = row.checked || merged ? 'done' : open ? 'doing' : 'next';
    return {n: row.n, name: row.name, state, pr: (state === 'done' ? merged : open)?.number || 0};
  });
}

/**
 * Why (5 Nov 2026, owner: "why it shows that PostHog is green when you say is not connected"): a source is "built" (its fetcher file exists) and has a key 'set' or 'missing'. `keys` = {SECRET_NAME: true|false}
 * written by one trusted CI step that only tests whether each secret is non-empty; no entry = '' (the page then claims nothing). A stored key is still not a live read.
 */
export function keyState(secret, keys = {}) {
  if (!secret) return 'set';
  return keys[secret] === true ? 'set' : keys[secret] === false ? 'missing' : '';
}

/** What exists in the repo, as the context layers and the sources (file facts, plus which keys are stored). `has(path)` and `count(dir, suffix)` read the checkout. */
export function layers(has, count, keys = {}) {
  const hubs = Math.max(0, count('docs/map', '.md') - (has('docs/map/index.md') ? 1 : 0)), built = SOURCES.filter(([, file]) => has(file)).length;
  const specs = count('docs/superpowers/specs', '.md'), rules = count('docs/rules', '.md'), skills = count('.claude/skills', '');
  return {layers: [{id: 'L0', name: 'Index', present: has('docs/map/index.md'), note: 'docs/map/index.md'}, {id: 'L1', name: 'Area hubs', present: hubs > 0, note: `${hubs} hub${hubs === 1 ? '' : 's'}`},
    {id: 'L2', name: 'Docs', present: specs + rules > 0, note: `${specs} specs, ${rules} rules, ${skills} skills`}, {id: 'L3', name: 'Live sources', present: built > 0, note: `${built} of ${SOURCES.length} fetchers`}],
  sources: SOURCES.map(([name, file, secret]) => ({name, built: has(file), key: has(file) ? keyState(secret, keys) : ''}))};
}

/** One run's record from its parsed JSON: a COPY of the known fields, each bounded (no unknown key, no nesting, a few KB at most), or null when it is not an object. The run id and url are GitHub's own for this run, never the record's. */
export function recordOf(parsed, run) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const str = (value, max) => (typeof value === 'string' ? value.slice(0, max) : ''), num = value => (Number.isFinite(value) ? value : 0), list = (value, max) => (Array.isArray(value) ? value.slice(0, max) : []);
  return {v: parsed.v === 1 ? 1 : 0, workflow: str(parsed.workflow, 20), run_id: run.id, url: run.html_url, started: str(parsed.started, 32), minutes: num(parsed.minutes), source: str(parsed.source, 12), ref: str(parsed.ref, 40), round: num(parsed.round),
    engine: str(parsed.engine, 60), model: str(parsed.model, 60), turns: num(parsed.turns), calls: num(parsed.calls), tokens_in: num(parsed.tokens_in), tokens_out: num(parsed.tokens_out), steps: list(parsed.steps, 30).map(step => ({n: num(step?.n), action: str(step?.action, 20), s: num(step?.s), ok: step?.ok !== false, refusal: str(step?.refusal, 16), path: str(step?.path, 60), tout: num(step?.tout)})),   // s = seconds, ok = not refused, tout = tokens written (5/7: where the run lost time; capped at the loop's 30 turns)
    blocked_by: str(parsed.blocked_by, 20), verdict: str(parsed.verdict, 24), reason: str(parsed.reason, 400), changed_files: list(parsed.changed_files, 20).map(file => str(file, 120)), pr: Number.isInteger(parsed.pr) ? parsed.pr : null, stop: str(parsed.stop, 20), errors: list(parsed.errors, 5).map(error => str(error, 200))};
}

/** All of it -> the body to PUT: {kind: 'harness', days: [today's card]}. `input` = {plan, prs, webPrs, runs: [records], keys: {SECRET_NAME: boolean}} (what fetchInput collects); `fs` = {has, count}. */
export function compute(input, fs, now = new Date(), maxBody = MAX_BODY) {
  const {rows, web} = parsePlan(input.plan || ''), since = (PLAN.match(/(\d{4}-\d\d-\d\d)/) || [])[1] || '';
  const body = {kind: 'harness', days: [{day: now.toISOString().slice(0, 10), plan: {rows: chain(rows, input.prs || [], since), web: chain(web, input.webPrs || [], since)}, ...layers(fs.has, fs.count, input.keys), runs: (input.runs || []).slice(0, MAX_RUNS)}]};
  while (body.days[0].runs.length && JSON.stringify(body).length > maxBody) body.days[0].runs.pop();   // the oldest go first, so the plan and layers always arrive
  return body;
}

const gh = (...args) => JSON.parse(execFileSync('gh', args, {encoding: 'utf8', maxBuffer: 64 << 20}) || 'null');
const lsCount = (dir, suffix) => { try { return readdirSync(join(ROOT, dir)).filter(name => (suffix ? name.endsWith(suffix) : statSync(join(ROOT, dir, name)).isDirectory())).length; } catch { return 0; } };
const checkout = {has: file => existsSync(join(ROOT, file)), count: lsCount};

const PHASES = ['guard', 'fix', 'prove', 'publish', 'after', 'record'];
/**
 * Where a run's time went, from GitHub's OWN timestamps (never the artifact, so a record cannot claim them): `queue` = the run's start until its first job started, then each known job's seconds in the order the workflow has them.
 * `jobs` = [{name, started_at, completed_at}]. A job that never ran (skipped) or has no end is left out; every number is whole seconds, never negative.
 */
export function phasesOf(jobs, runStarted) {
  const list = (Array.isArray(jobs) ? jobs : []).filter(job => job && typeof job === 'object' && PHASES.includes(job.name) && Date.parse(job.started_at) > 0 && Date.parse(job.completed_at) > 0);
  if (!list.length || !(Date.parse(runStarted) > 0)) return [];
  const secs = (from, to) => Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 1000));
  const first = list.reduce((min, job) => (Date.parse(job.started_at) < Date.parse(min) ? job.started_at : min), list[0].started_at);
  return [{name: 'queue', s: secs(runStarted, first)}, ...PHASES.map(name => list.find(job => job.name === name)).filter(Boolean).map(job => ({name: job.name, s: secs(job.started_at, job.completed_at)}))];
}

/** The record of each run of the fixer in the window that has one (the run's artifact `ai-fixer-record`). Normal and skipped: no artifact, an expired one, a file over 64 KB or not JSON. A gh failure (rate limit, 5xx, auth) is NOT "no data": it throws,
 * so the job fails and the stored card stays as it was (review, 4 Nov 2026). `run` = the gh api reader, `download(id, dir)` puts the artifact's files in dir: both injectable for the test. */
export function fetchRuns(repo, now, run = gh, download = (id, dir) => execFileSync('gh', ['run', 'download', String(id), '--repo', repo, '--name', ARTIFACT, '--dir', dir], {stdio: 'ignore'})) {
  const since = new Date(now.getTime() - WINDOW_DAYS * 86400000).toISOString().slice(0, 10), records = [];
  const list = run('api', `repos/${repo}/actions/workflows/${WORKFLOW}/runs?per_page=${LIST_RUNS}&created=>=${since}`, '--jq', '[.workflow_runs[] | {id, html_url, run_started_at}]') || [];
  if (list.length >= LIST_RUNS) console.error(`harness-stats: ${LIST_RUNS} runs listed, older ones are not read`);
  for (const item of list) {
    const found = run('api', `repos/${repo}/actions/runs/${item.id}/artifacts?name=${ARTIFACT}`, '--jq', `[.artifacts[] | select(.expired == false and .size_in_bytes <= ${MAX_RECORD}) | .name]`) || [];   // the size is the zip's: a bigger one is never extracted
    if (!found.length) continue;
    const dir = mkdtempSync(join(tmpdir(), 'harness-'));
    try {
      download(item.id, dir);
      const file = join(dir, FILE);
      if (!existsSync(file) || !statSync(file).isFile() || statSync(file).size > MAX_RECORD) continue;
      let parsed;
      try { parsed = JSON.parse(readFileSync(file, 'utf8')); } catch { console.error(`harness-stats: run ${item.id} skipped: record.json is not JSON`); continue; }
      const record = recordOf(parsed, item);
      if (record) records.push({...record, phases: phasesOf(run('api', `repos/${repo}/actions/runs/${item.id}/jobs?per_page=30`, '--jq', '[.jobs[] | {name, started_at, completed_at}]'), item.run_started_at)});   // a gh failure throws, as above
    } finally { rmSync(dir, {recursive: true, force: true}); }
  }
  return records;
}
function fetchInput(plan, now, keysFile = '', repo = process.env.REPO || PUBLIC_REPO) {
  // Why (4 Nov 2026): jobadabra-web is PUBLIC (owner, 1 Nov 2026: keep all repos public for now), so the run's own token reads its pull requests; making it private again needs a read token here (Gitar #3188 assumed private).
  const prs = repoName => gh('pr', 'list', '--repo', repoName, '--state', 'all', '--limit', '300', '--json', 'number,title,body,state,mergedAt,createdAt');   // an error throws: never store "every row is next" because GitHub failed
  return {plan: readFileSync(join(ROOT, plan), 'utf8'), prs: prs(repo), webPrs: prs(WEB_REPO), runs: fetchRuns(repo, now), keys: readKeys(keysFile)};
}

/** The key-state file written by the workflow's one tiny step: only booleans for the names in SOURCES are kept; a missing or broken file means 'not reported', never 'missing'. */
export function readKeys(file) {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')), known = new Set(SOURCES.map(source => source[2]).filter(Boolean));
    return Object.fromEntries(Object.entries(raw).filter(([name, value]) => known.has(name) && typeof value === 'boolean'));
  } catch { return {}; }
}

function main(argv) {
  const arg = name => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : ''), now = arg('--now') ? new Date(arg('--now')) : new Date();
  const body = compute(fetchInput(arg('--plan') || PLAN, now, arg('--keys')), checkout, now);
  if (arg('--out')) writeFileSync(arg('--out'), JSON.stringify(body)); else console.log(JSON.stringify(body, null, 1));
  console.error(`harness-stats: ${body.days[0].runs.length} run record(s), ${body.days[0].plan.rows.length} plan rows`);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
