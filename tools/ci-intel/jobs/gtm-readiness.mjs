#!/usr/bin/env node
// Publishes the GTM readiness snapshot to /admin/testing/gtm-readiness (a step of e2e-intel.yml, hourly). Tier 1: for each finished after-merge, nightly and beta e2e run, the registry's steps in the run's
// e2e-view-<suite> artifacts (steps.json, Mac and Windows). Tier 2: the registry's integration tests in the integration-results-* artifacts of the runs of "CI · Integration tests" (pull requests) and of
// "CI · Tests" on main (its integration job). The pure part is tools/ci-intel/jobs/gtm-readiness-rows.mjs; the stored snapshot (GET /gtm/data) says which runs were read, so a run is read once.
//   node tools/ci-intel/jobs/gtm-readiness.mjs [--dry [--out snapshot.json]]    needs gh with GH_TOKEN; publishing needs SELFHEAL_PUBLISH_KEY (optional GTM_INTEL_URL)
// Why a call budget (1 Nov 2026): the Actions token allows about 1,000 GitHub calls an hour and e2e-intel uses part of them; a pass reads at most MAX_CALLS and the newest runs first, the older ones the next hours.
// Report only: a failed read leaves the last snapshot in place and the run unread (read again next hour). Guard: jobadabra-web test/admin/gtm-readiness-collector.test.js.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadJourneys} from '../../../desktop/e2e/lib/critical-journeys.mjs';
import {kindOf, redJobs} from './e2e-intel-rows.mjs';
import {readResults} from './integration-intel.mjs';
import {BIG, expectedSeen, kindsRead, registryParts, runRows, runTests, snapshotOf, storedFrom, tally} from './gtm-readiness-rows.mjs';

const repo = process.env.REPO || process.env.GITHUB_REPOSITORY || 'jobadabra/jobadabra';
const base = process.env.GTM_INTEL_URL || 'https://www.jobpilotto.top/gtm/data';
const E2E_WORKFLOWS = ['desktop.yml', 'e2e.yml', 'e2e-windows.yml'], INTEGRATION_WORKFLOW = 'integration.yml', MAIN_WORKFLOW = 'build.yml', KEEP_DAYS = 28, MAX_CALLS = 450;
const execAsync = promisify(execFile);
let calls = 0;
const ghAsync = async (...args) => { calls += 1; try { return JSON.parse((await execAsync('gh', args, {maxBuffer: 1 << 28, timeout: 60000})).stdout || 'null'); } catch { return null; } };
const left = () => MAX_CALLS - calls;

/** One run's e2e-view artifacts (registry suites only, each under BIG) -> [{suite, os, results}]; null when a read failed (the run is read again next hour). */
async function readViews(runId, suites) {
  const listed = await ghAsync('api', `repos/${repo}/actions/runs/${runId}/artifacts?per_page=100`);
  if (!listed) return null;
  const wanted = (listed.artifacts || []).filter(item => /^e2e-view-/.test(item.name) && !item.expired && item.size_in_bytes < BIG)
    .map(item => ({item, os: item.name.startsWith('e2e-view-windows-') ? 'windows' : 'mac', suite: item.name.replace(/^e2e-view-(windows-)?/, '')})).filter(item => suites.has(item.suite.replace(/-\d+of\d+$/, '')));
  const dir = mkdtempSync(path.join(tmpdir(), 'gtm-readiness-')), views = [];
  try {
    for (const {item, os, suite} of wanted) {
      calls += 1;
      try {
        const zip = path.join(dir, `${item.id}.zip`);
        writeFileSync(zip, (await execAsync('gh', ['api', `repos/${repo}/actions/artifacts/${item.id}/zip`], {encoding: 'buffer', maxBuffer: 1 << 26, timeout: 60000})).stdout);
        const body = JSON.parse((await execAsync('unzip', ['-p', zip, 'steps.json'], {maxBuffer: 1 << 24})).stdout);
        views.push({suite, os, results: (body.results || []).filter(result => typeof result?.name === 'string').map(result => ({name: result.name, status: String(result.status)}))});
      } catch { return null; }
    }
  } finally { rmSync(dir, {recursive: true, force: true}); }
  return views;
}

async function main() {
  const key = process.env.SELFHEAL_PUBLISH_KEY, dry = process.argv.includes('--dry');
  if (!key && !dry) { console.log('::warning::SELFHEAL_PUBLISH_KEY is not set: nothing published.'); return; }
  const parts = registryParts(loadJourneys()), suites = new Set(parts.steps.map(step => step.suite));
  const since = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString().slice(0, 10), fields = 'databaseId,conclusion,createdAt,displayTitle,headSha,headBranch,event';
  let stored = {};
  if (key) {
    const response = await fetch(base, {headers: {Authorization: `Bearer ${key}`}}).catch(() => null);
    const decided = storedFrom(response?.status, response ? await response.json().catch(() => null) : null);
    if (decided.stop) { console.log(`::warning::${decided.stop}: nothing published, read again next hour.`); return; }
    stored = decided.stored;
  }
  const haveE2e = new Set(stored.read?.e2e || []), haveIntegration = new Set(stored.read?.integration || []);

  // Tier 1: oldest first among the runs to read, so "what a journey normally shows" grows in order; the newest runs come first into the pass.
  const listed = (await Promise.all(E2E_WORKFLOWS.map(async workflow => ((await ghAsync('run', 'list', '--repo', repo, '--workflow', workflow, '--limit', '1000', '--created', `>=${since}`, '--json', fields)) || [])
    .map(run => ({...run, workflow, kind: kindOf(run, workflow)}))))).flat().filter(run => kindsRead.includes(run.kind) && ['success', 'failure'].includes(run.conclusion) && !haveE2e.has(run.databaseId));
  const todo = listed.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 60);
  const sofar = [...(stored.tier1 || [])], added = [], readE2e = [];
  const chosen = [];
  for (const run of todo) {
    if (left() < 12) break;   // a run needs about 2 calls and one per suite artifact
    const [jobs, views] = [await ghAsync('api', `repos/${repo}/actions/runs/${run.databaseId}/jobs?per_page=100`), await readViews(run.databaseId, suites)];
    if (!jobs || !views) continue;
    chosen.push({run, views, red: redJobs({...run, jobs: jobs.jobs || []})});
  }
  for (const {run, views, red} of chosen.sort((a, b) => a.run.databaseId - b.run.databaseId)) {
    const rows = runRows({runId: run.databaseId, day: run.createdAt.slice(0, 10), kind: run.kind}, parts.steps, views, red, (journey, os) => expectedSeen(sofar, journey, os));
    sofar.push(...rows); added.push(...rows); readE2e.push(run.databaseId);
  }

  // Tier 2: the integration runs of pull requests and of main (build.yml's integration job holds the same result files).
  const lists = await Promise.all([ghAsync('run', 'list', '--repo', repo, '--workflow', INTEGRATION_WORKFLOW, '--limit', '500', '--created', `>=${since}`, '--json', fields),
    ghAsync('run', 'list', '--repo', repo, '--workflow', MAIN_WORKFLOW, '--branch', 'main', '--event', 'push', '--limit', '500', '--created', `>=${since}`, '--json', fields)]);
  const integration = lists.flatMap(list => list || []).filter(run => ['success', 'failure'].includes(run.conclusion) && !haveIntegration.has(run.databaseId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 40);
  let tier2 = stored.tier2 || [];
  const readIntegration = [];
  for (const run of integration) {
    if (left() < 3) break;
    calls += 1;
    const {ok, results} = await readResults(run.databaseId);
    if (!ok) continue;
    tier2 = tally(tier2, run.createdAt.slice(0, 10), runTests(parts.tests, results)); readIntegration.push(run.databaseId);
  }

  const snapshot = snapshotOf({journeys: parts.journeys, stored, tier1: added, tier2, read: {e2e: readE2e, integration: readIntegration}});
  console.log(`${listed.length} unread e2e runs in ${KEEP_DAYS} days, ${readE2e.length} read (${added.length} rows); ${integration.length} unread integration runs, ${readIntegration.length} read; ${calls} GitHub calls`);
  const out = process.argv.indexOf('--out');
  if (out > 0) writeFileSync(process.argv[out + 1], JSON.stringify(snapshot));
  if (dry) return;
  const response = await fetch(base, {method: 'PUT', headers: {Authorization: `Bearer ${key}`, 'Content-Type': 'application/json'}, body: JSON.stringify(snapshot)});
  console.log(`published ${snapshot.tier1.length} Tier 1 rows: HTTP ${response.status} ${await response.text()}`);
  if (!response.ok) process.exitCode = 1;
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main();
