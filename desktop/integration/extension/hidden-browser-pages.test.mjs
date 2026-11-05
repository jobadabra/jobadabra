// Hidden-browser pages draw like a laptop's and every one keeps drawing: the app's own launch flags, a real headless Chromium, several application windows.
// Job: wait on state
// Why (5 Nov 2026, owner: "It shows the mobile viewport while it should show more the desktop one" · "very slow"; spec 2026-11-05-applying-redesign.md):
// measured on the app's Chrome for Testing 156, every hidden window opened at 756 × 469 (sites drew their phone layout) and only one window's page was
// visible: the others painted 0.2 pictures a second in the live preview. Real: lib/background-browser.js browserArguments and the extension's way of opening
// a session (extension/background-session.mjs: chrome.windows.create({url, focused: false}), one window each). Stood in: the extension (a two-file one that
// only opens windows) and the form (a fictional local page). Nothing here reaches the owner's app, profile or a real site.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {test} from 'node:test';
import {chromium} from '../../e2e/lib/visit-page.mjs';
import {endBrowser} from '../../e2e/lib/browser-end.mjs';
import {CLOSE_MS, at, capOf, clocked, onHang} from '../../e2e/lib/test-clock.mjs';
import {HIDDEN_WINDOW, browserArguments} from '../../lib/background-browser.js';

const SESSIONS = 3;
const TEST_MS = 60000;   // a hang guard: the browser starts in ~1 s and each page draws its 120 frames in ~2 s

async function json(url) { return (await fetch(url)).json(); }
// One CDP evaluate on a page or worker; a socket that closes or says nothing for 15 s rejects (a hang guard, never a verdict).
function evaluate(socketUrl, expression) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(socketUrl);
    const fail = why => { clearTimeout(guard); socket.close(); reject(new Error(`${why}: ${socketUrl}`)); };
    const guard = setTimeout(() => fail('no answer in time'), capOf(15000));
    socket.onerror = () => fail('no connection');
    socket.onclose = () => fail('closed before answering');
    socket.onopen = () => socket.send(JSON.stringify({id: 1, method: 'Runtime.evaluate', params: {expression, awaitPromise: true, returnByValue: true}}));
    socket.onmessage = event => { const row = JSON.parse(event.data); if (row.id === 1) { clearTimeout(guard); socket.onclose = null; socket.close(); resolve(row.result?.result?.value); } };
  });
}
async function until(read, what, ms = 20000) {   // 20 s: the app gives its browser as long to start (lib/background-browser.js)
  let last = null;
  for (const end = Date.now() + capOf(ms); Date.now() < end;) {
    let value = null;
    try { value = await read(); } catch (error) { last = error; }   // not up yet (no port file, no worker): asked again; the last error is in the failure
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`never happened: ${what}${last ? ` (last error: ${last.message})` : ''}`);
}

test('every hidden application page is laid out at desktop width and stays visible, however many sessions are open', {timeout: TEST_MS + CLOSE_MS + 5000}, clocked(TEST_MS, async () => {
  at('starting the hidden browser');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-hidden-pages-')), profile = path.join(folder, 'profile'), extension = path.join(folder, 'extension');
  fs.mkdirSync(extension);
  fs.writeFileSync(path.join(extension, 'manifest.json'), JSON.stringify({manifest_version: 3, name: 'stand-in', version: '1', background: {service_worker: 'worker.js'}}));
  fs.writeFileSync(path.join(extension, 'worker.js'), 'self.ready = true;');
  const server = http.createServer((_, response) => { response.setHeader('content-type', 'text/html'); response.end('<!doctype html><title>Apply</title><label>Name <input required></label>'); }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.on('listening', resolve));
  // A CI runner may not allow the sandbox for a plain spawn (the app's e2e launch says the same, lib/background-browser.js); a fictional local page needs none.
  const args = [...browserArguments(profile, extension, {}), '--no-sandbox'];
  // HIDDEN_BROWSER_BIN=<the app's downloaded Chrome for Testing> plays the drawing half too: Playwright's Chromium (1243, 1248) shows every page visible even without
  // the flag, so on CI that half is held by the flag's unit check (test/unit/main/background-browser.test.js) and this test proves the width.
  const browser = spawn(process.env.HIDDEN_BROWSER_BIN || chromium.executablePath(), args, {stdio: 'ignore'});
  let spawnError = null;
  browser.on('error', error => { spawnError = error; });
  // Why (5 Nov 2026, run 42047229578): deleting the profile right after the main process exited failed with ENOTEMPTY on Linux: Chrome's helper processes were still
  // writing in it. The shared end (lib/browser-end.mjs) kills every process of this profile and waits until none is left; the main process's own kill is its fallback.
  const close = () => endBrowser({profile, launched: true, fallback: async () => { if (browser.exitCode === null && !spawnError) { const gone = new Promise(resolve => browser.once('exit', resolve)); browser.kill(); await gone; } }});
  onHang(close);
  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    const port = await until(async () => { if (spawnError) throw spawnError; return fs.existsSync(portFile) && Number(fs.readFileSync(portFile, 'utf8').split('\n')[0]); }, 'the browser wrote its port');
    at('starting the extension');
    const worker = await until(async () => (await json(`http://127.0.0.1:${port}/json/list`)).find(target => target.type === 'service_worker'), 'the extension worker started');
    await until(() => evaluate(worker.webSocketDebuggerUrl, 'typeof chrome.windows?.create === "function"'), 'the extension API is bound');
    at('opening the application windows');
    const form = `http://127.0.0.1:${server.address().port}/apply`;
    for (let i = 0; i < SESSIONS; i++) await evaluate(worker.webSocketDebuggerUrl, `chrome.windows.create({url: ${JSON.stringify(form)}, focused: false}).then(w => w.id)`);
    const pages = await until(async () => { const list = (await json(`http://127.0.0.1:${port}/json/list`)).filter(target => target.type === 'page' && target.url === form); return list.length === SESSIONS && list; }, `${SESSIONS} pages open`);
    // Drawing is the state a live preview needs: each page counts the frames it draws, up to 120, about 2 s (a page that turns hidden stops near 1 s: 53 frames measured; a hidden page draws none; the 10 s cap only ends a hang).
    const DRAWS = 'new Promise(done => { let frames = 0; const stop = setTimeout(() => done(frames), 10000); const tick = () => (++frames >= 120 ? (clearTimeout(stop), done(frames)) : requestAnimationFrame(tick)); requestAnimationFrame(tick); })';
    at('reading each page\'s width and drawing');
    const seen = [];
    for (const page of pages) {
      const width = await until(() => evaluate(page.webSocketDebuggerUrl, 'document.readyState === "complete" && innerWidth'), 'the page loaded');
      seen.push({width, frames: await evaluate(page.webSocketDebuggerUrl, DRAWS), visibility: await evaluate(page.webSocketDebuggerUrl, 'document.visibilityState')});
    }
    assert.ok(seen.every(page => page.width === HIDDEN_WINDOW.width), `every page at desktop width (sites switch to their phone/tablet layout below ~1024 px): ${JSON.stringify(seen)}`);
    assert.ok(seen.every(page => page.frames >= 120 && page.visibility === 'visible'), `every page visible and drawing, for its live preview and its fill: ${JSON.stringify(seen)}`);
  } finally {
    server.close();
    at('closing the browser');
    await close();
    fs.rmSync(folder, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
  }
}));
