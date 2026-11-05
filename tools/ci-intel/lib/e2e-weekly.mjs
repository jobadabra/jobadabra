// The weekly e2e summary (owner, 28 Oct 2026; public repo docs/superpowers/specs/2026-10-28-e2e-reliability-design.md rule D: "Weekly: Telegram, same numbers as the page,
// one decision for the owner if any"; rules I and J). Drawn from the snapshot /admin/testing/e2e draws (jobadabra-web admin/e2e-intel.js) with the page's
// own functions, so there is no second count. Pure: tools/ci-intel/jobs/e2e-weekly.mjs posts it.
// Why (5 Nov 2026, owner: "turn this pinned issues into dashboards/tabs/pages in Admin … and will remove them from GH issue list"): the weekly GitHub issue is gone; its tables are the Admin page PAGE.
import {GROUPS} from './e2e-causes.mjs';
import {greySummary} from './e2e-grey.mjs';
import {speedLines, speedSummary} from './e2e-speed.mjs';
import {windowOf} from './e2e-window.mjs';
import {scoreRows, workWeeks} from './e2e-scorecard.mjs';
import {summary as topSummary} from './e2e-top.mjs';
import {PLUMBING_TARGET, weekOf} from './e2e-work.mjs';

export const PAGE = 'https://www.jobadabra.top/admin/testing/e2e';
const DAY = 86400000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayWords = day => `${Number(day.slice(8))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;
const pct = (part, whole) => (whole ? `${Math.round((part / whole) * 100)}%` : '–');
const hours = minutes => `${((Number(minutes) || 0) / 60).toLocaleString('en-US', {maximumFractionDigits: 1})} h`;
const list = (rows, render, limit) => [...rows.slice(0, limit).map(render), ...(rows.length > limit ? [`…and ${rows.length - limit} more`] : [])].join(', ');

/**
 * Snapshot -> the week's numbers: the page's last-7-days window (runs, reds by group, top causes, the scorecard), the suites with no catch in the
 * snapshot's 30 days (prune candidates: the owner decides, never a session), and the last full calendar week of commits (plumbing share vs 15%, top files).
 */
export function weekly(snapshot, now = new Date()) {
  const w = windowOf(snapshot, '7d', now), month = windowOf(snapshot, '30d', now), top = topSummary(w), suites = scoreRows(w.fails);
  const prune = scoreRows(month.fails).filter(row => !row.caught).map(row => ({suite: row.suite, reds: row.noise + row.ours + row.unnamed, min: row.min}));
  const lastWeek = weekOf(new Date(now.getTime() - 7 * DAY).toISOString().slice(0, 10));
  const work = workWeeks(snapshot?.work).find(row => row.week === lastWeek) || {week: lastWeek, counts: {}, total: 0, plumbing: 0};
  return {day: now.toISOString().slice(0, 10), runs: w.runs, redRuns: w.redRuns, reds: w.reds, byGroup: top.byGroup, causes: top.causes.filter(row => row.n).slice(0, 3),
    caught: suites.filter(row => row.caught), idle: suites.filter(row => !row.caught), prune, grey: greySummary(snapshot, now), speed: speedSummary(snapshot, now), work, files: (snapshot?.workFiles || []).filter(row => row.week === lastWeek).slice(0, 5)};
}

/** One owner decision, or null: prune and Grey expiry/band warnings; Telegram may limit the named suites, the Admin page keeps them all. */
export function decision(s, limit = Infinity) {
  const grey = (s.grey?.rows || []).filter(row => row.expired || row.below);
  const parts = [];
  if (s.prune.length) parts.push(`${s.prune.length} suite${s.prune.length === 1 ? '' : 's'} red in 30 days without catching a bug: ${list(s.prune, row => `${row.suite} (${row.reds} red, ${hours(row.min)})`, limit)}.${grey.length ? '' : ' Keep, move to a tolerant lane, or retire?'}`);
  if (grey.length) parts.push(`Grey: ${list(grey, row => `${row.suite} (${[row.expired ? `${row.age} days grey` : '', row.below ? "below main's band 3 nights in a row" : ''].filter(Boolean).join('; ')})`, limit)}: keep, fix or retire?`);
  return parts.join(' ') || null;
}

const plumbingLine = s => (s.work.total
  ? `Plumbing ${pct(s.work.counts.plumbing || 0, s.work.total)} of ${s.work.total} commits in the week of ${dayWords(s.work.week)} (${(s.work.plumbing < PLUMBING_TARGET ? 'under' : 'over')} the ${pct(PLUMBING_TARGET, 1)} target)`
  : `No commit read for the week of ${dayWords(s.work.week)}`);

/** One Telegram message under 4096 characters: compact Grey rows, bounded suite lists, the decision and the page link always retained. */
export function telegramText(s) {
  const groups = GROUPS.filter(group => s.byGroup[group.id]).map(group => `${group.label} ${s.byGroup[group.id]}`).join(' · ');
  const grey = s.grey;
  const render = limit => [`🧪 E2E week to ${dayWords(s.day)}: ${s.redRuns} of ${s.runs} runs red (${pct(s.redRuns, s.runs)})`,
    s.reds ? `${s.reds} red suites: ${groups}` : 'No red suite this week',
    s.caught.length ? `Caught a bug: ${list(s.caught, row => row.suite, limit)}` : 'No red suite caught a bug',
    ...(s.idle.length ? [`Red, caught nothing: ${list(s.idle, row => `${row.suite} (${row.noise + row.ours + row.unnamed})`, limit)}`] : []),
    ...speedLines(s.speed, Math.max(1, limit)), plumbingLine(s), 'Grey', ...(!grey.read ? ['lane registry not read yet'] : !grey.rows.length ? ['No tolerant or suspended suites.'] : [
      ...grey.rows.slice(0, limit).map(row => `${row.suite} (${row.lane}, ${row.ageText}, ${row.nights.filter(night => night.green === false).length}/${row.nights.length} red)`),
      ...(grey.rows.length > limit ? [`…and ${grey.rows.length - limit} more`] : [])]),
    decision(s, limit) ? `Your call: ${decision(s, limit)}` : 'No decision for you this week.', PAGE].join('\n');
  // Shrink every suite list together: a large scorecard or decision must not crowd out the decision line and links.
  let limit = Math.max(s.caught.length, s.idle.length, s.prune.length, grey.rows.length, s.speed?.slowPr.length || 0), text = render(limit);
  while (text.length >= 4096 && limit > 0) text = render(--limit);
  return text;
}

