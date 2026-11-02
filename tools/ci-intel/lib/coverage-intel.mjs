// The test-coverage numbers on /admin/testing/integrations (owner via a8, 1 Nov 2026: "A card on Integrations"). The public repo's nightly coverage report (tools/coverage-report.mjs, artifact
// `coverage-report`, report.json) is read by tools/ci-intel/jobs/coverage-intel.mjs as one more part of the integration snapshot (tools/ci-intel/jobs/integration-intel.mjs, hourly): no second route, table or secret.
// This file validates that part: unknown fields dropped, numbers clamped, texts cut. Report only: nothing here judges a number. Guard: jobadabra-web test/admin/coverage-card.test.js.
export const COVERAGE_LAYERS = ['unit-py', 'unit-js', 'integration', 'e2e'];
export const KEEP_HISTORY = 30;   // nights of per-layer totals kept for the trend
const STATES = ['measured', 'not measured', 'n/a'];
const isDay = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '');
const count = value => (Number.isInteger(value) && value >= 0 && value < 1e8 ? value : 0);
const percent = value => (Number.isFinite(Number(value)) ? Math.min(100, Math.max(0, Math.round(Number(value) * 10) / 10)) : 0);
const text = (value, max = 120) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max);

/** One layer total or folder cell: {state, pct, covered, total}; a state the report does not use becomes "not measured", never a number. */
export const cleanCell = cell => {
  const state = STATES.includes(cell?.state) ? cell.state : 'not measured';
  return state === 'measured' ? {state, pct: percent(cell.pct), covered: count(cell.covered), total: count(cell.total)} : {state};
};
const cleanJourney = item => (Number.isInteger(item?.n) && text(item.name)
  ? {n: item.n, name: text(item.name), priority: text(item.priority, 20), layers: (Array.isArray(item.layers) ? item.layers : []).slice(0, 6).map(layer => text(layer, 20)), tested: Boolean(item.tested)} : null);
const cleanHistory = row => (isDay(row?.day) ? {day: row.day, pct: Object.fromEntries(COVERAGE_LAYERS.map(id => [id, Number.isFinite(row.pct?.[id]) ? percent(row.pct[id]) : null]))} : null);

/**
 * Validate the coverage part of the collector body into what the snapshot stores; null when it is not one (the snapshot then has none and the page says so).
 * @param {object} data the collector's `coverage`: {runId, sha, at, layers, folders, journeys, history}
 * @returns {object|null} {runId, sha, at, layers: [{id, label, total: cell}], folders: [{folder, cells}], journeys: {total, withTest, byLayer, list}, history: [{day, pct}]};
 * cleaning its own output gives it back unchanged (the collector sends the stored part forward when no newer report exists)
 */
export function cleanCoverage(data) {
  if (!Array.isArray(data?.layers) || !isDay(data.at)) return null;
  const layers = COVERAGE_LAYERS.map(id => { const found = data.layers.find(layer => layer?.id === id); return found ? {id, label: text(found.label, 60) || id, total: cleanCell(found.total)} : null; }).filter(Boolean);
  if (!layers.length) return null;
  const list = (Array.isArray(data.journeys?.list) ? data.journeys.list : []).slice(0, 200).map(cleanJourney).filter(Boolean);
  const byLayer = Object.fromEntries(Object.entries(data.journeys?.byLayer || {}).slice(0, 8).map(([layer, n]) => [text(layer, 20), count(n)]));
  return {
    runId: Number.isInteger(data.runId) && data.runId > 0 ? data.runId : 0, sha: /^[a-f0-9]{7,40}$/i.test(data.sha || '') ? data.sha : '', at: data.at, layers,
    folders: (Array.isArray(data.folders) ? data.folders : []).slice(0, 30).filter(row => text(row?.folder)).map(row => ({folder: text(row.folder, 60), cells: Object.fromEntries(COVERAGE_LAYERS.map(id => [id, cleanCell(row.cells?.[id])]))})),
    journeys: {total: count(data.journeys?.total), withTest: count(data.journeys?.withTest), byLayer, list},
    history: (Array.isArray(data.history) ? data.history : []).slice(-KEEP_HISTORY).map(cleanHistory).filter(Boolean),
  };
}
