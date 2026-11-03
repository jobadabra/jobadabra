#!/usr/bin/env node
// The numbers behind the admin tab "CI Agents" (owner, 3 Nov 2026): for each agent of tools/ci-agents.json its last runs, whether it is on, and what it opened in 30 days (PRs by branch prefix, issues by label).
// Counts and short fixed labels only: no PR title, issue text, branch name or log leaves GitHub. Report only: it never blocks anything. No AI, $0.
//   node tools/ci-agents-stats.mjs [--out agents.json] [--input input.json --now 2026-11-03T12:00:00Z]
// Needs gh with GH_TOKEN unless --input. --out writes the body agent-coding-stats.yml PUTs to /agent-coding/data (kind "agents"; the site keeps one row per day).
// Input (what fetchInput collects): {workflows: {<file>: {state, runs: [{conclusion, status, created_at}]}}  (runs newest first), prs: [{headRefName, state, createdAt, mergedAt}], issues: {<label>: [{state, createdAt}]}}.
import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {PUBLIC_REPO} from '../desktop/e2e/lib/repos.mjs';

const WINDOW_DAYS = 30, RUNS_SHOWN = 8;
const LETTER = {success: 'g', failure: 'r', timed_out: 'r', startup_failure: 'r', skipped: 's', cancelled: 'c'};
export const registry = () => JSON.parse(readFileSync(fileURLToPath(new URL('./ci-agents.json', import.meta.url)), 'utf8'));

// The last runs (newest first) -> letters oldest first: g green, r red, s skipped, c cancelled, . running or unknown.
export const letters = runs => runs.slice(0, RUNS_SHOWN).reverse().map(run => LETTER[run.conclusion] || '.').join('');
// on = runs; idle = every recent run was skipped or none exists (a switch is off, or it never ran); off = the workflow is disabled in GitHub.
export const stateOf = (state, runs) => (state && state !== 'active' ? 'off' : runs.length && runs.every(run => run.conclusion === 'skipped') ? 'idle' : !runs.length ? 'idle' : 'on');

/** PRs opened by an agent's branch prefixes in the window, by outcome: {opened, merged, closed, open}. */
export function prCounts(prs, prefixes = [], since) {
  const mine = prs.filter(pr => prefixes.some(prefix => String(pr.headRefName).startsWith(prefix)) && String(pr.createdAt) >= since);
  const merged = mine.filter(pr => pr.mergedAt).length, open = mine.filter(pr => pr.state === 'OPEN').length;
  return {opened: mine.length, merged, closed: mine.length - merged - open, open};
}
/** Issues an agent filed (its label) in the window: {opened, closed}. */
export function issueCounts(issues = [], since) {
  const mine = issues.filter(issue => String(issue.createdAt) >= since);
  return {opened: mine.length, closed: mine.filter(issue => issue.state === 'CLOSED').length};
}

/** input + registry -> the body to PUT: {kind: 'agents', days: [today's card]}. */
export function compute(input, reg = registry(), now = new Date()) {
  const since = new Date(now.getTime() - WINDOW_DAYS * 86400000).toISOString();
  const agents = reg.agents.filter(row => row.repo === 'jobadabra').map(row => {
    const flow = input.workflows?.[row.file] || {state: '', runs: []};
    const out = {id: row.id, name: row.name, issuesOnly: Boolean(row.issuesOnly), starts: row.starts, acts: row.acts, engine: row.engine, today: row.today,
      state: stateOf(flow.state, flow.runs), runs: letters(flow.runs), lastRun: String(flow.runs[0]?.created_at || '').slice(0, 10)};
    if (row.branches) out.prs = prCounts(input.prs || [], row.branches, since);
    if (row.label) out.issues = issueCounts(input.issues?.[row.label], since);
    return out;
  });
  return {kind: 'agents', days: [{day: now.toISOString().slice(0, 10), agents}]};
}

const gh = (...args) => JSON.parse(execFileSync('gh', args, {encoding: 'utf8', maxBuffer: 64 << 20}) || 'null');
function fetchInput(reg, repo = process.env.REPO || PUBLIC_REPO) {
  const input = {workflows: {}, prs: [], issues: {}};
  for (const row of reg.agents.filter(item => item.repo === 'jobadabra')) {
    const base = `repos/${repo}/actions/workflows/${row.file}`;
    const state = gh('api', base, '--jq', '{state}').state, runs = gh('api', `${base}/runs?per_page=${RUNS_SHOWN}`, '--jq', '[.workflow_runs[] | {conclusion, status, created_at}]');
    input.workflows[row.file] = {state, runs};
    if (row.label) input.issues[row.label] = gh('issue', 'list', '--repo', repo, '--label', row.label, '--state', 'all', '--limit', '300', '--json', 'state,createdAt');
  }
  input.prs = gh('pr', 'list', '--repo', repo, '--state', 'all', '--limit', '500', '--json', 'headRefName,state,createdAt,mergedAt');
  return input;
}

function main(argv) {
  const arg = name => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : '');
  const reg = registry(), now = arg('--now') ? new Date(arg('--now')) : new Date();
  const card = compute(arg('--input') ? JSON.parse(readFileSync(arg('--input'), 'utf8')) : fetchInput(reg), reg, now);
  if (arg('--out')) writeFileSync(arg('--out'), JSON.stringify(card)); else console.log(JSON.stringify(card, null, 1));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
