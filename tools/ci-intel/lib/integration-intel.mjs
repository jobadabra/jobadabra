// The integration tests' snapshot (owner, 1 Nov 2026: "I'd like to keep the separate" from the e2e page): CI (integration-intel.yml, hourly) reads the
// integration-results-<layer> artifacts of "CI · Integration tests" from GitHub (tools/ci-intel/jobs/integration-intel.mjs), builds ONE snapshot with tools/ci-intel/jobs/integration-intel-rows.mjs and
// sends it (PUT /integration/data, Bearer SELFHEAL_PUBLISH_KEY). The site validates it and keeps ONE row (integration_snapshot); the page (jobadabra-web admin/integration-page.js) reads that
// row only. A test's name and file are test words, never a log or personal data. Guard: desktop/test/ci-intel-integration-intel-collector.test.js.
import {cleanClockMoved} from './clock-moved-intel.mjs';
import {cleanCoverage} from './coverage-intel.mjs';

export const LAYERS = ['extension', 'app', 'store'];
export const KEEP_DAYS = 30;
export const MAX_RUNS = 3000;   // the newest rows are kept: a longer list is cut here, never refused (Gitar, #245: a refused PUT froze the page for good)
const isDay = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '');
const count = value => Number.isInteger(value) && value >= 0 && value < 1e6;
const ms = value => (Number.isFinite(Number(value)) ? Math.max(0, Math.round(Number(value))) : 0);
const text = (value, max = 200) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max);
const sha = value => (/^[a-f0-9]{7,40}$/i.test(value || '') ? value : '');
const layerOf = value => (LAYERS.includes(value) ? value : null);

const cleanRun = run => Number.isInteger(run?.runId) && run.runId > 0 && layerOf(run.layer) && isDay(run.day) && ['success', 'failure'].includes(run.conclusion) && ['main', 'pr'].includes(run.on) && count(run.tests) && count(run.failed)
  ? {runId: run.runId, layer: run.layer, platform: text(run.platform, 20) || 'linux', day: run.day, on: run.on, sha: sha(run.sha), conclusion: run.conclusion, tests: run.tests, failed: run.failed, ms: ms(run.ms)} : null;
const cleanRef = ref => (Number.isInteger(ref?.runId) && ref.runId > 0 ? {runId: ref.runId, sha: sha(ref.sha)} : null);
const cleanFlaky = row => {
  const red = cleanRef(row?.red), green = cleanRef(row?.green);
  return layerOf(row?.layer) && text(row.test) && red && green && ['same-commit', 'unchanged-files'].includes(row.kind) && isDay(row.day)
    ? {layer: row.layer, test: text(row.test), file: text(row.file, 160), kind: row.kind, day: row.day, red, green} : null;
};
const cleanOpen = row => (layerOf(row?.layer) && text(row.test) && Number.isInteger(row.runId) && isDay(row.day) ? {layer: row.layer, platform: text(row.platform, 20) || 'linux', test: text(row.test), file: text(row.file, 160), day: row.day, runId: row.runId, sha: sha(row.sha), on: row.on === 'main' ? 'main' : 'pr'} : null);
const cleanSlow = row => (layerOf(row?.layer) && text(row.test) ? {layer: row.layer, test: text(row.test), file: text(row.file, 160), ms: ms(row.ms), runs: count(row.runs) ? row.runs : 1} : null);
const cleanDay = row => (isDay(row?.day) && count(row.e2eSteps) && count(row.e2eSuites) && LAYERS.every(layer => count(row.integration?.[layer])) ? {day: row.day, e2eSteps: row.e2eSteps, e2eSuites: row.e2eSuites, integration: Object.fromEntries(LAYERS.map(layer => [layer, row.integration[layer]]))} : null);

/** Validate a collector body into the stored snapshot; null when it is not one. Unknown fields are dropped, every text is cut, the lists keep their newest rows. `read` = every run id the collector has read, even one with no result file. */
export function cleanSnapshot(data, now = new Date()) {
  if (!Array.isArray(data?.runs)) return null;
  const from = new Date(now.getTime() - KEEP_DAYS * 86400000).toISOString().slice(0, 10);
  const list = (rows, clean, max) => (Array.isArray(rows) ? rows.slice(0, max).map(clean).filter(Boolean) : []);
  const counts = Object.fromEntries(LAYERS.map(layer => [layer, {tests: count(data.counts?.[layer]?.tests) ? data.counts[layer].tests : 0, files: count(data.counts?.[layer]?.files) ? data.counts[layer].files : 0}]));
  const move = list(data.move?.days, cleanDay, 60).filter(row => row.day >= from);
  return {schema: 1, at: now.toISOString(), runs: list(data.runs.slice(-MAX_RUNS), cleanRun, MAX_RUNS).filter(run => run.day >= from), read: (Array.isArray(data.read) ? data.read.slice(-MAX_RUNS) : []).filter(id => Number.isInteger(id) && id > 0), counts, flaky: list(data.flaky, cleanFlaky, 100), open: list(data.open, cleanOpen, 300), slowest: list(data.slowest, cleanSlow, 50),
    move: {days: move, e2eSteps: count(data.move?.e2eSteps) ? data.move.e2eSteps : null, lanes: count(data.move?.lanes) ? data.move.lanes : null},
    coverage: cleanCoverage(data.coverage),   // the nightly coverage report (tools/ci-intel/jobs/coverage-intel.mjs); null until one was read
    clockMoved: cleanClockMoved(data.clockMoved)};   // the nightly clock-moved reports (tools/ci-intel/jobs/clock-moved-intel.mjs); null until one was read
}
