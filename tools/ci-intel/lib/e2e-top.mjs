// The top of /admin/testing/e2e (owner, 27 Oct 2026: "What are the biggest root causes? Is the flakiness? Is real bugs? ... code changed without adjusting the e2e" and
// "having the e2e on the PRs it's very very slow ... I need to understand if this is worth or not"): who caused the reds (our CI and AI, the tests, the app), the top causes
// with test drift always named, the top suites, the biggest breaks (one cause copied onto many suites), PR e2e's cost against what it caught, and main's green share per day.
// Pure: draws the window jobadabra-web admin/e2e-page.js computes. Guard: jobadabra-web test/admin/e2e-page.test.js.
import {esc} from './html.mjs';
import {PUBLIC_REPO} from '../../../desktop/e2e/lib/repos.mjs';
import {CAUSES, GROUPS, groupOf} from './e2e-causes.mjs';
import {CHIP_STYLE, chip} from './chip.mjs';

const num = value => (Number(value) || 0).toLocaleString('en-US', {maximumFractionDigits: 0});
const pct = (part, whole) => (whole ? `${Math.round((part / whole) * 100)}%` : '–');
const color = id => CAUSES.find(cause => cause.id === id)?.color || '#8d949c';
const label = id => CAUSES.find(cause => cause.id === id)?.label || id;
const GROUP_COLOR = {ours: '#9b7be0', tests: '#e07b39', app: '#3fb68b', none: '#5b6b7a'};
const FULL = ['beta', 'nightly', 'scheduled'];   // runs of every suite on main (after a merge, main runs only the touched steps)
export const PR_START = '2026-10-24';   // PR e2e started (pr-suites.yml); steps picked by changed lines from 26 Oct

// Per group, per cause, per suite; the breaks; PR cost and catch; main's green share per day. w: windowOf() of the page.
export function summary(w) {
  const byGroup = Object.fromEntries(GROUPS.map(group => [group.id, 0]));
  for (const [id, n] of Object.entries(w.byCause)) byGroup[groupOf(id)] += n;
  const causes = CAUSES.map(cause => ({id: cause.id, n: w.byCause[cause.id] || 0})).filter(row => row.n || row.id === 'drift').sort((a, b) => b.n - a.n);
  const suites = new Map();
  for (const fail of w.fails) {
    const row = suites.get(fail.suite) || {suite: fail.suite, n: 0, causes: {}};
    row.n += fail.n; row.causes[fail.cause] = (row.causes[fail.cause] || 0) + fail.n; suites.set(fail.suite, row);
  }
  const topSuites = [...suites.values()].sort((a, b) => b.n - a.n || a.suite.localeCompare(b.suite)).slice(0, 5)
    .map(row => ({...row, main: Object.entries(row.causes).sort((a, b) => b[1] - a[1])[0]}));
  const prDays = w.allDays.filter(day => day.kind === 'pr'), prFails = w.allFails.filter(fail => fail.kind === 'pr');
  const sumOf = (rows, field) => rows.reduce((total, row) => total + (Number(row[field]) || 0), 0);
  const prCaught = w.caught.filter(item => item.kind === 'pr');   // the caught list holds every run kind since 2 Nov 2026; this card is the cost of PR e2e only
  const pr = {runs: sumOf(prDays, 'runs'), queueMin: sumOf(prDays, 'queueMin'), runMin: sumOf(prDays, 'runMin'), caught: prCaught.length, caughtList: prCaught,
    drift: sumOf(prFails.filter(fail => fail.cause === 'drift'), 'n'), noise: sumOf(prFails.filter(fail => groupOf(fail.cause) === 'ours'), 'n'), flakes: sumOf(prFails.filter(fail => fail.cause === 'flake'), 'n')};
  pr.perBug = pr.caught ? Math.round((pr.queueMin + pr.runMin) / pr.caught) : null;
  const green = new Map();
  for (const day of w.allDays) {
    const row = green.get(day.day) || {day: day.day, full: [0, 0], merge: [0, 0], prMin: 0};
    if (FULL.includes(day.kind)) { row.full[0] += day.greens || 0; row.full[1] += day.runs || 0; }
    if (day.kind === 'after-merge') { row.merge[0] += day.greens || 0; row.merge[1] += day.runs || 0; }
    if (day.kind === 'pr') row.prMin += (day.queueMin || 0) + (day.runMin || 0);
    green.set(day.day, row);
  }
  return {byGroup, causes, topSuites, breaks: w.breaks.filter(item => item.n > 1).slice(0, 5), pr, green: [...green.values()].sort((a, b) => b.day.localeCompare(a.day)), reds: w.reds, breakCount: w.breaks.length};
}

const bar = (parts, total) => `<div class="stack">${parts.filter(part => part.n).map(part => `<span style="width:${(part.n / total) * 100}%;background:${part.color}" title="${esc(part.label)} ${part.n}">${part.n / total >= 0.08 ? `${esc(part.label)} ${num(part.n)}` : ''}</span>`).join('')}</div>`;

/** The "top" block of the e2e page and nothing else: `w` = windowOf()'s result; '' when the window holds no red suite. `repo` builds the links (the page passes its own). */
export function top(w, {repo = PUBLIC_REPO} = {}) {
  const s = summary(w);
  if (!s.reds) return '';
  const groups = GROUPS.filter(group => group.id !== 'none' || s.byGroup.none);
  const plural = (n, word) => `${num(n)} ${word}${n === 1 ? '' : 's'}`;
  const verdict = `<b>${plural(s.reds, 'red suite')} from ${plural(s.breakCount, 'break')}:</b> ${groups.map(group => `${esc(group.id === 'ours' ? group.label : group.label[0].toLowerCase() + group.label.slice(1))} ${pct(s.byGroup[group.id], s.reds)}`).join(' · ')}.`;
  const max = Math.max(...s.causes.map(row => row.n), 1);
  const causeRows = s.causes.map(row => `<div class="hrow"><span>${row.id === 'drift' ? '<b>' : ''}<span class="sw" style="background:${color(row.id)}"></span>${esc(label(row.id))}${row.id === 'drift' ? '</b>' : ''}</span>
<span class="track"><span style="width:${(row.n / max) * 100}%;background:${color(row.id)}"></span></span><span class="num">${num(row.n)}</span></div>`).join('');
  const suiteRows = s.topSuites.map(row => `<tr><td><code>${esc(row.suite)}</code></td><td class="num">${num(row.n)}</td><td>${chip(`${esc(label(row.main[0]))} ${num(row.main[1])}`)}</td></tr>`).join('');
  const breakRows = s.breaks.map(item => `<tr><td class="num">${num(item.n)}</td><td>${chip(esc(item.kind))}</td><td>${chip(esc(label(item.cause)))}</td><td><a href="https://github.com/${esc(repo)}/actions/runs/${Number(item.runId)}">${esc(item.day)}</a></td><td class="muted line">${esc(item.line || '(no failure line)')}</td></tr>`).join('');
  const p = s.pr;
  const prLine = p.runs ? `<p><b>${p.caught ? `${num(p.perBug)} runner-minutes per caught bug` : 'No bug caught yet'}:</b> ${num(p.runs)} PR e2e runs, ${num(p.queueMin)} min waiting for a runner + ${num(p.runMin)} min running; caught ${num(p.caught)} bug${p.caught === 1 ? '' : 's'} and ${num(p.drift)} test drift before merge; its own CI and AI reds: ${num(p.noise)}, flakes ${num(p.flakes)}.</p>` : '<p class="muted">No PR e2e run in this range.</p>';
  const caught = p.caughtList.map(item => `<li>${item.pr ? `<a href="https://github.com/${esc(repo)}/pull/${Number(item.pr)}">#${Number(item.pr)}</a>` : 'a PR'} · <code>${esc(item.suite)}</code> · <span class="muted">${esc(item.line)}</span></li>`).join('');
  const share = ([green, runs]) => (runs ? `${pct(green, runs)} <span class="muted">(${green}/${runs})</span>` : '<span class="muted">–</span>');
  const greenRows = s.green.map(row => `<tr${row.day === PR_START ? ' class="mark"' : ''}><td>${esc(row.day)}${row.day === PR_START ? ' · PR e2e starts' : ''}</td><td class="num">${share(row.full)}</td><td class="num">${share(row.merge)}</td><td class="num">${row.prMin ? num(row.prMin) : '–'}</td></tr>`).join('');
  return `<section class="card top"><p class="verdict">${verdict}</p>${bar(groups.map(group => ({n: s.byGroup[group.id], label: group.label, color: GROUP_COLOR[group.id]})), s.reds)}
<div class="cols"><div><h2>Top causes</h2>${causeRows}</div><div><h2>Top 5 suites</h2><table><tr><th>Suite</th><th class="num">Reds</th><th>Main cause</th></tr>${suiteRows}</table></div></div></section>
${breakRows ? `<section class="card"><h2>Biggest breaks · one cause, many red suites</h2><div class="scroll"><table><tr><th class="num">Suites</th><th>Run</th><th>Cause</th><th>Day</th><th>Failure line</th></tr>${breakRows}</table></div></section>` : ''}
<section class="card"><h2>PR e2e: cost vs catch</h2>${prLine}${caught ? `<ul class="caught">${caught}</ul>` : ''}
<h3>Main's green share per day</h3><div class="scroll"><table><tr><th>Day</th><th class="num">Full runs green</th><th class="num">After-merge steps green</th><th class="num">PR e2e minutes</th></tr>${greenRows}</table></div></section>`;
}

export const TOP_CSS = `${CHIP_STYLE}` + '.top .verdict{font-size:17px;margin:0 0 8px}.stack{display:flex;height:26px;border-radius:6px;overflow:hidden;margin:0 0 14px}.stack span{display:block;line-height:26px;text-align:center;color:#fff;font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0 4px;min-width:0}'
  + '.cols{display:grid;grid-template-columns:1fr 1fr;gap:20px}@media (max-width:760px){.cols{grid-template-columns:1fr}}.hrow{display:grid;grid-template-columns:170px 1fr 44px;gap:8px;align-items:center;margin:4px 0}'
  + '.track{height:12px;background:#1d2229;border-radius:4px;overflow:hidden}.track span{display:block;height:100%}.hrow .num{text-align:right}td.line{max-width:520px}.caught{margin:6px 0 12px;padding-left:18px}tr.mark td{border-top:2px solid #f5b54a}';
