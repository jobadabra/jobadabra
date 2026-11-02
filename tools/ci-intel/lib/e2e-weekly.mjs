// The weekly e2e summary (owner, 28 Oct 2026; public repo docs/superpowers/specs/2026-10-28-e2e-reliability-design.md rule D: "Weekly: Telegram + one GitHub issue,
// same numbers as the page, one decision for the owner if any"; rules I and J). Drawn from the snapshot /admin/testing/e2e draws (jobadabra-web admin/e2e-intel.js) with the page's
// own functions, so there is no second count. Pure: tools/ci-intel/jobs/e2e-weekly.mjs posts it. Guard: desktop/test/ci-intel-e2e-weekly.test.js.
import {CAUSES, GROUPS} from './e2e-causes.mjs';
import {greySummary, greyLines} from './e2e-grey.mjs';
import {speedLines, speedSummary} from './e2e-speed.mjs';
import {windowOf} from './e2e-window.mjs';
import {scoreRows, workWeeks} from './e2e-scorecard.mjs';
import {summary as topSummary} from './e2e-top.mjs';
import {PLUMBING_TARGET, WORK_KINDS, weekOf} from './e2e-work.mjs';

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

/** One owner decision, or null: prune and Grey expiry/band warnings; Telegram may limit the named suites, while the issue keeps them all. */
export function decision(s, limit = Infinity) {
  const grey = (s.grey?.rows || []).filter(row => row.expired || row.below);
  const parts = [];
  if (s.prune.length) parts.push(`${s.prune.length} suite${s.prune.length === 1 ? '' : 's'} red in 30 days without catching a bug: ${list(s.prune, row => `${row.suite} (${row.reds} red, ${hours(row.min)})`, limit)}.${grey.length ? '' : ' Keep, move to a tolerant lane, or retire?'}`);
  if (grey.length) parts.push(`Grey: ${list(grey, row => `${row.suite} (${[row.expired ? `${row.age} days grey` : '', row.below ? "below main's band 3 nights in a row" : ''].filter(Boolean).join('; ')})`, limit)}: keep, fix or retire?`);
  return parts.join(' ') || null;
}

/** The weekly issue's title; one per week, so a re-run the same day rewrites the issue instead of adding one. `s` = weekly()'s summary. */
export const issueTitle = s => `E2E week · ${s.day}`;

const plumbingLine = s => (s.work.total
  ? `Plumbing ${pct(s.work.counts.plumbing || 0, s.work.total)} of ${s.work.total} commits in the week of ${dayWords(s.work.week)} (${(s.work.plumbing < PLUMBING_TARGET ? 'under' : 'over')} the ${pct(PLUMBING_TARGET, 1)} target)`
  : `No commit read for the week of ${dayWords(s.work.week)}`);

/** One Telegram message under 4096 characters: compact Grey rows, bounded suite lists, the decision and links always retained. */
export function telegramText(s, issueUrl = '') {
  const groups = GROUPS.filter(group => s.byGroup[group.id]).map(group => `${group.label} ${s.byGroup[group.id]}`).join(' · ');
  const grey = s.grey;
  const render = limit => [`🧪 E2E week to ${dayWords(s.day)}: ${s.redRuns} of ${s.runs} runs red (${pct(s.redRuns, s.runs)})`,
    s.reds ? `${s.reds} red suites: ${groups}` : 'No red suite this week',
    s.caught.length ? `Caught a bug: ${list(s.caught, row => row.suite, limit)}` : 'No red suite caught a bug',
    ...(s.idle.length ? [`Red, caught nothing: ${list(s.idle, row => `${row.suite} (${row.noise + row.ours + row.unnamed})`, limit)}`] : []),
    ...speedLines(s.speed, Math.max(1, limit)), plumbingLine(s), 'Grey', ...(!grey.read ? ['lane registry not read yet'] : !grey.rows.length ? ['No tolerant or suspended suites.'] : [
      ...grey.rows.slice(0, limit).map(row => `${row.suite} (${row.lane}, ${row.ageText}, ${row.nights.filter(night => night.green === false).length}/${row.nights.length} red)`),
      ...(grey.rows.length > limit ? [`…and ${grey.rows.length - limit} more`] : [])]),
    decision(s, limit) ? `Your call: ${decision(s, limit)}` : 'No decision for you this week.', `${PAGE}${issueUrl ? `\n${issueUrl}` : ''}`].join('\n');
  // Shrink every suite list together: a large scorecard or decision must not crowd out the decision line and links.
  let limit = Math.max(s.caught.length, s.idle.length, s.prune.length, grey.rows.length, s.speed?.slowPr.length || 0), text = render(limit);
  while (text.length >= 4096 && limit > 0) text = render(--limit);
  return text;
}

/** The GitHub issue body: the verdict, the same numbers as tables, the decision, and where each number comes from. */
export function issueBody(s) {
  const label = id => CAUSES.find(cause => cause.id === id)?.label || id;
  const score = s.caught.concat(s.idle).map(row => `| \`${row.suite}\` | ${row.caught} | ${row.noise} | ${row.ours} | ${row.unnamed} | ${hours(row.min)} |`).join('\n');
  return [`**${s.redRuns} of ${s.runs} e2e runs red (${pct(s.redRuns, s.runs)})** in the 7 days to ${dayWords(s.day)}; ${s.caught.reduce((n, row) => n + row.caught, 0)} of ${s.reds} red suites caught a product bug. ${plumbingLine(s)}.`,
    '', `> **Decision:** ${decision(s) || 'none this week.'}`, '',
    '| Red suites by group | |', '|---|---|', ...GROUPS.map(group => `| ${group.label} | ${s.byGroup[group.id] || 0} |`),
    ...(s.causes.length ? ['', `Top causes: ${s.causes.map(row => `${label(row.id)} ${row.n}`).join(', ')}.`] : []),
    '', '**Scorecard** (last 7 days; a catch = the fix changed the app, the extension or the engine)', '',
    ...(score ? ['| Suite | Caught a bug | Test noise | Our CI and AI | Not named | Job time |', '|---|---|---|---|---|---|', score] : ['No red suite.']),
    '', ...greyLines(s.grey), '', ...speedLines(s.speed),
    '', `**Where e2e work went** (week of ${dayWords(s.work.week)}; target: plumbing under ${pct(PLUMBING_TARGET, 1)})`, '',
    '| Kind | Commits |', '|---|---|', ...WORK_KINDS.map(kind => `| ${kind.label} | ${s.work.counts[kind.id] || 0} |`),
    ...(s.files.length ? ['', `Changed most: ${s.files.map(row => `\`${row.file}\` ${row.commits}`).join(', ')}.`] : []),
    '', `<sub>Same numbers as ${PAGE} (one classifier: tools/ci-intel/lib/e2e-causes.mjs). Written by tools/ci-intel/jobs/e2e-weekly.mjs on Mondays.</sub>`].join('\n');
}
