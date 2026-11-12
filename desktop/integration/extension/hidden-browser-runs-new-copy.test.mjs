// Integration test: after an update, the app's hidden browser runs the extension the app just copied, not the one its kept profile first registered.
// Guard: safety — without it the hidden browser can run an old extension (old Submit and hand-off rules included) for weeks after an update, and every extension fix misses it.
// Why (8 Nov 2026, owner: "we fixed this type of bugs tens of times. Why it's still there?" · "how we can prevent this ?"): the live-test twin's hidden browser still ran its
// 28 Oct worker on 8 Nov (it set the flag's pre-2-Nov name; its files on disk set the new one), so its 11 Jobs-check reads were handed out and never started. Chrome keeps
// the service worker a kept profile first registered when the extension folder is rewritten in place (measured: starts 2 and 3 ran start 1's code; a new manifest
// version did not help). Every other test starts on a fresh profile, so none could see it. Real: the app's own start (lib/background-browser.js createBackgroundBrowser:
// copy, launch, worker, storage) on a real headless Chromium, twice on one profile. Stood in: the app's port (nothing listens; the worker only has to load).
// Nothing here reaches the owner's app, profile or a real site.
// Also (10 Nov 2026, /code-review of the read wake): wake() reaches the real worker's poll, so a queued Jobs-check read is taken at once, not at the 30 s tab report.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import http from 'node:http';
import {test} from 'node:test';
import {chromium} from '../../e2e/lib/visit-page.mjs';
import {endBrowser} from '../../e2e/lib/browser-end.mjs';
import {CLOSE_MS, at, clocked, onHang} from '../../e2e/lib/test-clock.mjs';
import {evaluate} from '../../e2e/lib/cdp-evaluate.mjs';
import {createBackgroundBrowser} from '../../lib/background-browser.js';
import {POST_CORS, jsonBody, jsonHeaders, jsonPayload, preflight} from '../../lib/server-http.js';

const TEST_MS = 90000;   // a hang guard: each start takes ~1-3 s
const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXTENSION = path.resolve(DESKTOP, '..', 'extension');

async function json(url) { return (await fetch(url)).json(); }
/** One app home with a kept hidden-browser profile; `release` ships an edition of the real extension, `app()` is one app process's start, `edition()` what its worker runs. */
function home() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-hidden-new-copy-'));
  const root = path.join(folder, 'root'), source = path.join(root, 'extension');
  fs.mkdirSync(root);
  fs.symlinkSync(DESKTOP, path.join(root, 'desktop'), 'junction');   // the app imports its copy and storage helpers from <root>/desktop/ready-fill
  const storage = {path: name => path.join(folder, 'home', name)};
  const profile = storage.path(path.join('background-browser', 'profile'));
  const children = [];
  const close = () => endBrowser({profile, launched: true});
  return {
    release(edition) {   // the extension as one app build ships it: the real extension, marked with its edition at the top of its worker
      fs.rmSync(source, {recursive: true, force: true});
      fs.cpSync(EXTENSION, source, {recursive: true});
      const worker = path.join(source, 'background.js');
      fs.writeFileSync(worker, `globalThis.__testEdition = '${edition}';\n${fs.readFileSync(worker, 'utf8')}`);
    },
    // A CI runner may not allow the sandbox for a plain spawn: the app's own e2e allowance passes it (lib/background-browser.js e2eArguments), nothing else.
    app: () => createBackgroundBrowser(storage, {root, find: () => chromium.executablePath(), reaper: () => {},
      spawn: (file, args, options) => { const child = spawn(file, args, {...options, env: {...process.env, ...E2E_ENV}}); children.push(child); return child; }}),
    async edition() {
      const port = Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]);
      const worker = (await json(`http://127.0.0.1:${port}/json/list`)).find(target => target.type === 'service_worker' && target.url.endsWith('/background-owned.js'));
      return evaluate(worker.webSocketDebuggerUrl, 'globalThis.__testEdition');
    },
    close,
    async end() {
      await close();
      for (const child of children) if (child.exitCode === null) child.kill();
      fs.rmSync(folder, {recursive: true, force: true});
    },
  };
}
const E2E_ENV = {JOBADABRA_E2E: '1', JOBADABRA_E2E_BACKGROUND_BROWSER_ARGS: JSON.stringify(['--no-sandbox'])};
/** Runs `body` with the app's e2e launch allowance set (browserArguments reads process.env), restoring the variables after. */
async function withE2eEnv(body) {
  const kept = Object.fromEntries(Object.keys(E2E_ENV).map(key => [key, process.env[key]]));
  Object.assign(process.env, E2E_ENV);
  try { return await body(); } finally { for (const [key, value] of Object.entries(kept)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
}
const START = {port: 51999, token: 'stand-in-token'};   // nothing listens there: the worker only has to load

test('after an update the hidden browser runs the new extension, on the profile it kept', {timeout: TEST_MS + CLOSE_MS + 5000}, clocked(TEST_MS, () => withE2eEnv(async () => {
  const each = home();
  onHang(each.close);
  try {
    at('the first start, on a fresh profile');
    each.release('first');
    await each.app().start(START);
    assert.equal(await each.edition(), 'first', 'positive control: a fresh profile runs the copy it was given');
    await each.close();
    at('the start after an update, on the profile it kept');
    each.release('second');
    await each.app().start(START);
    assert.equal(await each.edition(), 'second', 'the hidden browser still runs the extension its profile first registered: every update since misses it');
  } finally { await each.end(); }
})));

// The reaper normally ends the hidden browser with its app; when it did not, the updated app connects to the old browser, whose worker runs the old copy.
test('an updated app that finds an older app\'s hidden browser still running closes it and runs the new extension', {timeout: TEST_MS + CLOSE_MS + 5000}, clocked(TEST_MS, () => withE2eEnv(async () => {
  const each = home();
  onHang(each.close);
  try {
    at('the older app\'s start, left running');
    each.release('first');
    await each.app().start(START);
    assert.equal(await each.edition(), 'first', 'positive control');
    at('the updated app\'s start, beside the running browser');
    each.release('second');
    await each.app().start(START);
    assert.equal(await each.edition(), 'second', 'the updated app handed its token to the older app\'s worker');
  } finally { await each.end(); }
})));

test('wake() makes the real extension poll the app at once, and the app\'s answer reaches it', {timeout: TEST_MS + CLOSE_MS + 5000}, clocked(TEST_MS, () => withE2eEnv(async () => {
  const each = home(), polls = [], seen = [];
  // A stand-in for the app's own server, on a free loopback port, answering with the app's own preflight and headers (lib/server-http.js): it records the extension's polls and acknowledges them with nothing to do.
  const server = http.createServer((request, response) => {
    if (preflight(request, response, POST_CORS)) return;
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      const action = String(jsonPayload(body).action || '');   // the app's own parse: a malformed body is {}
      seen.push(`${request.method} ${request.url.split('?')[0]} ${action}`);
      if (request.url.startsWith('/extension/background-apply') && action === 'poll') polls.push(action);
      jsonHeaders(response, 200, POST_CORS); jsonBody(response, {ok: true, jobs: []});
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  onHang(each.close);
  try {
    each.release('wake');
    const app = each.app();
    await app.start({port: server.address().port, token: 'stand-in-token'});
    const before = polls.length;
    assert.equal(await app.wake(), true, `the worker ran its poll and the app acknowledged it (the app saw: ${seen.join(' | ') || 'nothing'})`);
    assert.ok(polls.length > before, `the wake reached the app as a poll (${before} before, ${polls.length} after)`);
  } finally { await each.end(); await new Promise(resolve => server.close(resolve)); }
})));
