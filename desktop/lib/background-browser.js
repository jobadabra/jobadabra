// A Jobadabra-owned headless Chromium with no window; the actual extension owns fill tabs, and the app's live view shows a held page to the person.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn as spawnProcess} from 'node:child_process';
import {guarded} from './real-world.js';
import {randomUUID} from 'node:crypto';
import {ROOT} from './root.js';
import {writePrivate} from './private-file.js';
import {findBackgroundBrowser} from './background-browser-download.js';
import {tabOfSession} from './session-tab.js';
import {startReaper} from './browser-reaper.js';
import {killTree} from './kill-tree.js';

// Why (2026-10-28, e2e proof of Background automation): the test forms use real site names (boards.greenhouse.io), so the hidden browser under e2e must be
// pointed at the fixture server or it would reach the real sites. The harness passes a JSON list in JOBADABRA_E2E_BACKGROUND_BROWSER_ARGS; it counts only with
// JOBADABRA_E2E=1 (never set for a person) and only a host map, the test certificate and (e2e only) --no-sandbox pass, so no other flag, proxy or debugging address can come in this way.
// Why (2026-10-28, #2364): `--no-sandbox` also passes under e2e only: Playwright's own Chromium launches without the sandbox, and a CI runner (Ubuntu 24.04) may not allow the sandbox for the app's plain spawn.
// Why (#3717 Gitar review, 10 Nov 2026): the start-up sweep of LinkedIn leftovers (lib/linkedin-browser.js) deletes rows from a hidden-browser profile's Cookies file; a
// browser started during it would hold that file and the sweep would fail or race it. Every start of every hidden browser waits for the hold first.
let startsWait = Promise.resolve();
/** Hold every hidden-browser start until `promise` settles (a rejection only releases the hold). */
export function holdStartsUntil(promise) { startsWait = Promise.resolve(promise).then(() => {}, () => {}); }

const E2E_ARGUMENTS = /^(--host-resolver-rules=.+|--ignore-certificate-errors|--no-sandbox)$/;
function e2eArguments(env) {
  if (env.JOBADABRA_E2E !== '1') return [];
  try { const list = JSON.parse(env.JOBADABRA_E2E_BACKGROUND_BROWSER_ARGS || '[]'); return Array.isArray(list) ? list.filter(arg => typeof arg === 'string' && E2E_ARGUMENTS.test(arg)) : []; } catch { return []; }
}
/** The size of every hidden application window, in CSS pixels: a laptop's, so sites draw their desktop layout (the live preview fits it to the card). */
export const HIDDEN_WINDOW = Object.freeze({width: 1440, height: 900});
/** Return launch flags for an owned profile and extension, never a system profile or a visible startup page. `env` is only read for the e2e harness's host map (above). */
export function browserArguments(profile, extension, env = process.env) {
  // Why (2026-10-28, owner + measured B1): the person sees a held page in the app's live view; headless Chromium loads the extension with no window, Dock entry or focus change.
  // Why (5 Nov 2026, owner: "It shows the mobile viewport" · "very slow"; measured on Chrome for Testing 156): with no size every window opened at 756 × 469, so sites drew their
  // phone layout, and only one window's page was visible: the others painted 0.2 pictures a second. The window size and --disable-backgrounding-occluded-windows fix both
  // (1440 × 813 pages, all visible, 8.6 pictures a second). The size can only come from here: headless, chrome.windows.create caps a window at the browser's screen (800 px
  // measured). Guards: desktop/integration/extension/hidden-browser-pages.test.mjs (width; drawing on Chrome for Testing 156), test/unit/main/background-browser.test.js (both flags).
  return [`--user-data-dir=${profile}`, '--headless=new', '--remote-debugging-port=0', '--enable-automation', '--no-startup-window', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-default-apps', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows', `--window-size=${HIDDEN_WINDOW.width},${HIDDEN_WINDOW.height}`, `--disable-extensions-except=${extension}`, `--load-extension=${extension}`, ...e2eArguments(env)];
}
/** Accept a debugging port only after CDP reports our exact profile argument; stale/recycled ports never authorize access. */
export function verifiedDebugPort(text, args, profile) {
  const port = Number(String(text).split('\n')[0]);
  return Number.isInteger(port) && port > 0 && port < 65536 && Array.isArray(args) && args.includes(`--user-data-dir=${profile}`) ? port : null;
}
/** Execute one CDP command on a loopback-owned target; timeouts and protocol failures reject without logging page contents. */
export function browserCommand(socketUrl, method, params = {}, {WebSocketClass = globalThis.WebSocket, timeout = 5000} = {}) {
  const url = new URL(socketUrl);
  if (url.protocol !== 'ws:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) return Promise.reject(new Error('Browser debugging address is not loopback.'));
  return new Promise((resolve, reject) => {
    const socket = new WebSocketClass(socketUrl);
    // Settles once: closing a socket whose browser is going away (Browser.close) fires its error event again, which looped here until the stack ran out (8 Nov 2026).
    let settled = false;
    const done = (error, result) => { if (settled) return; settled = true; clearTimeout(timer); socket.close(); error ? reject(error) : resolve(result); };
    const timer = setTimeout(() => done(new Error('Owned browser did not answer.')), timeout);
    socket.addEventListener('open', () => socket.send(JSON.stringify({id: 1, method, params})));
    socket.addEventListener('error', () => done(new Error('Owned browser connection failed.')));
    socket.addEventListener('message', event => {
      let row; try { row = JSON.parse(String(event.data)); } catch { return; }
      if (row.id !== 1) return;
      done(row.error ? new Error(`Owned browser refused ${method}.`) : null, row.result);
    });
  });
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
// No hidden browser runs in this profile: it never started (no port file) or it died and left its port file (the port refuses).
/** Whether a failed call means no browser runs on this profile (no port file, or nothing listens on its port), as opposed to one that runs but is not ours or did not answer. */
export const notRunning = error => error?.code === 'ENOENT' || error?.cause?.code === 'ECONNREFUSED';

/**
 * Own one persistent browser per app profile; reuse only verified processes and it dies with the app (browser-reaper.js).
 * `name`: the folder under the app folder (default the kept 'background-browser'). `claims`: false = its worker never gets the backgroundOwner, so it never polls
 * for queued applications (extension/background-apply.js pollBackgroundApply hands jobs to ANY owned worker that polls); used by the LinkedIn read's own short-lived browser.
 */
export function createBackgroundBrowser(storage, {find = findBackgroundBrowser,   // only the runtime the person downloaded into the app folder; never a system browser
   spawn = guarded(spawnProcess, 'start the background browser'), reaper = startReaper, fetchImpl = globalThis.fetch, root = ROOT, command = browserCommand, name = 'background-browser', claims = true} = {}) {
  const folder = storage.path(name), profile = path.join(folder, 'profile'), extension = path.join(folder, 'extension');
  const portFile = path.join(profile, 'DevToolsActivePort'), ownerFile = path.join(folder, 'owner.json');
  let pending = null, ownChild = null;
  const get = async (port, route) => { const response = await fetchImpl(`http://127.0.0.1:${port}${route}`, {signal: AbortSignal.timeout(2000)}); if (!response.ok) throw new Error('Owned browser is unavailable.'); return response.json(); };
  const connect = async () => {
    const text = fs.readFileSync(portFile, 'utf8'), port = Number(text.split('\n')[0]);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error('No owned debugging port.');
    const info = await get(port, '/json/version');
    const args = await command(info.webSocketDebuggerUrl, 'Browser.getBrowserCommandLine');
    if (!verifiedDebugPort(text, args.arguments, profile)) throw new Error('This browser belongs to another profile.');
    return {port, socket: info.webSocketDebuggerUrl};
  };
  const copyModule = () => import(pathToFileURL(path.join(root, 'desktop', 'ready-fill', 'extension-copy.mjs')).href);
  // Copies the app's extension, launches the browser on the kept profile and waits for its debugging port.
  async function launch(appPort) {
    const executable = find(storage.path('background-browser-runtime'));
    if (!executable) throw Object.assign(new Error('Download the optional background browser first.'), {code: 'BACKGROUND_BROWSER_MISSING'});
    const {copyForNight} = await copyModule();
    fs.rmSync(extension, {recursive: true, force: true});
    copyForNight(appPort, path.join(root, 'extension'), extension, {owned: true});
    fs.mkdirSync(profile, {recursive: true, mode: 0o700});
    // Why (8 Nov 2026, owner: "how we can prevent this ?"): Chrome keeps the extension worker a kept profile first registered, even when the folder is rewritten
    // in place (measured: starts 2 and 3 ran start 1's code; a new manifest version did not help), so the twin ran its 28 Oct worker on 8 Nov and no fix reached it.
    // The folder holds every site's service workers and Cache Storage (first loads after a launch are slower); cookies, sign-ins and the extension's own storage stay.
    // The twin once (8 Oct 2026, twin.mjs) saw no worker at all after clearing worker state: start() counts that as a miss, relaunches once and then names it.
    fs.rmSync(path.join(profile, 'Default', 'Service Worker'), {recursive: true, force: true});
    fs.rmSync(portFile, {force: true});
    // Why (2026-10-28, #2364; names renamed 1 Nov 2026): under e2e the browser's own messages go to a file the harness prints when it does not start (a CI failure said only "did not start"); a person's browser keeps none.
    const log = process.env.JOBADABRA_E2E === '1' ? fs.openSync(path.join(folder, 'e2e-browser.log'), 'w') : 'ignore';
    ownChild = spawn(executable, browserArguments(profile, extension), {detached: true, stdio: ['ignore', log, log], windowsHide: true});
    if (log !== 'ignore') fs.closeSync(log);
    let spawnError = null, live = null;
    ownChild.on('error', error => { spawnError = error; });
    ownChild.unref();
    if (ownChild.pid) reaper(process.pid, ownChild.pid);   // Why (2026-10-28, owner: "Always close it"): the browser dies with the app, however the app ends; it is detached only so the supervisor, not the OS, decides when
    const until = Date.now() + 20000;
    while (!live && Date.now() < until) {
      if (spawnError) throw new Error('The background browser could not start.');
      await pause(100);
      live = await connect().catch(() => null);
    }
    if (!live) { ownChild.kill(); throw new Error('The background browser did not start; its own process was stopped.'); }
    return live;
  }
  // The owned extension's worker target, or null when it does not show within the hang guard.
  async function workerOf(live) {
    const until = Date.now() + 15000;
    while (Date.now() < until) {
      const worker = (await get(live.port, '/json/list')).find(target => target.type === 'service_worker' && /^chrome-extension:\/\//.test(target.url) && target.url.endsWith('/background-owned.js'));
      if (worker) return worker;
      await pause(100);
    }
    return null;
  }
  const evaluator = worker => async (fn, value) => {
    const expression = `(${fn.toString()})(${JSON.stringify(value) || 'undefined'})`;
    const result = await command(worker.webSocketDebuggerUrl, 'Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true});
    if (result.exceptionDetails) throw new Error('The owned extension is not ready.');
    return result.result?.value;
  };
  // The stamp the worker runs ('' for none). A worker is listed before its module has run and may not answer yet, so it is read until it matches, for 5 s.
  async function runningStamp(worker, expected) {
    const evaluate = evaluator(worker), until = Date.now() + 5000;
    let running = '';
    do {
      try { running = await evaluate(() => globalThis.__jobadabraOwnedCopy || ''); } catch { running = ''; }   // not answering yet: read again until the 5 s end
      if (running === expected) return running;
      await pause(100);
    } while (Date.now() < until);
    return running;
  }
  // Ends a verified browser of this profile and waits until its port is gone.
  async function end(live) {
    await command(live.socket, 'Browser.close').catch(() => {});   // a browser already closing may drop the socket first; the wait below is the check
    const until = Date.now() + 10000;
    while (Date.now() < until) { if (!(await connect().catch(() => null))) return; await pause(100); }
    throw new Error('The background browser runs an old copy of the extension and did not close.');
  }
  async function start({port: appPort, token}) {
    if (!Number.isInteger(appPort) || !token) throw new Error('The app server is not ready.');
    pending ||= (async () => {
      await startsWait;
      fs.mkdirSync(folder, {recursive: true, mode: 0o700});
      let owner; try { owner = JSON.parse(fs.readFileSync(ownerFile, 'utf8')).owner; } catch { /* first use */ }
      if (!owner) { owner = randomUUID(); writePrivate(ownerFile, JSON.stringify({owner})); }
      // Why (8 Nov 2026, owner: "how we can prevent this ?"): an old worker carries old Submit and hand-off rules, so the token goes only to a worker running the
      // extension this app ships (its stamp: extension-copy.mjs extensionStamp). Any other (a kept worker, a browser an older app left running) is closed and the
      // browser launched once more; a worker that never shows counts the same; a second miss is refused with its code. Test: integration/extension/hidden-browser-runs-new-copy.test.mjs.
      const expected = (await copyModule()).extensionStamp(path.join(root, 'extension'), appPort);
      let live = await connect().catch(() => null), worker = null, running = '';
      for (let misses = 0; ; ) {
        live ||= await launch(appPort);
        worker = await workerOf(live);
        running = worker ? await runningStamp(worker, expected) : '';
        if (worker && running === expected) {
          const {setExtensionStorage} = await import(pathToFileURL(path.join(root, 'desktop', 'ready-fill', 'extension-storage.mjs')).href);
          await setExtensionStorage({evaluate: evaluator(worker)}, {workerUrl: `http://127.0.0.1:${appPort}`, token, ...(claims ? {backgroundOwner: owner} : {backgroundReadsOnly: true})});
          return {owner, port: live.port};
        }
        misses += 1;
        if (misses >= 2) break;
        await end(live);
        live = null;
      }
      if (!worker) throw Object.assign(new Error('The owned browser extension did not start, also after a relaunch.'), {code: 'BACKGROUND_EXTENSION_NOT_STARTED'});
      throw Object.assign(new Error(`The background browser still runs another copy of the extension after a relaunch (running ${running || 'none'}, expected ${expected}).`), {code: 'BACKGROUND_EXTENSION_STALE'});
    })().finally(() => { pending = null; });
    return pending;
  }
  async function sessionAction(session, action, options = {}) {
    const live = await connect();
    const worker = (await get(live.port, '/json/list')).find(target => target.type === 'service_worker' && target.url.endsWith('/background-owned.js'));
    if (!worker) return false;
    const expression = `globalThis.__jobPilottoBackgroundSessions?.${action}(${JSON.stringify(session)})`;
    const result = await command(worker.webSocketDebuggerUrl, 'Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true}, options);
    return result.result?.value === true;
  }
  // The held tab of one application session, by the ONE rule that says which tab is a session's (lib/session-tab.js): its loopback CDP address, or null.
  // Why (5 Nov 2026, review of [ap] 7/7): after a restart no hidden browser runs, so the live view must say "closed", not "cannot tell" for ever; only a browser
  // that does not answer in time (or is not ours) still throws.
  async function pageSocket(session) {
    const live = await connect().catch(error => { if (notRunning(error)) return null; throw error; });
    if (!live) return null;
    const pages = (await get(live.port, '/json/list')).filter(target => target.type === 'page');
    return tabOfSession(String(session || ''), pages)?.webSocketDebuggerUrl || null;
  }
  /** One CDP command on the verified browser (cookies, a new tab, closing one) -> its result. Throws when the browser is not ours or not running; nothing is sent then. */
  async function send(method, params = {}) { const live = await connect(); return command(live.socket, method, params); }
  /** The loopback CDP address of one open tab by its target id, or null (a worker or a closed tab is not one). */
  async function targetSocket(targetId) {
    const live = await connect();
    return (await get(live.port, '/json/list')).find(target => target.type === 'page' && target.id === targetId)?.webSocketDebuggerUrl || null;
  }
  async function close() { const live = await connect(); await command(live.socket, 'Browser.close').catch(() => {}); }
  const exited = () => ownChild.exitCode !== null || ownChild.signalCode !== null;
  const within = async (ms, done) => { for (const until = Date.now() + ms; Date.now() < until; await pause(100)) if (await done()) return true; return done(); };
  /**
   * Close this profile's browser and wait until it is gone (10 s hang guard). -> true when none runs any more.
   * Invariant: a browser this instance started is judged by its own process exiting, never by its port going quiet (a hung browser stops answering yet still holds the profile).
   */
  async function quit() {
    const live = await connect().catch(() => null);
    if (live) await command(live.socket, 'Browser.close').catch(() => {});
    if (!ownChild) return !live || within(10000, async () => !(await connect().catch(() => null)));
    if (await within(10000, exited)) return true;
    // Why (#3717 Gitar review, 10 Nov 2026): a browser that does not close keeps the LinkedIn session's folder open; the one this app started is ended with its helpers
    // (its whole tree: helpers hold the folder's files on Windows), so its folder can be deleted at once instead of waiting for the next app start.
    killTree(ownChild, {signal: 'SIGKILL'});   // Windows: taskkill /T (its helpers too); elsewhere its process group
    return within(5000, exited);
  }
  // wake(): the owned worker polls the app now (extension/background-apply.js poll), for a queued Jobs-check read or queued applications; true when the app acknowledged that poll.
  // Why (10 Nov 2026, hw review): wake's poll opens a window for each claimed job (up to 10) before it answers and can pass the 5 s command limit: a wake that worked would be logged as failed. 30 s is a hang guard.
  const wake = () => sessionAction(null, 'poll', {timeout: 30000});
  return {folder, ready: () => !!find(storage.path('background-browser-runtime')), start, quit, pageSocket, send, targetSocket, reveal: session => sessionAction(session, 'reveal'), closeSession: session => sessionAction(session, 'closeSession'), wake, close};
}
