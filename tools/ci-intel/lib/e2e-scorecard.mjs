// Two cards of /admin/testing/e2e (owner, 28 Oct 2026; spec docs/superpowers/specs/2026-10-28-e2e-reliability-design.md rules I and J in the public repo):
// the scorecard (which suites caught a bug and which only cost time) and where e2e work goes (commits per week by kind, against the owner's 15% plumbing target).
// Pure: draws the snapshot rows jobadabra-web admin/e2e-intel.js keeps. Guard: desktop/test/ci-intel-e2e-scorecard.test.js.
import {esc} from './html.mjs';
import {PUBLIC_REPO} from '../../../desktop/e2e/lib/repos.mjs';
import {CHIP_STYLE, chip} from './chip.mjs';
import {groupOf} from './e2e-causes.mjs';
import {barRows, legend} from './day-bars.mjs';
import {PLUMBING_TARGET, WORK_KINDS, weekOf} from './e2e-work.mjs';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayWords = day => `${Number(day.slice(8))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;
const hours = minutes => `${((Number(minutes) || 0) / 60).toLocaleString('en-US', {maximumFractionDigits: 1})} h`;
// A suite split across jobs ("applyflows-2of2") is one suite here: the scorecard judges a suite, not a shard.
// The page puts this in its <style> (test/shared/admin-chips.test.js: a chip page brings CHIP_STYLE).
export const SCORECARD_CSS = `${CHIP_STYLE}` + 'h3{margin:18px 0 6px;font-size:15px}';
/** A suite without its shard suffix: 'applyflows-1of2' counts as 'applyflows'. */
export const baseSuite = suite => String(suite || '').replace(/-\d+of\d+$/, '');

/** Window reds and escapes -> one row per suite, including missed suites with no red. Each escaped commit counts once per base suite. */
export function scoreRows(fails, escapes = []) {
  const rows = new Map();
  const rowOf = suite => rows.get(suite) || {suite, caught: 0, missed: 0, noise: 0, ours: 0, unnamed: 0, min: 0};
  for (const fail of fails) {
    const suite = baseSuite(fail.suite), row = rowOf(suite);
    const group = groupOf(fail.cause), n = Number(fail.n) || 0;
    if (group === 'app') row.caught += n; else if (group === 'tests') row.noise += n; else if (group === 'ours') row.ours += n; else row.unnamed += n;
    row.min += Number(fail.min) || 0; rows.set(suite, row);
  }
  for (const escape of escapes) for (const suite of new Set(escape.suites.map(baseSuite))) {
    const row = rowOf(suite); row.missed += 1; rows.set(suite, row);
  }
  return [...rows.values()].sort((a, b) => b.caught - a.caught || (b.noise + b.ours) - (a.noise + a.ours) || a.suite.localeCompare(b.suite));
}

/** Window scorecard plus current UTC week totals. Escapes are public-main commits, independent of the run-kind filter; gaps link the owner's journey words. */
export function scorecardCard(w, name, {now = new Date(), repo = PUBLIC_REPO} = {}) {
  const escapes = w.escapes || [], rows = scoreRows(w.fails, escapes), cell = (n, tone) => `<td class="num">${n ? chip(String(n), tone) : '<span class="muted">0</span>'}</td>`;
  const body = rows.map(row => `<tr><td><code>${esc(row.suite)}</code></td>${cell(row.caught, 'good')}${cell(row.missed, 'bad')}${cell(row.noise, 'warn')}${cell(row.ours, 'bad')}${cell(row.unnamed, 'off')}<td class="num">${hours(row.min)}</td></tr>`).join('');
  const none = rows.filter(row => !row.caught && row.noise + row.ours + row.unnamed > 0).map(row => row.suite);
  const today = now.toISOString().slice(0, 10), week = weekOf(today), missed = escapes.filter(row => row.week === week), gaps = escapes.filter(row => row.none);
  const caught = scoreRows(w.fails.filter(row => row.day >= week && row.day <= today)).reduce((n, row) => n + row.caught, 0);
  return `<section class="card"><h2>Scorecard: which suites catch bugs · ${esc(name)}</h2>
<p class="muted">A red suite caught a bug when its fix changed the app, the extension or the engine. Every other red cost time: the tests' own causes (flake, timing, drift, test bug), our CI and AI, or not named yet. Missed bugs are owner-seen fixes on public main, counted once per commit and for each suite that missed the journey. Escapes cover the calendar weeks in this range, across all run kinds. Suites with neither reds nor misses are not listed.</p>
<p>This week: caught ${caught} bugs, missed ${missed.length} (${missed.filter(row => row.none).length} with no suite)</p>
${rows.length ? `<div class="scroll"><table><tr><th>Suite</th><th class="num">Caught a bug</th><th class="num">Missed (escaped)</th><th class="num">Test noise</th><th class="num">Our CI and AI</th><th class="num">Not named</th><th class="num">Job time</th></tr>${body}</table></div>
${none.length ? `<p class="muted">Red but caught nothing in this range: ${none.map(suite => `<code>${esc(suite)}</code>`).join(', ')}</p>` : ''}` : '<p class="muted">No red suites in this range.</p>'}
${gaps.length ? `<h3>Missed, no suite plays it</h3><ul>${gaps.map(row => `<li><a href="https://github.com/${esc(repo)}/commit/${esc(row.sha)}">${esc(row.journey)}</a></li>`).join('')}</ul>` : ''}</section>`;
}

/** Snapshot work rows -> one row per week (newest first): commits per kind, and the share that only changed CI or harness plumbing. */
export function workWeeks(work = []) {
  const weeks = new Map();
  for (const row of work) {
    const week = weekOf(row.day), counts = weeks.get(week) || {};
    counts[row.kind] = (counts[row.kind] || 0) + (Number(row.commits) || 0); weeks.set(week, counts);
  }
  return [...weeks].sort((a, b) => b[0].localeCompare(a[0])).map(([week, counts]) => {
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    return {week, counts, total, plumbing: total ? (counts.plumbing || 0) / total : 0};
  });
}

/** The "Where e2e work goes" card: per-week bars by kind, this week's plumbing share against PLUMBING_TARGET, and this week's most-changed e2e and CI files. Not filtered by range: it reads the snapshot's 30 days. */
export function workCard(snapshot, now = new Date()) {
  const weeks = workWeeks(snapshot?.work);
  if (!weeks.length) return '<section class="card"><h2>Where e2e work goes · per week</h2><p class="muted">No commits read yet: the hourly e2e-intel run reads the public repo\'s main.</p></section>';
  // Why (Gitar on #210): the tiles are about the calendar week; a week with no rows yet (Monday morning, or a failing collector) shows as empty, never as the week before.
  const current = weekOf(now.toISOString().slice(0, 10)), latest = weeks[0].week === current ? weeks[0] : {week: current, counts: {}, total: 0, plumbing: 0};
  const pct = share => `${Math.round(share * 100)}%`, target = pct(PLUMBING_TARGET), share = n => (latest.total ? pct(n / latest.total) : '–');
  const rows = weeks.map(row => ({label: dayWords(row.week), title: `week of ${row.week}`, counts: row.counts, share: row.plumbing}));
  const files = snapshot.workFiles || [], latestFiles = files.filter(row => row.week === latest.week).slice(0, 6);
  return `<section class="card"><h2>Where e2e work goes · per week</h2>
<p class="muted">Each commit on main counts once, by the first kind it touched: product, then e2e expectations, then CI and harness plumbing, then unit tests. "Plumbing" is a commit that changed only workflows, the e2e harness or tools. Target: plumbing under ${target} of a week's commits.</p>
<div class="tiles"><section class="card tile"><span class="muted">Plumbing this week</span><b>${share(latest.counts.plumbing || 0)}</b>${latest.total ? chip(latest.plumbing < PLUMBING_TARGET ? `under ${target}` : `over ${target}`, latest.plumbing < PLUMBING_TARGET ? 'good' : 'bad') : ''}<div class="muted">${latest.total ? `${latest.counts.plumbing || 0} of ${latest.total} commits since ${dayWords(latest.week)}` : `no commit read since ${dayWords(latest.week)} yet`}</div></section>
<section class="card tile"><span class="muted">E2E expectations this week</span><b>${share(latest.counts.expectations || 0)}</b><span class="muted">${latest.counts.expectations || 0} commits changed what a suite expects</span></section></div>
<div class="nights">${legend(WORK_KINDS)}${barRows(WORK_KINDS, rows, (row, total) => `${total} commits · ${pct(row.share)} plumbing`)}</div>
${latestFiles.length ? `<h3>Changed most this week (e2e and CI files)</h3><div class="scroll"><table><tr><th>File</th><th class="num">Commits</th></tr>${latestFiles.map(row => `<tr><td><code>${esc(row.file)}</code></td><td class="num">${Number(row.commits)}</td></tr>`).join('')}</table></div>` : ''}</section>`;
}
