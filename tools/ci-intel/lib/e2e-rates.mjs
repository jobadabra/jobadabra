// The night report-only suites' measured rates, read from a suite job's log (counts only, never stored): the shape suiteNights[].rates already has (tools/ci-intel/lib/e2e-grey.mjs, every rate 0..1,
// higher is better, so "lowest of the night" is the worst). Added 1 Nov 2026 (owner, via mac-07: nightly report-only numbers on the Testing Overview and Scheduled): until then
// nothing wrote `rates`, so the Grey card and the Overview had only green/red for interactions. Pure: the collector (tools/ci-intel/jobs/e2e-intel.mjs) passes the log text. Guard: desktop/test/ci-intel-e2e-rates.test.js.

// Suites whose log carries rates; the value is the reader of that log.
export const RATE_SUITES = ['interactions'];

const ratio = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 1000 : null);

/**
 * The interactions suite's log -> {clean, still, recall} (each only when the log has its lines), or null when none of them is there.
 *  clean  = controls pressed that were not flagged, of all controls pressed (`<view>: N controls pressed, M flagged, …`)
 *  still  = pages that held still once loaded, of the pages watched (`<view>: N layout shift(s) after it was ready`; a `! [<view>]` line is a late shift that was filed)
 *  recall = planted bugs caught, of planted (`recall: X of Y planted bugs caught`)
 * Only the first try counts: a retry repeats the steps that went red, on the same commit, after the first try's lines (as nightOf in tools/ci-intel/lib/e2e-quality.mjs).
 */
export function interactionRates(text) {
  const log = String(text || ''), pressed = new Map(), watched = new Set(), late = new Set();
  let recall = null;
  for (const line of log.split('\n')) {
    let match = /\b([\w-]+): (\d+) controls pressed, (\d+) flagged\b/.exec(line);
    if (match && !pressed.has(match[1])) pressed.set(match[1], {pressed: Number(match[2]), flagged: Number(match[3])});
    if ((match = /\b([\w-]+): \d+ layout shift\(s\) after it was ready/.exec(line))) watched.add(match[1]);
    if ((match = /^\S*\s*! \[([\w-]+)\] /.exec(line))) late.add(match[1]);
    if (!recall && (match = /\brecall: (\d+) of (\d+) planted bugs caught/.exec(line))) recall = {caught: Number(match[1]), planted: Number(match[2])};
  }
  const total = [...pressed.values()].reduce((sum, view) => sum + view.pressed, 0), flagged = [...pressed.values()].reduce((sum, view) => sum + view.flagged, 0);
  const rates = {
    ...(total > 0 && flagged <= total ? {clean: ratio(total - flagged, total)} : {}),
    ...(watched.size ? {still: ratio(watched.size - [...late].filter(view => watched.has(view)).length, watched.size)} : {}),
    ...(recall && recall.planted > 0 && recall.caught <= recall.planted ? {recall: ratio(recall.caught, recall.planted)} : {})};
  return Object.keys(rates).length ? rates : null;
}

/** A suite's log -> its rates, or null (a suite without a reader, an unreadable log). */
export const ratesOf = (suite, text) => (suite === 'interactions' ? interactionRates(text) : null);
