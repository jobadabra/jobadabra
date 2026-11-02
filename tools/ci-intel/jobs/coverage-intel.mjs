// Reads the public repo's nightly coverage report for the integration snapshot (tools/ci-intel/jobs/integration-intel.mjs puts the result in the same PUT as everything else on /admin/testing/integrations:
// no second route, table, secret or schedule). The report (tools/coverage-report.mjs, public repo) runs as a job of e2e.yml's night pass or by hand (coverage-report.yml); either way its
// artifact is named `coverage-report` and holds report.json (layers, folders, journeys). The newest unexpired one is read once (its run id is kept); none, expired or unreadable keeps what
// the snapshot already stores. Pure parts are exported for jobadabra-web test/admin/coverage-card.test.js. Report only: nothing here judges a number.
import {execFile} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import {cleanCoverage, COVERAGE_LAYERS, KEEP_HISTORY} from '../lib/coverage-intel.mjs';

const execAsync = promisify(execFile);
export const ARTIFACT = 'coverage-report';

const ghJson = async (...args) => JSON.parse((await execAsync('gh', args, {maxBuffer: 1 << 26, timeout: 60000})).stdout || 'null');
const downloadReport = async (repo, runId, dir) => execAsync('gh', ['run', 'download', String(runId), '--repo', repo, '--name', ARTIFACT, '--dir', dir], {timeout: 120000});

/** The newest unexpired `coverage-report` artifact of the public repo: {runId, sha}, or null when there is none. */
export async function newestReport(repo, json = ghJson) {
  const found = await json('api', `repos/${repo}/actions/artifacts?name=${ARTIFACT}&per_page=1`, '--jq', '.artifacts[0] // null');
  return found && !found.expired && Number.isInteger(found.workflow_run?.id) ? {runId: found.workflow_run.id, sha: found.workflow_run.head_sha || ''} : null;
}

/** report.json of one run's artifact, parsed; throws when the artifact cannot be downloaded or read (the caller keeps the stored coverage). */
export async function readReport(repo, runId, download = downloadReport) {
  const dir = mkdtempSync(path.join(tmpdir(), 'coverage-intel-'));
  try { await download(repo, runId, dir); return JSON.parse(readFileSync(path.join(dir, 'report.json'), 'utf8')); } finally { rmSync(dir, {recursive: true, force: true}); }
}

/** The coverage part of the snapshot (before the site validates it): the report's own layers, folders and journeys plus the nights' per-layer totals kept for the trend. */
export function mergeCoverage(stored, report, {runId, sha}) {
  const totals = Object.fromEntries(COVERAGE_LAYERS.map(id => { const total = (report.layers || []).find(layer => layer.id === id)?.total; return [id, total?.state === 'measured' ? total.pct : null]; }));
  const history = [...(stored?.history || []).filter(row => row.day !== report.at), {day: report.at, pct: totals}].sort((a, b) => a.day.localeCompare(b.day)).slice(-KEEP_HISTORY);
  return {runId, sha: report.sha || sha, at: report.at, layers: report.layers, folders: report.folders, journeys: report.journeys, history};
}

/**
 * The coverage part for this hour's snapshot.
 * @param {object|null} stored the coverage the site already keeps (GET /integration/data), or null
 * @param {{repo: string, json?: Function, read?: Function}} options the public repo and, for tests, the gh and download seams
 * @returns {Promise<object|null>} the new coverage, or `stored` when no newer report could be read
 */
export async function coverageFor(stored, {repo, json = ghJson, read = readReport}) {
  try {
    const newest = await newestReport(repo, json);
    if (!newest || newest.runId === stored?.runId) return stored || null;
    const merged = mergeCoverage(stored, await read(repo, newest.runId), newest);
    // Why (PR #267, Gitar): a report that parses but has a shape the site rejects must not replace the stored part (the site would store null and the 30 nights of trend are gone).
    if (!cleanCoverage(merged)) throw new Error(`report of run ${newest.runId} has a shape the site does not accept`);
    return merged;
  } catch (error) {
    console.log(`::warning::the coverage report was not read this hour: ${String(error?.message || error).slice(0, 200)}`);
    return stored || null;
  }
}
