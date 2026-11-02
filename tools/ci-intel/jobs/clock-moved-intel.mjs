// Reads the public repo's nightly clock-moved reports for the integration snapshot (tools/ci-intel/jobs/integration-intel.mjs puts the result in the same PUT as everything else on /admin/testing/integrations:
// no second route, table, secret or schedule; same pull pattern as tools/ci-intel/jobs/coverage-intel.mjs). The public workflow clock-moved.yml (night pass 1 of e2e.yml, or by hand) uploads one artifact
// per area, `clock-moved-desktop`, `clock-moved-e2e`, `clock-moved-python`, each holding report.json ({judged, redToday, bombs: [{area, file, days, why}], unstable, seconds}).
// The newest run that has any of them is read once (its run id is kept); none, expired or unreadable keeps what the snapshot already stores. An area whose artifact that run lacks (its job
// failed) is "not measured", never 0. Pure parts are exported for jobadabra-web test/admin/clock-moved-card.test.js. Report only: nothing here judges a number.
import {execFile} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import {CLOCK_AREAS, cleanClockMoved, KEEP_HISTORY} from '../lib/clock-moved-intel.mjs';

const execAsync = promisify(execFile);
const artifactOf = area => `clock-moved-${area}`;

const ghJson = async (...args) => JSON.parse((await execAsync('gh', args, {maxBuffer: 1 << 26, timeout: 60000})).stdout || 'null');
const downloadReports = async (repo, runId, dir) => execAsync('gh', ['run', 'download', String(runId), '--repo', repo, '--pattern', 'clock-moved-*', '--dir', dir], {timeout: 120000});

/** The newest run of the public repo with an unexpired clock-moved artifact: {runId, sha, day}, or null. `day` = the artifact's creation day (report.json carries no date). */
export async function newestRun(repo, json = ghJson) {
  const found = await Promise.all(CLOCK_AREAS.map(area => json('api', `repos/${repo}/actions/artifacts?name=${artifactOf(area)}&per_page=1`, '--jq', '.artifacts[0] // null')));
  const live = found.filter(item => item && !item.expired && Number.isInteger(item.workflow_run?.id));
  const newest = live.sort((a, b) => b.workflow_run.id - a.workflow_run.id)[0];
  return newest ? {runId: newest.workflow_run.id, sha: newest.workflow_run.head_sha || '', day: String(newest.created_at || '').slice(0, 10)} : null;
}

/** True when the public repo's run has completed (every area job uploaded or failed), so the three artifacts it will have are all listed. */
export async function runFinished(repo, runId, json = ghJson) {
  return (await json('api', `repos/${repo}/actions/runs/${runId}`, '--jq', '{status: .status}'))?.status === 'completed';
}

/** The three report.json of one run, {area: parsed | null}; throws when the download itself fails (the caller keeps the stored part). A missing area folder is null. */
export async function readReports(repo, runId, download = downloadReports) {
  const dir = mkdtempSync(path.join(tmpdir(), 'clock-moved-intel-'));
  try {
    await download(repo, runId, dir);
    return Object.fromEntries(CLOCK_AREAS.map(area => { try { return [area, JSON.parse(readFileSync(path.join(dir, artifactOf(area), 'report.json'), 'utf8'))]; } catch { return [area, null]; } }));
  } finally { rmSync(dir, {recursive: true, force: true}); }
}

/** The clock-moved part of the snapshot (before the site validates it): the night's reports plus the nights' totals kept for the trend. */
export function mergeClockMoved(stored, reports, {runId, sha, day}) {
  const now = cleanClockMoved({runId, sha, at: day, areas: reports});
  if (!now) return null;
  const history = [...(stored?.history || []).filter(row => row.day !== day), {day, bombs: now.bombs, redToday: now.redToday}].sort((a, b) => a.day.localeCompare(b.day)).slice(-KEEP_HISTORY);
  return {...now, history};
}

/**
 * The clock-moved part for this hour's snapshot.
 * @param {object|null} stored the clock-moved part the site already keeps (GET /integration/data), or null
 * @param {{repo: string, json?: Function, read?: Function}} options the public repo and, for tests, the gh and download seams
 * @returns {Promise<object|null>} the new part, or `stored` when no newer run could be read
 */
export async function clockMovedFor(stored, {repo, json = ghJson, read = readReports}) {
  try {
    const newest = await newestRun(repo, json);
    if (!newest || newest.runId === stored?.runId) return stored || null;
    // Why (Gitar on #269): an artifact is listed as soon as its job uploads it; a run read before its three jobs are done would be stored with the late areas "not measured" and never read again.
    if (!await runFinished(repo, newest.runId, json)) return stored || null;
    const merged = mergeClockMoved(stored, await read(repo, newest.runId), newest);
    // Same guard as the coverage part (PR #267, Gitar): a run the site would reject must not replace the stored part and its trend.
    if (!merged || !cleanClockMoved(merged)) throw new Error(`the clock-moved reports of run ${newest.runId} have a shape the site does not accept`);
    return merged;
  } catch (error) {
    console.log(`::warning::the clock-moved reports were not read this hour: ${String(error?.message || error).slice(0, 200)}`);
    return stored || null;
  }
}
