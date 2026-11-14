// Layer 2 (the app's own modules on a temp folder; stand-ins for the hidden browser, LinkedIn and the extension; no window): LinkedIn jobs on a person's Find jobs press, journey J4.
// Job: wait on state
// Why (2 Nov 2026, owner via mac-07: J4 LinkedIn goes to Tier 2; "Only tier 1 … should stay e2e"): the linkedin e2e suite left the beta, and its seven steps are these tests, run on every PR
// that touches the app's code. Real: the extension's session route and the window's switch (lib/linkedin-handlers.js), the run's secrets file that stands in for the Keychain (lib/keychain.js
// under JOBADABRA_E2E), the step and its seams (linkedin-beside.js, linkedin-headless.js), the read loop (visits.js runAll and done), the press beside the engine (search-beside.js), the tracked
// run with Stop and its runs.json (pipeline-queue.js), the settings and the app log. Stood in: the engine's own steps and its list of searches, the hidden browser (a cookie jar and tabs, keyed
// like CDP's), its CDP (LinkedIn's 429 arrives as the tab's response) and the extension's read of a page (visits.done with what it read). Timers are mocked, so no step waits on a clock.
// The session is a FAKE value. Nothing here reads the owner's Keychain (asserted), opens a browser or reaches LinkedIn.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as keychain from '../../lib/keychain.js';
import {linkedinSeams} from '../../lib/linkedin-beside.js';
import {registerLinkedinHandlers} from '../../lib/linkedin-handlers.js';
import {SERVICE} from '../../lib/linkedin-session.js';
import {logTo} from '../../lib/log.js';
import {stopTask, tracked} from '../../lib/pipeline-queue.js';
import {besideSteps, setLinkedinStep} from '../../lib/search-beside.js';
import {createStorage} from '../../lib/storage.js';
import * as visits from '../../lib/visits.js';

process.env.JOBADABRA_E2E = '1';   // lib/keychain.js: every Keychain call of this process goes to the run's own secrets file (JOBADABRA_USER_DATA, set per test)
const MARK = 'FAKE-LI-AT';
const COPIED = [{name: 'li_at', value: `${MARK}-integration-0001`, domain: '.linkedin.com'}, {name: 'JSESSIONID', value: `"ajax:${MARK}-js"`, domain: '.www.linkedin.com'}];
const SERVED = 12;   // the jobs the stand-in's list holds
const OTHER_SITE = {name: 'session', value: 'kept', domain: '.boards.example', path: '/'};   // a cookie of another site, already in the hidden browser
const searchesOf = count => Array.from({length: count}, (_, n) => ({name: `LinkedIn: photographer ${n + 1} in Genève`,
  url: `https://www.linkedin.com/jobs/search/?keywords=photographer${n + 1}&location=Gen%C3%A8ve`}));

/** The hidden browser as CDP sees it: a cookie jar keyed by name, domain and path (a host-only cookie is addressed by url), and its tabs. */
function standInBrowser() {
  const jar = new Map([[`${OTHER_SITE.name}@${OTHER_SITE.domain}${OTHER_SITE.path}`, OTHER_SITE]]), tabs = new Set(), calls = [];
  let next = 0;
  const put = cookie => {
    const domain = cookie.domain || new URL(cookie.url).hostname, at = `${cookie.name}@${domain}${cookie.path || '/'}`;
    if (cookie.expires !== undefined && cookie.expires * 1000 < Date.now()) jar.delete(at); else jar.set(at, {name: cookie.name, value: cookie.value, domain, path: cookie.path || '/'});
  };
  return {
    jar, tabs, calls,
    ready: () => true,
    start: async () => { calls.push('start'); return {owner: 'stand-in'}; },
    send: async (method, params) => {
      calls.push(method);
      if (method === 'Storage.setCookies') params.cookies.forEach(put);
      if (method === 'Storage.getCookies') return {cookies: [...jar.values()]};
      if (method === 'Target.createTarget') { const targetId = `T${++next}`; tabs.add(targetId); return {targetId}; }
      if (method === 'Target.closeTarget') tabs.delete(params.targetId);
      return {};
    },
    targetSocket: async id => `stand-in://${id}`,
    put,
    linkedinCookies: () => [...jar.values()].filter(c => /(^|\.)linkedin\.com$/.test(c.domain.replace(/^\./, ''))),
  };
}

/**
 * LinkedIn and the extension behind each tab: `kind` per search ('list' | 'login' | 'loop' | 'check' | 'limited' | 'hold'). A list sets LinkedIn's own cookies (a rotated li_at on the www host,
 * a tracker, a host-only one) and the extension reports what it read; a wall reports its page kind; a 429 is the document's response; 'hold' never answers (for Stop).
 */
function standInLinkedin(browser, kinds, storage) {
  const reads = [], sent = [];
  let reached;
  const held = new Promise(resolve => { reached = resolve; });
  const openCdp = async socket => {
    const listeners = [];
    return {
      on: (event, fn) => { if (event === 'Network.responseReceived') listeners.push(fn); },
      detach: async () => {},
      send: async (method, params) => {
        sent.push(method);
        if (method !== 'Page.navigate') return {};
        const {url} = params, ticket = /#jp-read-([a-z0-9]+)$/.exec(url)?.[1], kind = kinds[reads.length] || 'list';
        reads.push({url, socket, kind, liAt: [...browser.jar.values()].some(c => c.name === 'li_at' && c.value === COPIED[0].value)});
        if (kind === 'hold') { reached(); return {}; }
        if (kind in TIMED) { playTimed(TIMED[kind], {ticket, storage}); return {}; }
        if (kind === 'limited') { listeners.forEach(fn => fn({type: 'Document', response: {status: 429, url: url.split('#')[0]}})); return {}; }
        if (kind === 'list') {
          for (const c of [{name: 'li_at', value: 'rotated', domain: '.www.linkedin.com', path: '/'}, {name: 'bcookie', value: 'b', domain: '.linkedin.com', path: '/'},
            {name: 'lidc', value: 'l', url: 'https://www.linkedin.com/jobs', path: '/jobs'}]) browser.put(c);
          visits.done({ticket, url, jobs: SERVED, added: SERVED, pages: 2});
        } else if (kind === 'loop') visits.done({ticket, url: url.split('#')[0], jobs: 0, pages: 0, unreachable: 'TOO_MANY_REDIRECTS', stopped: 'the site could not be reached: it sent the browser round in a redirect loop (ERR_TOO_MANY_REDIRECTS)'});   // extension/visit.js siteUnreachable
        else visits.done({ticket, url, jobs: 0, added: 0, pages: 0, blocked: kind === 'login' ? 'login' : 'check', stopped: `LinkedIn showed its ${kind} page`});
        return {};
      },
    };
  };
  return {openCdp, reads, sent, held, searches: () => reads.filter(read => read.url.includes('/jobs/search')).length};
}

// Why (#3710, the owner's press of 10 Nov 2026 in app.log): a real LinkedIn read takes its time. The extension says it has the tab at once, LinkedIn's redirect lands on
// /jobs/search-results/, the first page's 7 cards reach the app 33 s after the tab opened and its "done" comes later. Each kind is that timeline, played on the mocked clock.
const READ_AT = 33000, DONE_AT = 62000, LANDED = 'https://www.linkedin.com/jobs/search-results/?currentJobId=4300000001', CARDS = 7;
const TIMED = {
  slow: {page: READ_AT, done: DONE_AT},   // the read the owner's press had: one page, then done
  quiet: {page: READ_AT},                 // one page read, then the extension says nothing more
  silent: {},                             // the tab opened and the extension never answered
};
const pageEngine = async () => ({code: 0, stdout: JSON.stringify({ok: true, name: 'LinkedIn', jobs: CARDS, added: CARDS, fits: 0})});
function playTimed({page, done}, {ticket, storage}) {
  if (page === undefined) return;
  visits.stepOf({ticket, words: 'the extension has the tab: waiting for the page to load'});
  setTimeout(() => visits.read(storage, {ticket, url: LANDED, title: 'Jobs', session: `tab-${ticket}`, cards: Array.from({length: CARDS}, (_, n) => ({title: `Job ${n}`}))}, pageEngine), page);
  if (done !== undefined) setTimeout(() => visits.done({ticket, url: LANDED, jobs: CARDS, added: CARDS, pages: 1}), done);
}
/** Run the press while the mocked clock moves in 5 s steps (at most `ms`), so a timed read plays out. -> the press's result. */
async function pressOverTime(t, r, ms = 200000) {
  let settled = null;
  const pressed = r.press().then(result => { settled = result; });
  for (let at = 0; at <= ms && !settled; at += 5000) {
    for (let n = 0; n < 20; n++) await new Promise(resolve => setImmediate(resolve));
    t.mock.timers.tick(5000);
  }
  await pressed;
  return settled;
}

/** A temp app folder with the real LinkedIn wiring, one stand-in browser and LinkedIn, and the person's press. Cleaned up when the test ends. */
function rig(t, {kinds = ['list'], searches = 1} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-linkedin-'));
  process.env.JOBADABRA_USER_DATA = dir;
  assert.equal(keychain.isolatedFile(), path.join(path.resolve(dir), 'isolated-secrets.json'), 'every Keychain call goes to this run\'s own file, never the owner\'s Keychain');
  t.mock.timers.enable({apis: ['setTimeout', 'setInterval', 'Date'], now: Date.now()});   // Date too: the read's quiet and site clocks compare Date.now() (lib/visits.js runAll)
  logTo(path.join(dir, 'logs'));
  const storage = createStorage(dir, {encrypt: value => value, decrypt: value => value});
  const browser = standInBrowser(), linkedin = standInLinkedin(browser, kinds, storage), engineCalls = [], lines = [];
  const runEngine = async (_, args) => { engineCalls.push(args); return {code: 0, stdout: args.includes('linkedin-searches') ? JSON.stringify({searches: searchesOf(searches)}) : ''}; };
  const seams = linkedinSeams(storage, {browser, runEngine, openCdp: linkedin.openCdp, refresh: {ask: async () => 'no-extension'}});
  setLinkedinStep(seams.step, seams.score);   // what the visits handlers register at the app's start
  const ipc = {}, routes = {};
  registerLinkedinHandlers({DEMO: false, ipcMain: {handle: (name, fn) => { ipc[name] = fn; }}, server: {setVisitRoute: (route, fn) => { routes[route] = fn; }}, storage, openPage: () => ({opened: null})});
  t.after(() => { setLinkedinStep(null); fs.rmSync(dir, {recursive: true, force: true}); });
  return {
    dir, storage, browser, linkedin, engineCalls, lines, ipc,
    /** The extension delivers the session it copied from the person's Chrome (the consent page's yes): the switch turns on. */
    connect: () => assert.deepEqual(routes['/extension/linkedin-session']({cookies: COPIED}), {ok: true}),
    /** The person's Find jobs press: the search task with the LinkedIn step beside the engine's steps, as pipeline-tasks.js searchOnce runs it. -> {ok, run}. */
    press: () => tracked(storage, 'search', 'you', line => lines.push(line), async (tee, signal) => {
      const {code} = await besideSteps(storage, tee, signal, {mode: 'run', trigger: 'you'}, async () => ({code: 0, result: null}));
      return {ok: code === 0};
    }, null, () => ({})),
    mine: () => storage.settings().linkedinJobs || {},
    secrets: () => keychain.isolatedItems(),
  };
}

/** Every file under `root` that holds the fake session value, relative to root. */
function holding(root) {
  const out = [];
  const walk = dir => { for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full); else if (fs.readFileSync(full).toString('latin1').includes(MARK)) out.push(path.relative(root, full).replace(/\\/g, '/'));
  } };
  walk(root);
  return out.sort();
}

test('LinkedIn on: a press reads the guest list in the app\'s hidden browser with the copied session, keeps the jobs, and leaves no LinkedIn cookie in that browser', async t => {
  const r = rig(t);
  r.connect();
  const {ok, run} = await r.press();
  assert.equal(ok, true, 'the press itself ended well');
  assert.equal(r.linkedin.searches(), 1, 'the one search was read');
  assert.equal(r.linkedin.reads[0].liAt, true, 'the copied session was in the browser when LinkedIn was asked');
  assert.deepEqual([r.mine().last?.state, r.mine().last?.jobs], ['done', SERVED], 'the verdict kept counts what LinkedIn served');
  assert.ok(run.log.includes(`LinkedIn: ${SERVED} jobs read`), `the run says how many jobs it read (its lines: ${JSON.stringify(run.log.slice(-6))})`);
  assert.deepEqual(r.browser.linkedinCookies(), [], 'every LinkedIn cookie left the browser, LinkedIn\'s own ones too');
  assert.deepEqual([...r.browser.jar.values()], [OTHER_SITE], 'another site\'s cookie is left as it was');
  assert.equal(r.browser.tabs.size, 0, 'the read\'s tab is closed');
});

for (const [kind, verdict, words, name] of [
  ['login', 'signed-out', /sign in again in Chrome \(⌘K → Renew LinkedIn sign-in\)/, 'LinkedIn sends the read to its sign-in page: one search is opened, the read stops and says to sign in again'],
  // Why (14 Nov 2026, the twin's 3 of 3 searches): a kept session LinkedIn no longer accepts sends the tab round in a redirect loop, not to the sign-in page; it is the same verdict.
  ['loop', 'signed-out', /sign in again in Chrome \(⌘K → Renew LinkedIn sign-in\)/, 'LinkedIn sends the read round in a redirect loop: one search is opened, the read stops and says to sign in again'],
  ['check', 'check', /asked for a check: not answered/, 'LinkedIn shows a check: one search is opened, the read stops, the check is not answered'],
  ['limited', 'limited', /asked us to slow down/, 'LinkedIn answers 429: one search is opened, LinkedIn is left alone for a day and the next press asks it for nothing'],
]) {
  test(name, async t => {
    const r = rig(t, {kinds: [kind], searches: 2});
    r.connect();
    const {run} = await r.press();
    assert.equal(r.mine().last?.state, verdict);
    assert.equal(r.linkedin.searches(), 1, 'the read stopped at the wall: no retry, no next search');
    assert.ok(run.log.some(line => words.test(line)), `the run says why it stopped (its lines: ${JSON.stringify(run.log.slice(-6))})`);
    // Why (Gitar on #4254): a loop and the sign-in page share a verdict, but the run's own line still tells them apart.
    if (kind === 'loop') assert.ok(run.log.some(line => /redirect loop/.test(line)), `the run's line says LinkedIn looped (its lines: ${JSON.stringify(run.log.slice(-6))})`);
    assert.deepEqual(r.browser.linkedinCookies(), [], 'the session left the browser');
    assert.equal(r.browser.tabs.size, 0, 'the tab is closed');
    assert.deepEqual(r.linkedin.sent.filter(method => !['Network.enable', 'Page.navigate'].includes(method)), [], 'the page got no click, typing or script from the app: a check is never answered');
    if (kind !== 'limited') return;
    assert.ok(Date.parse(r.mine().pauseUntil) - Date.now() > 23 * 3600e3, `a 429 leaves LinkedIn alone for about a day (pauseUntil ${r.mine().pauseUntil})`);
    const started = r.browser.calls.filter(call => call === 'start').length;
    const next = await r.press();
    assert.equal(next.ok, true, 'the next press ran');
    assert.equal(r.linkedin.reads.length, 1, 'the next press asked LinkedIn for nothing');
    assert.equal(r.browser.calls.filter(call => call === 'start').length, started, 'and did not start the hidden browser');
    assert.ok(next.run.log.some(line => words.test(line)), 'it says LinkedIn is left alone');
  });
}

for (const [kind, name] of [
  ['slow', 'a LinkedIn read that takes as long as the owner\'s did (first page at 33 s, done at 62 s) counts the jobs it read'],
  ['quiet', 'a LinkedIn read that goes quiet after its first page still counts the jobs that page gave'],
]) {
  test(name, async t => {
    const r = rig(t, {kinds: [kind]});
    r.connect();
    const {run} = await pressOverTime(t, r);
    assert.equal(r.linkedin.searches(), 1, 'the control: the one search was opened');
    const applog = fs.readFileSync(path.join(r.dir, 'logs', 'app.log'), 'utf8');
    assert.ok(applog.includes('"jobs":7'), 'the control: the app read the page\'s 7 jobs');
    assert.ok(applog.includes('"path":"/jobs/search-results/"'), 'the read names the page LinkedIn landed on, by its path');
    assert.equal(/currentJobId|4300000001/.test(applog), false, 'and never its query or an id');
    assert.deepEqual([r.mine().last?.state, r.mine().last?.jobs], ['done', CARDS], `the verdict counts the jobs the page gave (its lines: ${JSON.stringify(run.log.filter(line => /LinkedIn/.test(line)))})`);
    assert.ok(run.log.includes(`LinkedIn: ${CARDS} jobs read`), 'the run says how many');
    assert.equal(run.log.some(line => /none new|no answer from the extension/.test(line)), false, 'never "none new" or "no answer" for a read that answered');
  });
}

test('a LinkedIn read the extension never answers says it could not be read, never "none new"', async t => {
  const r = rig(t, {kinds: ['silent', 'silent'], searches: 2});
  r.connect();
  const {run} = await pressOverTime(t, r);
  assert.equal(r.linkedin.searches(), 2, 'the control: both searches were opened');
  assert.equal(r.mine().last?.state, 'failed', 'no search answered: the verdict is failed');
  assert.ok(run.log.includes('LinkedIn: could not be read this time'), `the run says so (its lines: ${JSON.stringify(run.log.filter(line => /LinkedIn/.test(line)))})`);
  assert.equal(run.log.some(line => /none new/.test(line)), false, 'never "none new" for a read that never answered');
});

test('Stop in the middle of a LinkedIn read closes its tab and takes the session out of the browser', async t => {
  const r = rig(t, {kinds: ['hold']});
  r.connect();
  const pressed = r.press();
  await r.linkedin.held;   // LinkedIn has the request and has not answered
  assert.equal(r.browser.tabs.size, 1, 'the control: the read\'s tab is open before Stop');
  assert.equal(r.browser.linkedinCookies().length, 2, 'the control: the session is in the browser before Stop');
  assert.equal(stopTask().ok, true, 'Stop reached the running press');
  const {ok, run} = await pressed;
  assert.equal(ok, false);
  assert.equal(run.stopped, 'you');
  assert.equal(r.mine().last?.state, 'stopped');
  assert.equal(r.browser.tabs.size, 0, 'the tab is closed');
  assert.deepEqual(r.browser.linkedinCookies(), [], 'the session left the browser');
});

test('the copied session is in no log, run or store file of the app, only in the run\'s secrets file', async t => {
  const r = rig(t, {kinds: ['list', 'check', 'hold', 'limited']});   // every way a read ends, one press each, in one app folder
  r.connect();
  assert.deepEqual(holding(r.dir), ['isolated-secrets.json'], 'the control: the scan finds the session where it is kept');
  for (const kind of ['list', 'check', 'hold', 'limited']) {
    const pressed = r.press();
    if (kind === 'hold') { await r.linkedin.held; stopTask(); }
    await pressed;
  }
  assert.deepEqual(r.linkedin.reads.map(read => read.kind), ['list', 'check', 'hold', 'limited'], 'the control: each press read LinkedIn once');
  assert.ok(fs.statSync(path.join(r.dir, 'runs.json')).size > 0 && fs.statSync(path.join(r.dir, 'logs', 'app.log')).size > 0, 'the runs and the app log were written, so the scan read them');
  assert.deepEqual(holding(r.dir), ['isolated-secrets.json'], 'only the secrets file (the Keychain\'s stand-in) holds the session');
  assert.equal(r.lines.some(line => line.includes(MARK)), false, 'no line the window shows holds it');
  assert.equal(JSON.stringify(r.engineCalls).includes(MARK), false, 'no engine command was given it');
});

test('with the switch off a press asks LinkedIn for nothing and the session is gone from the secrets file', async t => {
  const r = rig(t);
  r.connect();
  assert.ok(SERVICE in r.secrets(), 'the control: the session is in the secrets file while the switch is on');
  assert.deepEqual(await r.ipc.linkedinJobsOff(), {ok: true});
  const {ok, run} = await r.press();
  assert.equal(ok, true, 'the press ran');
  assert.ok(run.endedAt, 'and ended');
  assert.equal(r.linkedin.reads.length, 0, 'LinkedIn was asked for nothing');
  assert.deepEqual(r.browser.calls, [], 'the hidden browser was not touched');
  assert.equal(SERVICE in r.secrets(), false, 'the session is gone from the secrets file');
  assert.equal(r.mine().on, false);
  assert.equal(r.mine().last, undefined, 'no LinkedIn verdict was kept for a press with the switch off');
  assert.deepEqual(run.log.filter(line => /LinkedIn/.test(line)), [], 'and the run says nothing about LinkedIn (no "sign in to LinkedIn" to a person who turned it off)');
});
