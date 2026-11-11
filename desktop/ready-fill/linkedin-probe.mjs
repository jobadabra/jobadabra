// The `linkedin` task of the cloud runner (spec docs/superpowers/specs/2026-11-11-always-on-parity-design.md, 1/6): ONE LinkedIn Jobs search page read once from the cloud browser, to measure
// whether LinkedIn answers a data-centre read without a check. It is a measurement, not the product lane: no extension, no stealth, the browser's own user agent, no retry, no second page.
// Invariants: the session (li_at, JSESSIONID) is only ever in addCookies and never in a log, a result or an error; the browser, its context and its profile are closed on every way out;
// the verdict says `go` only for status 200 + the search page still shown + the SIGNED-IN page (its navigation bar, no guest sign-in form) + job cards of the signed-in list, every other answer is `no` (LinkedIn stays Mac-only: owner, 11 Nov 2026: "If LinkedIn answers without a check, build it; if it asks for a check, LinkedIn stays Mac-only and nothing more is tried").
// Why (11 Nov 2026): a doubt can only end as `no`, so the probe needs no guess about what a page means; the product lane (5/6) reads through the extension and its page-kind judge as on the Mac.
// Guard: desktop/test/unit/ready-fill/linkedin-probe.test.js.
export const SEARCH = 'https://www.linkedin.com/jobs/search/?keywords=engineer&location=Switzerland';
export const LIMITED = [401, 403, 429, 999];   // the statuses that end a LinkedIn read at once (lib/linkedin-headless.js)
const TOKEN = /^[\x21-\x7e]{1,2048}$/;
// Structure only (where things sit; no page text). Why (code review, 11 Nov 2026): LinkedIn serves a public guest page with job cards at the same /jobs/search address when it does not accept the session, so cards alone
// are not an answer: `go` needs the signed-in navigation bar and the signed-in list, and a guest list or sign-in form is the word `guest`. A selector that LinkedIn changed can only turn `go` into `unclear` (stays on the Mac).
export const SIGNED_CARDS = '[data-occludable-job-id], .scaffold-layout__list-item, li.jobs-search-results__list-item';
export const GUEST = '.base-card.job-search-card, .jobs-search__results-list > li, input[name="session_key"], .sign-in-modal, .authwall-join-form, [data-tracking-control-name="public_jobs_nav-header-signin"]';
export const NAV = '#global-nav, header.global-nav, .global-nav__me';

/** Pure: the session as the app sent it, reduced to the two allowed cookies, or null (li_at is required; a value that is not one printable token is refused). */
export function cookiesOf(session) {
  const list = [['li_at', session?.li_at], ['JSESSIONID', session?.JSESSIONID]].filter(([, value]) => value !== undefined && value !== '');
  if (!list.length || list[0][0] !== 'li_at' || !list.every(([, value]) => typeof value === 'string' && TOKEN.test(value))) return null;
  return list.map(([name, value]) => ({name, value, domain: '.linkedin.com', path: '/', secure: true, httpOnly: name === 'li_at', sameSite: 'None'}));
}

/** Pure: which kind of address the browser ended on: `results` (the search page), `login` (sign-in or authwall), `check` (a checkpoint or challenge), or `other`. Address paths only; no page text. */
export function kindOfPath(path) {
  if (/^\/jobs\/search/.test(path)) return 'results';
  if (/^\/(checkpoint|challenge)/.test(path)) return 'check';
  if (/^\/(login|uas|authwall|signup)/.test(path)) return 'login';
  return 'other';
}

/** Pure: {status, path, cards, nav, guest, limited} -> {go, word}. `limited`: any main-document answer was 401/403/429/999. `word` is the one word the site keeps: ok | limited | login | check | guest | unclear | nocards | other | error. */
export function verdictOf({status, path, cards = 0, nav = 0, guest = 0, limited = false}) {
  if (limited || LIMITED.includes(status)) return {go: false, word: 'limited'};
  const kind = kindOfPath(path || '');
  if (kind !== 'results') return {go: false, word: kind};
  if (status !== 200) return {go: false, word: 'error'};
  if (guest > 0) return {go: false, word: 'guest'};
  if (nav === 0) return {go: false, word: 'unclear'};
  return cards > 0 ? {go: true, word: 'ok'} : {go: false, word: 'nocards'};
}

/**
 * Reads ONE page. `chromium`: Playwright's. `session`: {li_at, JSESSIONID?}. -> {status, path, cards, go, word}; a start or load that fails answers {word: 'error', go: false}.
 * Closes the browser (and with it every cookie) before it returns.
 */
export async function probeOne({chromium, session, url = SEARCH, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), launchOptions = {}, extraArgs = []}) {
  const cookies = cookiesOf(session);
  if (!cookies) return {status: 0, path: '', cards: 0, nav: 0, guest: 0, go: false, word: 'error'};
  let browser = null;
  try {
    browser = await chromium.launch({headless: true, args: ['--no-sandbox', ...extraArgs], timeout: 90000, ...launchOptions});
    const context = await browser.newContext({locale: 'en-US'});
    await context.addCookies(cookies);
    const page = await context.newPage();
    const statuses = [];
    page.on('response', response => { if (response.request().resourceType() === 'document') statuses.push(response.status()); });   // every main-document answer: a 429 anywhere ends it, the last one is the page shown
    await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 30000});
    await wait(4000);
    const path = new URL(page.url()).pathname;
    const limited = statuses.some(each => LIMITED.includes(each)), status = statuses.at(-1) || 0;
    const count = selector => (limited ? 0 : page.locator(selector).count().catch(() => 0));
    const [cards, nav, guest] = [await count(SIGNED_CARDS), await count(NAV), await count(GUEST)];
    return {status, path, cards, nav, guest, ...verdictOf({status, path, cards, nav, guest, limited})};
  } catch { return {status: 0, path: '', cards: 0, nav: 0, guest: 0, go: false, word: 'error'}; } finally { await browser?.close().catch(() => {}); }
}

/**
 * The night: the batch's one job, read once. `batch.linkedin` is the session the site sealed with it (returned to this night's token only). `tell.result(body)` -> the site's answer.
 * -> {results: Map(jobId -> the read)}. The log gets words and counts only.
 */
export async function probeNight({batch, chromium, tell, told = new Set(), log = () => {}, now = Date.now, probe = probeOne, extraArgs = [], launchOptions = {}}) {
  const job = batch.jobs[0], started = now(), results = new Map();
  const read = await probe({chromium, session: batch.linkedin, extraArgs, launchOptions});
  const ms = now() - started;
  log('linkedin probe', {word: read.word, status: read.status, cards: read.cards});
  results.set(job.id, read);
  await tell.result({job: job.id, task: 'linkedin', state: 'read', read: {status: read.status, path: read.path, cards: read.cards, nav: read.nav, guest: read.guest, go: read.go, word: read.word}, why: read.word, ms, costMicro: tell.costMicro(ms)});
  told.add(job.id);
  return {results};
}
