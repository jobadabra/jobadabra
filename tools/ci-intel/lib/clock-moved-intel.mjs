// The clock-moved numbers on /admin/testing/integrations (a8, 2 Nov 2026, from mac-07's "Testing Overview" ask): how many tests break when the clock moves ("time bombs") and how many files were
// already red on the real clock. The public repo's workflow clock-moved.yml (night pass 1) uploads one artifact `clock-moved-<area>` per area (desktop, e2e, python), each holding report.json;
// tools/ci-intel/jobs/clock-moved-intel.mjs reads the newest run's three as one more part of the integration snapshot (hourly), no second route, table or secret.
// This file validates that part: unknown fields dropped, numbers clamped, texts cut. Report only: nothing here judges a number. Guard: jobadabra-web test/admin/clock-moved-card.test.js.
export const CLOCK_AREAS = ['desktop', 'e2e', 'python'];
export const KEEP_HISTORY = 30;   // nights of totals kept for the trend
const isDay = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '');
const count = value => (Number.isInteger(value) && value >= 0 && value < 1e6 ? value : 0);
const text = (value, max = 160) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max);

const cleanBomb = (area, row) => (text(row?.file) ? {area, file: text(row.file), days: count(row.days), why: text(row.why)} : null);
/** One area's report.json: {judged, redToday, bombs: [{file, days, why}], unstable: []} -> counts and the bomb rows; null when the area has no report that night ("not measured", never 0). */
export function cleanArea(area, report) {
  if (!report || typeof report !== 'object' || !Array.isArray(report.bombs)) return null;
  // Why (Gitar on #269): the count is of the whole list, cut only for the rows shown; a stored part (already cut) carries its own bombCount forward.
  const valid = report.bombs.map(row => cleanBomb(area, row)).filter(Boolean), bombs = valid.slice(0, 50);
  return {judged: count(report.judged), redToday: count(report.redToday), bombs, bombCount: Math.max(valid.length, count(report.bombCount)), unstable: Array.isArray(report.unstable) ? report.unstable.length : count(report.unstable)};
}

/**
 * Validate the clock-moved part of the collector body into what the snapshot stores; null when it is not one (the page then says none was read).
 * @param {object} data the collector's `clockMoved`: {runId, sha, at, areas: {desktop, e2e, python}, history}
 * @returns {object|null} {runId, sha, at, areas, bombs, redToday, history: [{day, bombs, redToday}]}; bombs and redToday are the sums over the measured areas;
 * cleaning its own output gives it back unchanged (the collector sends the stored part forward when no newer run exists)
 */
export function cleanClockMoved(data) {
  if (!isDay(data?.at) || !data.areas || typeof data.areas !== 'object') return null;
  const areas = Object.fromEntries(CLOCK_AREAS.map(area => [area, cleanArea(area, data.areas[area])]));
  const measured = Object.values(areas).filter(Boolean);
  if (!measured.length) return null;
  const history = (Array.isArray(data.history) ? data.history : []).slice(-KEEP_HISTORY).filter(row => isDay(row?.day)).map(row => ({day: row.day, bombs: count(row.bombs), redToday: count(row.redToday)}));
  return {
    runId: Number.isInteger(data.runId) && data.runId > 0 ? data.runId : 0, sha: /^[a-f0-9]{7,40}$/i.test(data.sha || '') ? data.sha : '', at: data.at, areas,
    bombs: measured.reduce((sum, area) => sum + area.bombCount, 0), redToday: measured.reduce((sum, area) => sum + area.redToday, 0), history,
  };
}
