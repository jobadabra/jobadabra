#!/usr/bin/env node
// The numbers behind https://www.jobadabra.top/admin/ai/harness (tab "Agent harness", owner, 4 Nov 2026: "details about each run. What happened. Some logs, some achievements, errors"): the CI fixer's plan rows (done / in progress / next),
// the context layers and sources as FILE FACTS (a fetcher file in the repo proves nothing about its key or a live read), and the last 30 days of run records the fixer writes (artifact `ai-fixer-record`, file `record.json`, schema v1).
// Reads data, runs nothing from it: a record is parsed as JSON (64 KB at most, only that one file); its run_id and url are replaced by GitHub's own for that run, so a record cannot point at another run. The site clamps and escapes every field.
// A run with no record is normal (a run before the record existed has none) and is left out: nothing is invented for it. Report only, never blocks anything. No AI, $0.
//   node tools/harness-stats.mjs [--out harness.json] [--plan docs/superpowers/plans/2026-11-04-ci-agent-until-green.md] [--now 2026-11-05T04:41:00Z]
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
const WINDOW_DAYS = 30, MAX_RUNS = 60, MAX_RECORD = 64 * 1024;
// Where each source's fetcher lives (docs/superpowers/specs/2026-11-03-harness-map-design.md, L3): a file there = "built".
export const SOURCES = [['Linear', 'tools/context/sources/linear.mjs'], ['Sentry', 'tools/context/sources/sentry.mjs'], ['GitHub', 'tools/context/sources/github.mjs'], ['PostHog', 'tools/context/sources/posthog.mjs'], ['Cloudflare', 'tools/context/sources/cloudflare.mjs'], ['Notion', 'tools/context/sources/notion.mjs']];

/** The Progress list of the plan -> {rows, web}: `- [x] 3/7 Name` rows (the chain, N = its last number) and `- [ ] web 1/3 Name` rows (this plan's pages on the private site). Every row {n, of, name, checked}. */
export function parsePlan(markdown) {
  const section = String(markdown).split(/^## Progress\s*$/m)[1] || '', rows = [], web = [];
  for (const line of section.split('\n')) {
    const found = /^- \[([ xX])\]\s+(web\s+)?(\d+)\/(\d+)\s+(.+?)\s*$/.exec(line);
    if (found) (found[2] ? web : rows).push({n: Number(found[3]), of: Number(found[4]), name: found[5].replace(/[`*]/g, ''), checked: found[1] !== ' '});
  }
  return {rows, web};
}

/** Rows + the PRs that carry them -> [{n, name, state, pr}]: done (ticked, or a merged PR titled `[tag] n/N ...`), doing (an open one), else next. `prs` = [{number, title, state, mergedAt, createdAt}]; a PR counts only for the N of its own group. */
export function chain(rows, prs, since = '') {
  return rows.map(row => {
    const title = new RegExp(`^(?:\\[[^\\]]*\\]\\s+)+${row.n}/${row.of}\\s`);
    const mine = prs.filter(pr => title.test(String(pr.title)) && String(pr.createdAt) >= since).sort((a, b) => b.number - a.number);
    const merged = mine.find(pr => pr.mergedAt), open = mine.find(pr => pr.state === 'OPEN');
    const state = row.checked || merged ? 'done' : open ? 'doing' : 'next';
    return {n: row.n, name: row.name, state, pr: (state === 'done' ? merged : open)?.number || 0};
  });
}

/** What exists in the repo, as the context layers and the sources (file facts only). `has(path)` and `count(dir, suffix)` read the checkout. */
export function layers(has, count) {
  const hubs = Math.max(0, count('docs/map', '.md') - (has('docs/map/index.md') ? 1 : 0)), built = SOURCES.filter(([, file]) => has(file)).length;
  const specs = count('docs/superpowers/specs', '.md'), rules = count('docs/rules', '.md'), skills = count('.claude/skills', '');
  return {layers: [{id: 'L0', name: 'Index', present: has('docs/map/index.md'), note: 'docs/map/index.md'}, {id: 'L1', name: 'Area hubs', present: hubs > 0, note: `${hubs} hub${hubs === 1 ? '' : 's'}`},
    {id: 'L2', name: 'Docs', present: specs + rules > 0, note: `${specs} specs, ${rules} rules, ${skills} skills`}, {id: 'L3', name: 'Live sources', present: built > 0, note: `${built} of ${SOURCES.length} fetchers`}],
  sources: SOURCES.map(([name, file]) => ({name, built: has(file)}))};
}

/** One run's record from its parsed JSON, or null when it is not an object. The run id and url are GitHub's own for this run, never the record's. */
export function recordOf(parsed, run) {
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? {...parsed, run_id: run.id, url: run.html_url} : null;
}

/** All of it -> the body to PUT: {kind: 'harness', days: [today's card]}. `input` = {plan, prs, webPrs, runs: [records]} (what fetchInput collects); `fs` = {has, count}. */
export function compute(input, fs, now = new Date()) {
  const {rows, web} = parsePlan(input.plan || ''), since = (PLAN.match(/(\d{4}-\d\d-\d\d)/) || [])[1] || '';
  return {kind: 'harness', days: [{day: now.toISOString().slice(0, 10), plan: {rows: chain(rows, input.prs || [], since), web: chain(web, input.webPrs || [], since)}, ...layers(fs.has, fs.count), runs: (input.runs || []).slice(0, MAX_RUNS)}]};
}

const gh = (...args) => JSON.parse(execFileSync('gh', args, {encoding: 'utf8', maxBuffer: 64 << 20}) || 'null');
const lsCount = (dir, suffix) => { try { return readdirSync(join(ROOT, dir)).filter(name => (suffix ? name.endsWith(suffix) : statSync(join(ROOT, dir, name)).isDirectory())).length; } catch { return 0; } };
const checkout = {has: file => existsSync(join(ROOT, file)), count: lsCount};

/** The record of each run (`run` = the gh api reader, `download(id, dir)` puts the artifact's files in dir: both injectable for the test) of the fixer in the window that has one (the run's artifact `ai-fixer-record`); a run without one, an expired artifact or an unreadable file is skipped. */
export function fetchRuns(repo, now, run = gh, download = (id, dir) => execFileSync('gh', ['run', 'download', String(id), '--repo', repo, '--name', ARTIFACT, '--dir', dir], {stdio: 'ignore'})) {
  const since = new Date(now.getTime() - WINDOW_DAYS * 86400000).toISOString().slice(0, 10), records = [];
  const list = run('api', `repos/${repo}/actions/workflows/${WORKFLOW}/runs?per_page=${MAX_RUNS}&created=>=${since}`, '--jq', '[.workflow_runs[] | {id, html_url}]') || [];
  for (const item of list) {
    const dir = mkdtempSync(join(tmpdir(), 'harness-'));
    try {
      const found = run('api', `repos/${repo}/actions/runs/${item.id}/artifacts?name=${ARTIFACT}`, '--jq', '[.artifacts[] | select(.expired == false) | .name]') || [];
      if (!found.length) continue;
      download(item.id, dir);
      const file = join(dir, FILE);
      if (!existsSync(file) || statSync(file).size > MAX_RECORD) continue;
      const record = recordOf(JSON.parse(readFileSync(file, 'utf8')), item);
      if (record) records.push(record);
    } catch (error) { console.error(`harness-stats: run ${item.id} skipped: ${String(error.message).split('\n')[0].slice(0, 120)}`); } finally { rmSync(dir, {recursive: true, force: true}); }
  }
  return records;
}
function fetchInput(plan, now, repo = process.env.REPO || PUBLIC_REPO) {
  const prs = (repoName) => { try { return gh('pr', 'list', '--repo', repoName, '--state', 'all', '--limit', '300', '--json', 'number,title,state,mergedAt,createdAt'); } catch { return []; } };
  return {plan: readFileSync(join(ROOT, plan), 'utf8'), prs: prs(repo), webPrs: prs(WEB_REPO), runs: fetchRuns(repo, now)};
}

function main(argv) {
  const arg = name => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : ''), now = arg('--now') ? new Date(arg('--now')) : new Date();
  const body = compute(fetchInput(arg('--plan') || PLAN, now), checkout, now);
  if (arg('--out')) writeFileSync(arg('--out'), JSON.stringify(body)); else console.log(JSON.stringify(body, null, 1));
  console.error(`harness-stats: ${body.days[0].runs.length} run record(s), ${body.days[0].plan.rows.length} plan rows`);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
