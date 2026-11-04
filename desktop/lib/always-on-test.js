// The app's side of Always on's Test button (owner, 4 Nov 2026: "a test button that will do a simple test of the e2e flow"): start the engine's `test` run in the person's
// own GitHub repository (the `test` job of the public workflow, src/connection_test.py) and read it back as one state per check. The checks search, write and send nothing.
// The steps' own results (running, passed, failed) come from the run's jobs, live; the words of a failed step come from selftest.json, an artifact the run uploads at its end.
// Never reads or stores a secret; the result file holds fixed sentences only. Guarded by test/unit/main/always-on-test.test.js.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as github from './github.js';

/** The checks, in order: `step` is the name of the workflow step that runs it (.github/workflows/daily.yml, job `test`), `id` the key in selftest.json. */
export const STEPS = [
  {id: 'github', step: 'Check · GitHub run', title: 'GitHub starts the run with your secrets'},
  {id: 'notion', step: 'Check · Notion', title: 'Notion answers with your token'},   // about Notion
  {id: 'ai', step: 'Check · AI key', title: 'Your AI key answers'},
];
const ARTIFACT = 'jobadabra-selftest';
const NO_WORDS = 'This step failed before it could say why. Open the run to read it.';

/** One state per check from the test job's steps: waiting, running, ok, failed or skipped, with the engine's sentence for a failed one. job may be missing (not started yet). */
export function stepStates(job, result) {
  return STEPS.map(({id, step, title}) => {
    const found = (job?.steps || []).find(item => item.name === step);
    let state = 'waiting';
    if (found?.status === 'in_progress') state = 'running';
    else if (found?.status === 'completed') state = found.conclusion === 'success' ? 'ok' : found.conclusion === 'skipped' ? 'skipped' : found.conclusion === 'cancelled' ? 'cancelled' : 'failed';
    const said = result?.steps?.[id];
    return {id, title, state, line: state === 'failed' ? (said && said.ok === false && said.line) || NO_WORDS : ''};
  });
}

/** The whole test: running while any check waits or runs, else passed (all ok), cancelled (a second press, or GitHub cancelled it) or failed. `job` is the run's test job, `run` the workflow run. */
export function verdictOf(states, job, run) {
  const finished = run?.status === 'completed' || job?.status === 'completed';
  if (!finished) return 'running';
  if (run?.conclusion === 'cancelled' || job?.conclusion === 'cancelled') return 'cancelled';
  return states.every(item => item.state === 'ok') ? 'passed' : 'failed';
}

/** Starts the test run in the person's repository. -> {ok, since} (since: when to look for the run), or {ok: false, error}. An older repo whose workflow does not list the `test` mode is brought up to date once, then asked again. */
export async function startTest(storage, {fetcher, siteFetcher, now = Date.now, dispatch, update = github.updateRepo} = {}) {
  const {repo} = storage.settings().cloud || {};
  if (!repo || !storage.secret('GITHUB_TOKEN')) return {ok: false, error: 'Always on is not connected to GitHub yet. Turn it on first.'};
  const send = dispatch || github.cloudDispatch(storage, () => {}, {fetcher});
  const since = now() - 15000;   // GitHub stamps the run with its own clock
  let result = await send({mode: 'test'}, 'daily.yml', 'always-on test button');
  if (!result.ok && /allowed values|input .*mode|422/i.test(result.error || '')) {
    await update(storage, {fetcher, siteFetcher});
    result = await send({mode: 'test'}, 'daily.yml', 'always-on test button');
  }
  return result.ok ? {ok: true, since, repo} : {ok: false, error: result.error || 'GitHub did not start the test.'};
}

// selftest.json from the run's artifact, or null (the run ended before it could write one, or the artifact is not there yet).
async function resultOf(storage, runId, {fetcher = globalThis.fetch, unzip} = {}) {
  const {repo} = storage.settings().cloud || {};
  const token = storage.secret('GITHUB_TOKEN');
  const api = github.client(token, fetcher);
  const {artifacts} = await api('GET', `/repos/${repo}/actions/runs/${runId}/artifacts`);
  const found = (artifacts || []).find(item => item.name === ARTIFACT && !item.expired);
  if (!found) return null;
  const response = await fetcher(found.archive_download_url, {headers: {Authorization: `Bearer ${token}`}});
  if (!response.ok) return null;
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'jobadabra-selftest-'));
  try {
    const zip = path.join(folder, 'result.zip');
    fs.writeFileSync(zip, Buffer.from(await response.arrayBuffer()));
    await (unzip || github.unzipFile)(zip, folder);
    return JSON.parse(fs.readFileSync(path.join(folder, 'selftest.json'), 'utf8'));
  } catch { return null; } finally { fs.rmSync(folder, {recursive: true, force: true}); }
}

/** Reads the test started at `since`: {found, verdict, steps, url}. found is false until GitHub lists the run. Asks for the result file only once the run has ended. */
export async function readTest(storage, {since = 0, fetcher, unzip} = {}) {
  const runs = await github.dispatchedRuns(storage, {workflow: 'daily.yml', since, fetcher});
  const run = runs.filter(item => !item.title || item.title === 'test').pop();   // the newest test run (a run's title is its mode); another dispatch in the same minute is not ours
  if (!run) return {found: false, verdict: 'running', steps: stepStates(null, null), url: ''};
  const jobs = await github.runJobs(storage, run.id, {fetcher});
  const job = jobs.find(item => /(^|\/ )test$/.test(item.name || '')) || null;
  const ended = run.status === 'completed';
  const result = ended ? await resultOf(storage, run.id, {fetcher, unzip}).catch(() => null) : null;
  const steps = stepStates(job, result);
  return {found: true, verdict: verdictOf(steps, job, run), steps, url: job?.html_url || run.html_url || ''};
}
