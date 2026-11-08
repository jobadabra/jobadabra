// Integration test: after an update, the app's hidden browser runs the extension the app just copied, not the one its kept profile first registered.
// Guard: safety — without it the hidden browser can run an old extension (old Submit and hand-off rules included) for weeks after an update, and every extension fix misses it.
// Why (8 Nov 2026, owner: "we fixed this type of bugs tens of times. Why it's still there?" · "how we can prevent this ?"): the live-test twin's hidden browser still ran its
// 28 Oct worker on 8 Nov (it set the flag's pre-2-Nov name; its files on disk set the new one), so its 11 Jobs-check reads were handed out and never started. Chrome keeps
// the service worker a kept profile first registered when the extension folder is rewritten in place (measured: starts 2 and 3 ran start 1's code; a new manifest
// version did not help). Every other test starts on a fresh profile, so none could see it. Real: the app's own start (lib/background-browser.js createBackgroundBrowser:
// copy, launch, worker, storage) on a real headless Chromium, twice on one profile. Stood in: the app's port (nothing listens; the worker only has to load).
// Nothing here reaches the owner's app, profile or a real site.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {test} from 'node:test';
import {chromium} from '../../e2e/lib/visit-page.mjs';
import {endBrowser} from '../../e2e/lib/browser-end.mjs';
import {CLOSE_MS, at, capOf, clocked, onHang} from '../../e2e/lib/test-clock.mjs';
import {createBackgroundBrowser} from '../../lib/background-browser.js';

const TEST_MS = 90000;   // a hang guard: each start takes ~1-3 s
const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXTENSION = path.resolve(DESKTOP, '..', 'extension');

async function json(url) { return (await fetch(url)).json(); }
// One CDP evaluate on the worker; a socket that closes or says nothing for 15 s rejects (a hang guard, never a verdict).
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

test('after an update the hidden browser runs the new extension, on the profile it kept', {timeout: TEST_MS + CLOSE_MS + 5000}, clocked(TEST_MS, async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-hidden-new-copy-'));
  const root = path.join(folder, 'root'), source = path.join(root, 'extension');
  fs.mkdirSync(root);
  fs.symlinkSync(DESKTOP, path.join(root, 'desktop'), 'junction');   // the app imports its copy and storage helpers from <root>/desktop/ready-fill
  const release = edition => {   // the extension as one app build ships it: the real extension, marked with its edition at the top of its worker
    fs.rmSync(source, {recursive: true, force: true});
    fs.cpSync(EXTENSION, source, {recursive: true});
    const worker = path.join(source, 'background.js');
    fs.writeFileSync(worker, `globalThis.__testEdition = '${edition}';\n${fs.readFileSync(worker, 'utf8')}`);
  };
  const storage = {path: name => path.join(folder, 'home', name)};
  const profile = storage.path(path.join('background-browser', 'profile'));
  // A CI runner may not allow the sandbox for a plain spawn: the app's own e2e allowance passes it (lib/background-browser.js e2eArguments), nothing else.
  const env = {JOBADABRA_E2E: process.env.JOBADABRA_E2E, JOBADABRA_E2E_BACKGROUND_BROWSER_ARGS: process.env.JOBADABRA_E2E_BACKGROUND_BROWSER_ARGS};
  process.env.JOBADABRA_E2E = '1'; process.env.JOBADABRA_E2E_BACKGROUND_BROWSER_ARGS = JSON.stringify(['--no-sandbox']);
  const children = [];
  const app = () => createBackgroundBrowser(storage, {root, find: () => chromium.executablePath(), reaper: () => {},
    spawn: (file, args, options) => { const child = spawn(file, args, options); children.push(child); return child; }});
  const close = () => endBrowser({profile, launched: true});
  onHang(close);
  const editionRunning = async () => {
    const port = Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]);
    const worker = (await json(`http://127.0.0.1:${port}/json/list`)).find(target => target.type === 'service_worker' && target.url.endsWith('/background-owned.js'));
    return evaluate(worker.webSocketDebuggerUrl, 'globalThis.__testEdition');
  };
  try {
    at('the first start, on a fresh profile');
    release('first');
    await app().start({port: 51999, token: 'stand-in-token'});
    assert.equal(await editionRunning(), 'first', 'positive control: a fresh profile runs the copy it was given');
    await close();
    at('the start after an update, on the profile it kept');
    release('second');
    await app().start({port: 51999, token: 'stand-in-token'});
    assert.equal(await editionRunning(), 'second', 'the hidden browser still runs the extension its profile first registered: every update since misses it');
  } finally {
    await close();
    if (env.JOBADABRA_E2E === undefined) delete process.env.JOBADABRA_E2E; else process.env.JOBADABRA_E2E = env.JOBADABRA_E2E;
    if (env.JOBADABRA_E2E_BACKGROUND_BROWSER_ARGS === undefined) delete process.env.JOBADABRA_E2E_BACKGROUND_BROWSER_ARGS; else process.env.JOBADABRA_E2E_BACKGROUND_BROWSER_ARGS = env.JOBADABRA_E2E_BACKGROUND_BROWSER_ARGS;
    for (const child of children) if (child.exitCode === null) child.kill();
    fs.rmSync(folder, {recursive: true, force: true});
  }
}));
