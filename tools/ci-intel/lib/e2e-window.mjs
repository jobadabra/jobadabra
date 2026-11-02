// The rows of a range of days out of the e2e snapshot: what the e2e page draws and the Monday summary (e2e-weekly.mjs) counts, from this one function so the two never disagree.
// Why (2 Nov 2026, owner: move the CI collectors to the public repo): windowOf lived in jobadabra-web's admin/e2e-page.js beside the page's drawing code, so tools/ci-intel/lib/e2e-weekly.mjs
// could not import it ("private reads public, never the reverse"); it moved here as it was, and the page imports it back from the public tree. Pure: no network, no clock but `now`.
import {CAUSE_IDS, causeId} from './e2e-causes.mjs';
import {weekOf} from './e2e-work.mjs';

const DAY = 86400000;
export const RANGES = {'7d': {name: 'Last 7 days', days: 7}, '30d': {name: 'Last 30 days', days: 30}};
/** A known range id ('7d' or '30d'), else '7d'. */
export const rangeOf = value => (RANGES[value] ? value : '7d');

// The rows of the range: days from `now` back, as the YYYY-MM-DD keys they are stored under.
// kind: one run kind or 'all'. allDays/allFails stay unfiltered by kind (the PR box and main's green share need every kind). Rows of rules 1-2 read under today's cause ids.
export function windowOf(snapshot, range, now = new Date(), kind = 'all') {
  const keys = new Set(Array.from({length: RANGES[rangeOf(range)].days}, (_, i) => new Date(now.getTime() - i * DAY).toISOString().slice(0, 10)));
  const ofKind = row => kind === 'all' || (row.kind || 'beta') === kind;
  const allDays = (snapshot?.days || []).filter(row => keys.has(row.day)), allFails = (snapshot?.fails || []).filter(row => keys.has(row.day)).map(row => ({...row, cause: causeId(row.cause)}));
  const days = allDays.filter(ofKind), fails = allFails.filter(ofKind);
  const weeks = new Set([...keys].map(weekOf)), escapes = (snapshot?.escapes || []).filter(row => weeks.has(row.week));
  const breaks = (snapshot?.breaks || []).filter(row => keys.has(row.day) && ofKind(row)).map(row => ({...row, cause: causeId(row.cause)})), caught = (snapshot?.caught || []).filter(row => keys.has(row.day));
  const sum = (rows, field) => rows.reduce((total, row) => total + (Number(row[field]) || 0), 0);
  const reds = sum(fails, 'n'), byCause = Object.fromEntries(CAUSE_IDS.map(id => [id, sum(fails.filter(row => row.cause === id), 'n')]));
  const betas = allDays.filter(row => (row.kind || 'beta') === 'beta'), beta = {runs: sum(betas, 'runs'), cancelled: sum(betas, 'cancelled'), greens: sum(betas, 'greens')};
  return {keys: [...keys], allDays, allFails, breaks, caught, beta, days, fails, escapes, runs: sum(days, 'runs'), cancelled: sum(days, 'cancelled'), redRuns: sum(days, 'reds'), greenRuns: sum(days, 'greens'), redMin: sum(days, 'redMin'), reds, byCause, failMin: sum(fails, 'min')};
}
