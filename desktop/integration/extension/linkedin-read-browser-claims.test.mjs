// Guard: safety — the read browser must never fill or submit: the LinkedIn read's own hidden browser never claims a queued application.
// Job: assert state
// Why (#3711, 10 Nov 2026): the LinkedIn read moved into its own short-lived hidden browser (lib/linkedin-browser.js). The app hands up to 10 queued applications to ANY owned
// worker that polls with a backgroundOwner (extension/background-apply.js pollBackgroundApply), so a second owned browser with an owner would take applications, fill them and,
// in Full automation, submit them in a browser that is deleted when the read ends.
// Real: the app's own start of both browsers (lib/background-browser.js createBackgroundBrowser: extension copy, launch, worker, storage) on a real headless Chromium, the real
// extension's poll (wake). Stood in: the app's server (records polls and answers with one queued job), the app folder. Nothing reaches the owner's app, profile or a real site.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {test} from 'node:test';
import {chromium} from '../../e2e/lib/visit-page.mjs';
import {endBrowser} from '../../e2e/lib/browser-end.mjs';
import {CLOSE_MS, at, clocked, onHang} from '../../e2e/lib/test-clock.mjs';
import {createBackgroundBrowser} from '../../lib/background-browser.js';
import {KEPT_FOLDER, READ_FOLDER, linkedinReadBrowser} from '../../lib/linkedin-browser.js';
import {POST_CORS, jsonBody, jsonHeaders, jsonPayload, preflight} from '../../lib/server-http.js';

const TEST_MS = 90000;   // a hang guard: each start takes ~1-3 s
const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const E2E_ENV = {JOBADABRA_E2E: '1', JOBADABRA_E2E_BACKGROUND_BROWSER_ARGS: JSON.stringify(['--no-sandbox'])};

async function withE2eEnv(body) {
  const kept = Object.fromEntries(Object.keys(E2E_ENV).map(key => [key, process.env[key]]));
  Object.assign(process.env, E2E_ENV);
  try { return await body(); } finally { for (const [key, value] of Object.entries(kept)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
}
async function workerStorage(browser) {
  const port = Number(fs.readFileSync(path.join(browser.folder, 'profile', 'DevToolsActivePort'), 'utf8').split('\n')[0]);
  const worker = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(target => target.type === 'service_worker' && target.url.endsWith('/background-owned.js'));
  const socket = new WebSocket(worker.webSocketDebuggerUrl);
  return new Promise((resolve, reject) => {
    const guard = setTimeout(() => { socket.close(); reject(new Error('the worker did not answer in time')); }, 15000);
    socket.onopen = () => socket.send(JSON.stringify({id: 1, method: 'Runtime.evaluate', params: {expression: 'chrome.storage.local.get(null).then(all => Object.keys(all))', awaitPromise: true, returnByValue: true}}));
    socket.onmessage = event => { const row = JSON.parse(event.data); if (row.id === 1) { clearTimeout(guard); socket.close(); resolve(row.result?.result?.value || []); } };
  });
}

test('the LinkedIn read\'s browser never polls for or claims a queued application; the kept browser does (positive control)', {timeout: TEST_MS + CLOSE_MS + 5000}, clocked(TEST_MS, () => withE2eEnv(async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-li-claims-')), root = path.join(folder, 'root');
  fs.mkdirSync(root);
  fs.symlinkSync(DESKTOP, path.join(root, 'desktop'), 'junction');
  fs.cpSync(path.resolve(DESKTOP, '..', 'extension'), path.join(root, 'extension'), {recursive: true});   // a copy, never a link: the app rewrites its copy's port in place
  const storage = {path: name => path.join(folder, 'home', name)};
  const polls = [];
  // The app's server, stand-in: one application is queued; a poll is recorded with the owner it carried and answered with nothing to start (the job is never handed out here).
  const server = http.createServer((request, response) => {
    if (preflight(request, response, POST_CORS)) return;
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      const payload = jsonPayload(body);
      if (request.url.startsWith('/extension/background-apply') && payload.action === 'poll') polls.push(String(payload.owner || ''));
      jsonHeaders(response, 200, POST_CORS); jsonBody(response, {ok: true, jobs: []});
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const deps = {root, find: () => chromium.executablePath(), reaper: () => {}, spawn: (file, args, options) => spawn(file, args, {...options, env: {...process.env, ...E2E_ENV}})};
  // Why (#3711): cleanup of both folders; the one this test never started, or a browser the step already disposed, has nothing left to end (logged).
  const close = async () => { for (const name of [READ_FOLDER, KEPT_FOLDER]) await endBrowser({profile: path.join(storage.path(name), 'profile'), launched: true}).catch(error => console.log(`cleanup: endBrowser ${name}: ${error.message}`)); };
  onHang(close);
  try {
    const start = {port: server.address().port, token: 'stand-in-token'};
    at('the LinkedIn read\'s browser');
    const read = linkedinReadBrowser(storage, deps);
    await read.start(start);
    const readKeys = await workerStorage(read);
    assert.ok(!readKeys.includes('backgroundOwner'), 'the read browser\'s worker holds no backgroundOwner');
    assert.ok(readKeys.includes('backgroundReadsOnly'), 'and is marked reads-only, so it never fills a tab (extension/background-apply.js backgroundMayFill)');
    assert.equal(await read.wake(), false, 'its worker\'s poll does nothing without an owner');
    assert.deepEqual(polls, [], 'the app heard no poll from the read browser, so no queued application can go to it');
    await read.dispose();
    at('the kept browser (positive control)');
    const kept = createBackgroundBrowser(storage, deps);
    await kept.start(start);
    assert.ok(!(await workerStorage(kept)).includes('backgroundReadsOnly'), 'the kept browser is not reads-only: it fills its own queued applications');
    assert.equal(await kept.wake(), true, 'the kept browser\'s worker polls');
    assert.equal(polls.length, 1, `the app heard exactly the kept browser's poll: ${JSON.stringify(polls)}`);
    assert.ok(polls[0], 'and it carried the kept browser\'s owner');
  } finally {
    await close();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(folder, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
  }
})));
