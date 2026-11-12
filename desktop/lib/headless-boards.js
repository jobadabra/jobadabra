// Job boards that refuse the plain reader, read during the person's own Find jobs press in Jobadabra's own headless Chrome (owner, 12 Nov 2026, asked via AskUserQuestion:
// "Yes, as boards (Recommended)", "Boards now, employers next (Recommended)", "5 boards, each once a day (Recommended)"; rule: CLAUDE.md, the refused-sites exception).
// One board at a time, in a fresh profile with no cookies or logins (lib/headless-boards-beside.js deletes it before and after), as an honest browser (its own user agent,
// no stealth: lib/background-browser.js browserArguments), only loading the listing page: no click, no typing, no second page. The engine's AI says what the page is
// (src/sources/refused_state.py page_state); a check, captcha, sign-in page or 401/403 stops that board with no retry and a 429 waits a day (src/sources/refused_reads.py outcome).
// Guards: test/guards/safety/headless-boards-gate.test.js, test/unit/main/headless-boards.test.js.
import {openCdpSession} from './cdp-session.js';

/** How long a board's page may take to load; a passive check that clears by itself gets up to this long again. */
export const LOAD_MS = 15000;
/** How often a passive check is looked at again while it clears by itself. */
export const POLL_MS = 3000;
/** Boards read in one press: the engine's day share (refused_reads.DAY_SITES) is the cap; this one holds if a queue ever says more. */
export const MAX_BOARDS = 5;
const STATUS_STOPS = new Set([401, 403, 429]);   // the engine's floors read these with no AI asked
const NEVER = ['linkedin.', 'indeed.', 'glassdoor.', 'levels.fyi', 'reddit.', 'xing.'];   // login-wall sites: only through the person's own visit
const JUDGED = new Set(['login', 'refused', 'passive_check']);   // the AI's verdicts that stop a board (a passive check still there after the wait is a bot check)
const SNAPSHOT = 'JSON.stringify({html: document.documentElement.outerHTML, title: document.title, final: location.href})';
const WORDS = {
  'no-browser': 'Job boards: download Jobadabra\'s browser (one time) to read the boards that refuse plain reading',
  failed: 'Job boards: Jobadabra\'s browser could not start; the boards wait for the next Find jobs',
};

/** True for a board the engine queued at a plain https address that is not a login-wall site (checked here too, whatever the engine says). */
export function mayRead(item) {
  if (item?.kind !== 'board') return false;
  let parts;
  try { parts = new URL(item.url); } catch { return false; }
  return parts.protocol === 'https:' && !NEVER.some(word => `${parts.hostname.toLowerCase()}.`.includes(word));
}

/** A wait that Stop or the press's deadline ends early. */
export const nap = (ms, signal) => new Promise(resolve => {
  if (signal?.aborted) { resolve(); return; }
  const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); };
  const timer = setTimeout(done, ms);
  signal?.addEventListener('abort', done, {once: true});
});

async function snapshot(cdp, url, status) {
  const answer = await cdp.send('Runtime.evaluate', {expression: SNAPSHOT, returnByValue: true}).catch(() => null);
  let seen = {};
  try { seen = JSON.parse(answer?.result?.value || '{}'); } catch { /* no page: read as empty */ }
  return {url, status, html: String(seen.html || '').slice(0, 3_000_000), title: String(seen.title || '').slice(0, 300), final: String(seen.final || url).slice(0, 500)};
}

// One board in its own tab: load it, wait for a passive check to clear by itself, and say what the page is. -> {page, state} (state null: not judged).
async function readOne({browser, openCdp, url, judge, signal, now, sleep}) {
  const {targetId} = await browser.send('Target.createTarget', {url: 'about:blank'});
  let cdp = null;
  try {
    cdp = await openCdp(await browser.targetSocket(targetId));
    const seen = {status: 0};
    let loaded = () => {};
    const load = new Promise(resolve => { loaded = resolve; });
    cdp.on('Network.responseReceived', ({type, response} = {}) => { if (type === 'Document' && !seen.status) seen.status = Number(response?.status) || 0; });
    cdp.on('Page.loadEventFired', () => loaded());
    await cdp.send('Network.enable');
    await cdp.send('Page.enable');
    const started = now();
    await cdp.send('Page.navigate', {url});
    await Promise.race([load, sleep(LOAD_MS, signal)]);
    let page = await snapshot(cdp, url, seen.status);
    if (STATUS_STOPS.has(seen.status) || signal?.aborted) return {page, state: null};
    let state = await judge(page).catch(() => null);
    while (state === 'passive_check' && now() - started < 2 * LOAD_MS && !signal?.aborted) {   // only waiting: never a click, a key or a solved check
      await sleep(POLL_MS, signal);
      page = await snapshot(cdp, url, seen.status);
      state = await judge(page).catch(() => null);
    }
    return {page, state};
  } finally {
    await cdp?.detach().catch(() => {});
    await browser.send('Target.closeTarget', {targetId}).catch(() => {});
  }
}

const line = (name, answer) => {
  if (answer?.state === 'read') return `Job boards: ${name}: ${answer.jobs} job${answer.jobs === 1 ? '' : 's'} read in Jobadabra's browser`;
  if (answer?.state === 'empty') return `Job boards: ${name}: no jobs on the page in Jobadabra's browser`;
  return `Job boards: ${name}: ${answer?.why || 'not read'}`;
};

/**
 * Read the refused boards the engine queued, one at a time, in the owned browser. Every seam is injected: browser {ready, send, targetSocket}, start(), queue() -> [{url, name, kind}],
 * judge(page) -> page_state or null, outcome(page) -> the engine's answer, openCdp. A board the press's deadline or Stop did not reach waits for the next press (nothing is kept for it).
 * -> {state: 'off'|'no-browser'|'failed'|'done'|'stopped', jobs, fits?, read?, of?}.
 */
export async function boardsStep({browser, start, queue, judge, outcome, openCdp = openCdpSession, tee = () => {}, signal = null, now = Date.now, sleep = nap}) {
  if (signal?.aborted) return {state: 'stopped', jobs: 0};
  const list = (await queue().catch(() => [])).filter(mayRead).slice(0, MAX_BOARDS);
  if (!list.length || signal?.aborted) return {state: 'off', jobs: 0};
  if (!browser.ready()) { tee(WORDS['no-browser']); return {state: 'no-browser', jobs: 0}; }
  try { await start(); } catch { tee(WORDS.failed); return {state: 'failed', jobs: 0}; }
  tee(`Job boards: reading ${list.length} that refuse plain reading in Jobadabra's browser, 1 at a time`);
  const total = {jobs: 0, fits: 0, read: 0};
  for (const [index, item] of list.entries()) {
    if (index) await sleep(2000 + Math.random() * 2000, signal);   // a gap between boards, like a person
    if (signal?.aborted) break;
    const got = await readOne({browser, openCdp, url: item.url, judge, signal, now, sleep}).catch(() => null);
    if (signal?.aborted) break;
    const page = got?.page || {url: item.url, status: 0, html: '', title: '', final: item.url};
    const verdict = got?.state === 'captcha' ? {captcha: true} : JUDGED.has(got?.state) ? {judged: got.state} : {};   // words-ok: the engine AI's fixed page_state answers
    const answer = await outcome({...page, step: 'headless', ...verdict}).catch(() => null);
    total.read += 1; total.jobs += answer?.jobs || 0; total.fits += answer?.fits || 0;
    tee(line(item.name || new URL(item.url).hostname, answer));
  }
  return {state: signal?.aborted ? 'stopped' : 'done', ...total, of: list.length};
}
