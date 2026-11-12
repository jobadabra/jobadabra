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
const SNAPSHOT = 'JSON.stringify({html: document.documentElement.outerHTML, title: document.title, final: location.href})';
const WORDS = {
  'no-browser': 'Job boards: download Jobadabra\'s browser (one time) to read the boards that refuse plain reading',
  failed: 'Job boards: Jobadabra\'s browser could not start; the boards wait for the next Find jobs',
  spent: 'Job boards: today\'s reads in Jobadabra\'s browser are used; the rest wait for tomorrow',
  final: 'turned Jobadabra\'s browser away, so its browser will not open this board again',
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
  // Why (12 Nov 2026, sa for the owner, "final stop"): the engine's reason ("HTTP 403", "a login page") stays in the log; Recent activity says what happened
  if (answer?.state === 'stopped' && answer.final && !answer.needs_check) return `Job boards: ${name}: ${WORDS.final}`;
  return `Job boards: ${name}: ${answer?.why || 'not read'}`;
};

/**
 * Read the refused boards the engine queued, one at a time, in the owned browser. Every seam is injected: browser {ready, send, targetSocket}, start(), queue() -> [{url, name, kind}],
 * changed(signal) -> true once the board memory changed since the last ask, false at Stop or the press's deadline (none: the queue is asked once),
 * begin(item) -> true when the engine spent today's share for it (before its page loads), judge(page) -> page_state or null, outcome(page) -> the engine's answer, openCdp.
 * A board the press's deadline or Stop did not reach waits for the next press (nothing is spent or kept for it). The engine owns what each verdict means (refused_reads.outcome).
 * Invariants: at most MAX_BOARDS opened a press, an address at most once a press, the browser starts only when a board is due.
 * -> {state: 'off'|'no-browser'|'failed'|'done'|'stopped', jobs, fits?, read?, of?}.
 */
export async function boardsStep({browser, start, queue, changed = null, begin, judge, outcome, openCdp = openCdpSession, tee = () => {}, signal = null, now = Date.now, sleep = nap}) {
  if (signal?.aborted) return {state: 'stopped', jobs: 0};
  const total = {jobs: 0, fits: 0, read: 0}, tried = new Set();
  let started = false, spent = false, listed = 0;
  // Why (13 Nov 2026, night 43313523472): asked once at second 0, a person's first press had nothing queued: its boards refuse the plain reader
  // at ~30 s (p1 Jobs.bg at 28 s, p3 Jobat at 33 s); the engine keeps each refusal as it happens (board_ideas.keep_board), so the queue is asked again then
  do {
    const list = (await queue().catch(() => [])).filter(item => mayRead(item) && !tried.has(item.url)).slice(0, MAX_BOARDS - tried.size);
    if (signal?.aborted) break;
    if (list.length && !started) {
      if (!browser.ready()) { tee(WORDS['no-browser']); return {state: 'no-browser', jobs: 0}; }
      try { await start(); } catch { tee(WORDS.failed); return {state: 'failed', jobs: 0}; }
      started = true;
    }
    if (list.length) tee(`Job boards: reading ${list.length} that refuse plain reading in Jobadabra's browser, 1 at a time`);
    listed += list.length;
    for (const item of list) {
      if (tried.size) await sleep(2000 + Math.random() * 2000, signal);   // a gap between boards, like a person
      if (signal?.aborted) break;
      if (!(await begin(item).catch(() => false))) { tee(WORDS.spent); spent = true; break; }   // spent before the page loads: a read killed mid-way is not repeated today
      tried.add(item.url);
      const got = await readOne({browser, openCdp, url: item.url, judge, signal, now, sleep}).catch(() => null);
      if (signal?.aborted) break;
      const page = got?.page || {url: item.url, status: 0, html: '', title: '', final: item.url};
      const answer = await outcome({...page, step: 'headless', ...(got?.state ? {judged: got.state} : {})}).catch(() => null);   // not judged (a busy AI): no verdict is made up
      const name = item.name || new URL(item.url).hostname;
      if (!answer) { tee(`Job boards: ${name}: not read (no answer from the engine)`); continue; }
      total.read += 1; total.jobs += answer.jobs || 0; total.fits += answer.fits || 0;
      tee(line(name, answer));
    }
  } while (changed && !spent && tried.size < MAX_BOARDS && !signal?.aborted && await changed(signal).catch(() => false));
  if (!started) return {state: signal?.aborted ? 'stopped' : 'off', jobs: 0};
  return {state: signal?.aborted ? 'stopped' : 'done', ...total, of: listed};
}
