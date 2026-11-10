// The weekly e2e summary (owner, 28 Oct 2026; public repo docs/superpowers/specs/2026-10-28-e2e-reliability-design.md rule D, amended 5 Nov 2026: Telegram only,
// same numbers as the page, one decision for the owner if any; rules I and J). Drawn from the snapshot /admin/testing/e2e draws (jobadabra-web admin/e2e-intel.js) with the page's
// own functions, so there is no second count. Pure: tools/ci-intel/jobs/e2e-weekly.mjs posts it.
// Why (5 Nov 2026, owner: "turn this pinned issues into dashboards/tabs/pages in Admin … and will remove them from GH issue list"): the weekly GitHub issue is gone; its tables are the Admin page PAGE.
import {GROUPS} from './e2e-causes.mjs';
import {greySummary} from './e2e-grey.mjs';
import {PR_SPLIT_SECONDS, speedSummary} from './e2e-speed.mjs';
import {windowOf} from './e2e-window.mjs';
import {scoreRows, workWeeks} from './e2e-scorecard.mjs';
import {summary as topSummary} from './e2e-top.mjs';
import {PLUMBING_TARGET, weekOf} from './e2e-work.mjs';
import {card, plural} from '../../../desktop/e2e/lib/tg-card.mjs';

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

const GROUP_ICON = {ours: '🤖', tests: '🧪', app: '📱', none: '❔'};
// "qualityai, calendar, recorded +13": the first three names and how many more, never the whole list (the page keeps it).
const names = (rows, pick = row => row.suite, shown = 3) => `${rows.slice(0, shown).map(pick).join(', ')}${rows.length > shown ? ` +${rows.length - shown}` : ''}`;

/**
 * The week as one owner card (tools/lib tg-card shape, owner 10 Nov 2026: "let's make this telegram message have a better readability… ASCII. Colors"): headline with the number, a green/red bar,
 * the red suites by cause (icon + count), up to three one-line facts, ONE decision line, ONE link. The full lists (slowest, grey, every suite) stay on the page it links.
 * Why (10 Nov 2026): the 17-line wall of comma lists is gone; the same numbers are on the page, never counted twice.
 */
export function telegramText(s) {
  const why = GROUPS.filter(group => s.byGroup[group.id]).map(group => ({icon: GROUP_ICON[group.id], count: s.byGroup[group.id], text: group.label}));
  const grey = s.grey?.rows || [], slow = s.speed?.slowPr || [], limit = PR_SPLIT_SECONDS / 60;
  // Why (Gitar on #3644): the decision and the plumbing sentence have one source each (decision(), plumbingLine()), and the PR-speed fact says "not read" when the snapshot has no PR timings, never a false all-clear.
  const speed = !s.speed?.prRead ? 'PR speed not read' : slow.length ? `${plural(slow.length, 'PR suite')} over ${limit} min` : `no PR suite over ${limit} min`;
  const facts = [s.caught.length ? `🐛 Caught a bug: ${names(s.caught)}` : '🐛 No red suite caught a bug', `🧱 ${plumbingLine(s)}`,
    `⚪ ${s.grey?.read === false ? 'Lane registry not read yet' : grey.length ? plural(grey.length, 'grey suite') : 'No grey suite'} · ${speed}`];
  const call = decision(s, 2) || '';
  const level = !s.runs ? 'grey' : call || s.redRuns / s.runs > 0.1 ? 'orange' : 'green';
  return card({level, headline: `E2E week to ${dayWords(s.day)}: ${s.redRuns} of ${s.runs} runs red (${pct(s.redRuns, s.runs)})`,
    bar: {done: s.runs - s.redRuns, total: s.runs, doneWord: 'green', restWord: 'red'}, why, whyTitle: s.reds ? `${s.reds} red suites` : 'No red suite this week', facts,
    verdict: call ? {ok: false, text: `Your call: ${call}`} : {ok: true, text: 'No decision for you this week.'}, link: {text: 'Open the page', url: PAGE}});
}
