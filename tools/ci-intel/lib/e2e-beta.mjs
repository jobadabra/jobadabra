// Suites green vs red in every beta run (owner, 1 Nov 2026: "I want this graph in /admin/e2e"; the coordinator had counted them from GitHub by hand). One bar per beta run, oldest to newest:
// green = e2e suite jobs that passed, red = failed, grey = did not run or did not finish; a ✓ above a bar = that beta was released. Built only from the snapshot row's `betaRuns`
// (jobadabra-web admin/e2e-intel.js keeps it, tools/ci-intel/jobs/e2e-intel.mjs sends it hourly); the page never calls GitHub. Drawn by jobadabra-web admin/e2e-page.js (betaCard). Guards: test/admin/e2e-{beta,intel,page}.test.js.
import {esc} from './html.mjs';
import {CHIP_STYLE, chip} from './chip.mjs';

const DAY = 86400000, KEEP_DAYS = 30, MAX_RUNS = 600;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const count = value => Number.isInteger(value) && value >= 0 && value < 100000;
const text = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max);
const dayWords = day => `${Number(day.slice(8))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;

/** One collector row -> the bounded row the site keeps, or null. Both ends call it (the collector before sending, the site before storing). */
export function cleanBetaRun(row, now = new Date()) {
  const at = Date.parse(row?.createdAt);
  if (!Number.isSafeInteger(row?.runId) || row.runId <= 0 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(row.createdAt || '') || !(at >= now.getTime() - KEEP_DAYS * DAY && at <= now.getTime())) return null;
  if (!['success', 'failure', 'cancelled'].includes(row.conclusion) || !count(row.green) || !count(row.red) || !count(row.grey) || typeof row.released !== 'boolean' || !/^[a-f0-9]{7,40}$/i.test(row.sha || '')) return null;
  const redSuites = (Array.isArray(row.redSuites) ? row.redSuites : []).slice(0, 200).filter(name => typeof name === 'string' && name.trim()).map(name => text(name, 80));
  return {runId: row.runId, createdAt: new Date(at).toISOString().slice(0, 16) + ':00Z', sha: row.sha.slice(0, 7).toLowerCase(), conclusion: row.conclusion,
    green: row.green, red: row.red, grey: row.grey, released: row.released, redSuites};
}

/** Merge the sent rows into the snapshot's last 30 days (a re-read run replaces its row). Rows sent are bounded; an omitted field keeps the previous rows. */
export function betaData(previous = {}, data = {}, now = new Date()) {
  const rows = new Map();
  for (const row of [...(previous.betaRuns || []), ...(Array.isArray(data.betaRuns) ? data.betaRuns.slice(0, 500) : [])]) {
    const clean = cleanBetaRun(row, now);
    if (clean) rows.set(clean.runId, clean);
  }
  return {betaRuns: [...rows.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.runId - a.runId).slice(0, MAX_RUNS)};
}

/** The beta runs of the page's range (the UTC days back from `now`, as the page's other cards count them), oldest first. */
export function betaRuns(snapshot, {days = 7, now = new Date()} = {}) {
  const keys = new Set(Array.from({length: days}, (_, i) => new Date(now.getTime() - i * DAY).toISOString().slice(0, 10)));
  return (snapshot?.betaRuns || []).filter(row => keys.has(row.createdAt.slice(0, 10))).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.runId - b.runId);
}

/** The four tiles' numbers. "Ran their suites" = not cancelled and at least one suite finished green or red (a run that stopped early shows no verdict). */
export function betaSummary(rows) {
  const ran = rows.filter(row => row.conclusion !== 'cancelled' && row.green + row.red > 0);
  return {runs: rows.length, released: rows.filter(row => row.released).length, ran: ran.length, zeroRed: ran.filter(row => !row.red).length, oneRed: ran.filter(row => row.red === 1).length};
}

const GREEN = '#3fb68b', RED = '#e5484d', GREY = '#4a525c';
export const BETA_CSS = `${CHIP_STYLE}.bkey{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:13px;color:#8d949c;margin:10px 0}.bkey i{display:inline-block;width:11px;height:11px;border-radius:3px;margin-right:6px;vertical-align:-1px}
.bchart{position:relative;min-width:max-content;padding-left:30px}.bgl{position:absolute;left:30px;right:0;border-top:1px dashed #262c33}.bgl span{position:absolute;left:-28px;top:-9px;font-size:11px;color:#8d949c}
.bbars{display:flex;align-items:flex-end;gap:4px;position:relative}.bcol{flex:1 1 0;min-width:16px;max-width:56px;display:flex;flex-direction:column;align-items:center;color:inherit;text-decoration:none}.bcol.newday{margin-left:9px}
.bcol:focus-visible{outline:2px solid #f5b54a;outline-offset:2px;border-radius:4px}.bcol:hover .bstack,.bcol:focus .bstack{filter:brightness(1.2)}
.bmk{height:18px;font-size:13px;font-weight:700;color:${GREEN}}.bstack{width:100%;display:flex;flex-direction:column;justify-content:flex-end;gap:2px}.bstack span{display:block;border-radius:3px}
.bnum{height:16px;font-size:11.5px;font-weight:700;font-variant-numeric:tabular-nums}.blab{height:44px;display:flex;flex-direction:column;align-items:center;font-size:10.5px;color:#8d949c;white-space:nowrap}
.blab b{font-size:11px;color:#f4efe3;font-weight:600}.blab i{font-style:normal;writing-mode:vertical-rl;transform:rotate(180deg);height:30px}
#btip{position:fixed;z-index:5;max-width:320px;background:#14181d;color:#f4efe3;border:1px solid #262c33;border-radius:8px;padding:8px 10px;font-size:12.5px;white-space:pre-line;box-shadow:0 6px 20px rgba(0,0,0,.4);pointer-events:none}`;
// Why (1 Nov 2026, a8): the tooltip is fixed-position so the chart's scroll box does not clip it; without script the same text is in the table under the chart.
export const BETA_SCRIPT = `(()=>{const tip=document.getElementById('btip');if(!tip)return;const show=e=>{const c=e.target.closest&&e.target.closest('[data-tip]');if(!c)return;tip.textContent=c.dataset.tip;tip.hidden=false;
const r=c.getBoundingClientRect();tip.style.top=Math.max(8,r.top-tip.offsetHeight-6)+'px';tip.style.left=Math.min(innerWidth-tip.offsetWidth-8,Math.max(8,r.left+r.width/2-tip.offsetWidth/2))+'px'};
const hide=()=>{tip.hidden=true};for(const t of['mouseover','focusin'])document.addEventListener(t,show);for(const t of['mouseout','focusout'])document.addEventListener(t,hide)})()`;

const STACK = 170, MAX_NAMES = 6;
const timeOf = row => row.createdAt.slice(11, 16);
const sumOf = row => row.green + row.red + row.grey;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
function tipText(row) {
  const lines = [`${row.createdAt.slice(0, 10)} ${timeOf(row)} UTC · run ${row.runId} · commit ${row.sha}`,
    `${plural(row.green, 'suite', 'suites')} green · ${row.red} red${row.grey ? ` · ${row.grey} didn't run or not finished` : ''}`];
  if (row.redSuites.length) lines.push(`Red: ${row.redSuites.slice(0, MAX_NAMES).join(', ')}${row.redSuites.length > MAX_NAMES ? ` … +${row.redSuites.length - MAX_NAMES}` : ''}`);
  if (row.released) lines.push('released');
  return lines.join('\n');
}

function chart(rows, repo) {
  const most = Math.max(1, ...rows.map(sumOf)), scale = STACK / most, step = most <= 30 ? 10 : most <= 70 ? 20 : 40;
  const grid = Array.from({length: Math.floor(most / step)}, (_, i) => (i + 1) * step).map(n => `<div class="bgl" style="bottom:${60 + n * scale}px"><span>${n}</span></div>`).join('');
  const seg = (n, color) => (n ? `<span style="height:${Math.max(2, n * scale).toFixed(1)}px;background:${color}"></span>` : '');
  const cols = rows.map((row, i) => {
    const first = i === 0 || row.createdAt.slice(0, 10) !== rows[i - 1].createdAt.slice(0, 10), tip = tipText(row);
    return `<a class="bcol${first && i ? ' newday' : ''}" href="https://github.com/${esc(repo)}/actions/runs/${row.runId}" data-tip="${esc(tip)}" aria-label="${esc(tip.replace(/\n/g, '. '))}"><span class="bmk">${row.released ? '✓' : ''}</span>`
      + `<div class="bstack" style="height:${STACK}px">${seg(row.grey, GREY)}${seg(row.red, RED)}${seg(row.green, GREEN)}</div><span class="bnum">${row.red || ''}</span>`
      + `<span class="blab"><b>${first ? Number(row.createdAt.slice(8, 10)) : '&nbsp;'}</b><i>${timeOf(row)}</i></span></a>`;
  }).join('');
  return `<div style="overflow-x:auto;padding-bottom:4px"><div class="bchart" role="group" aria-label="Suites per beta run, oldest to newest">${grid}<div class="bbars">${cols}</div></div></div>`;
}

function table(rows, repo) {
  const body = rows.slice().reverse().map(row => `<tr><td><a href="https://github.com/${esc(repo)}/actions/runs/${row.runId}">#${row.runId}</a></td><td>${esc(row.createdAt.slice(0, 10))} ${timeOf(row)}</td><td><code>${esc(row.sha)}</code></td>`
    + `<td class="num">${row.green}</td><td class="num">${row.red ? chip(String(row.red), 'bad') : '0'}</td><td class="num">${row.grey}</td><td>${row.released ? chip('released', 'good') : row.conclusion === 'cancelled' ? chip('cancelled', 'off') : ''}</td>`
    + `<td class="muted">${esc(row.redSuites.join(', '))}</td></tr>`).join('');
  return `<details><summary class="muted">Numbers per run (newest first)</summary><div style="overflow-x:auto"><table><tr><th>Run</th><th>Started (UTC)</th><th>Commit</th><th class="num">Green</th><th class="num">Red</th><th class="num">Didn't run</th><th>Release</th><th>Red suites</th></tr>${body}</table></div></details>`;
}

/** The "Suites per beta run" card: four tiles, the bars, a legend and the table. `days` = the page's range; `repo` for the run links. */
export function betaCard(snapshot, {days = 7, now = new Date(), repo = 'GarryOne/jobadabra', scopeName = ''} = {}) {
  const head = `<h2>Suites per beta run · ${esc(scopeName)}</h2>`;
  if (!Array.isArray(snapshot?.betaRuns)) return `<section class="card">${head}<p class="muted">Not collected yet: the hourly collector adds each beta run's suites on its next pass.</p></section>`;
  const rows = betaRuns(snapshot, {days, now});
  if (!rows.length) return `<section class="card">${head}<p class="muted">No beta run in this range.</p></section>`;
  const s = betaSummary(rows), tile = (label, value, note) => `<section class="card tile"><span class="muted">${label}</span><b>${value}</b><span class="muted">${note}</span></section>`;
  return `<section class="card">${head}<div class="tiles">${tile('Beta runs', s.runs, 'finished or cancelled in this range')}${tile('Released', s.released, `of ${plural(s.runs, 'beta', 'betas')}`)}`
    + `${tile('Zero red', `${s.zeroRed} of ${s.ran}`, 'betas that ran their suites had 0 red')}${tile('Exactly one red', `${s.oneRed} of ${s.ran}`, 'betas that ran their suites had 1 red')}</div>`
    + `<div class="bkey"><span><i style="background:${GREEN}"></i>suite green</span><span><i style="background:${RED}"></i>suite red (count under the bar)</span><span><i style="background:${GREY}"></i>didn't run / not finished</span><span>✓ above a bar = released</span></div>`
    + `${chart(rows, repo)}<div id="btip" role="tooltip" hidden></div><script>${BETA_SCRIPT}</script>${table(rows, repo)}`
    + `<p class="muted">One bar per beta run, oldest to newest (UTC); the number under the first bar of a day is its date. Hover or focus a bar for its commit and red suites; click opens the run. ${dayWords(rows[0].createdAt.slice(0, 10))} – ${dayWords(rows[rows.length - 1].createdAt.slice(0, 10))}.</p></section>`;
}
