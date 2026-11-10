// Owned hidden-browser startup contracts: no profile cloning, visible startup page, global process kill, or silent download.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {HIDDEN_WINDOW, browserArguments, createBackgroundBrowser, holdStartsUntil, verifiedDebugPort} from '../../../lib/background-browser.js';

test('background browser launch uses only its owned profile and starts without a visible page', () => {
  const args = browserArguments('/owned/profile', '/owned/extension');
  assert.ok(args.includes('--no-startup-window'));
  assert.ok(args.includes('--user-data-dir=/owned/profile'));
  assert.ok(args.includes('--load-extension=/owned/extension'));
  assert.ok(args.includes('--remote-debugging-port=0'));
  // Why (2026-10-28, owner): the person sees a held page in the app's live view, never a revealed window; headless keeps it off the screen, the Dock and focus.
  assert.ok(args.includes('--headless=new'));
  assert.equal(args.some(arg => /^https?:/.test(arg)), false);
  // Why (5 Nov 2026, owner: "It shows the mobile viewport" · "very slow"): every page at desktop size and none put to sleep; Playwright's Chromium on CI cannot show the
  // sleeping page (only Chrome for Testing 156 did), so the flag itself is held here.
  assert.ok(args.includes(`--window-size=${HIDDEN_WINDOW.width},${HIDDEN_WINDOW.height}`) && HIDDEN_WINDOW.width >= 1280);
  assert.ok(args.includes('--disable-backgrounding-occluded-windows'));
});

test('the e2e harness may point the hidden browser at the test forms, nobody else: only under the e2e flag, only a host map, the test certificate and no-sandbox', () => {
  const extra = JSON.stringify(['--host-resolver-rules=MAP boards.greenhouse.io 127.0.0.1:5', '--ignore-certificate-errors', '--no-sandbox', '--proxy-server=http://evil.example', '--remote-debugging-address=0.0.0.0']);
  const asked = {JOBADABRA_E2E_BACKGROUND_BROWSER_ARGS: extra};
  assert.deepEqual(browserArguments('/p', '/e', asked), browserArguments('/p', '/e', {}), 'a person\'s environment never changes the launch, even with the variable set');
  const args = browserArguments('/p', '/e', {...asked, JOBADABRA_E2E: '1'});
  assert.ok(args.includes('--host-resolver-rules=MAP boards.greenhouse.io 127.0.0.1:5'));
  assert.ok(args.includes('--ignore-certificate-errors'));
  assert.ok(args.includes('--no-sandbox'), 'under e2e only: a CI runner may not allow the sandbox');
  assert.equal(browserArguments('/p', '/e', {}).includes('--no-sandbox'), false, 'a person\'s browser keeps its sandbox');
  assert.equal(args.some(arg => /proxy-server|remote-debugging-address/.test(arg)), false, 'nothing else is let through');
  assert.deepEqual(browserArguments('/p', '/e', {JOBADABRA_E2E: '1', JOBADABRA_E2E_BACKGROUND_BROWSER_ARGS: 'not json'}), browserArguments('/p', '/e', {}));
});

test('a cached CDP port is accepted only after the browser proves the exact owned profile', () => {
  assert.equal(verifiedDebugPort('12345\n/devtools/browser/a', ['--user-data-dir=/owned/profile'], '/owned/profile'), 12345);
  assert.equal(verifiedDebugPort('12345\n/devtools/browser/a', ['--user-data-dir=/someone/else'], '/owned/profile'), null);
  assert.equal(verifiedDebugPort('0\n/path', ['--user-data-dir=/owned/profile'], '/owned/profile'), null);
});

test('send runs one CDP command on the verified browser, targetSocket finds one page by id (LinkedIn jobs 2/3: cookies, new tab, its own address)', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-bb-')), profile = path.join(folder, 'background-browser', 'profile');
  fs.mkdirSync(profile, {recursive: true});
  fs.writeFileSync(path.join(profile, 'DevToolsActivePort'), '4242\n/devtools/browser/x');
  const calls = [];
  const storage = {path: name => path.join(folder, name)};
  const answers = {'/json/version': {webSocketDebuggerUrl: 'ws://127.0.0.1:4242/devtools/browser/x'},
    '/json/list': [{id: 'A', type: 'page', webSocketDebuggerUrl: 'ws://127.0.0.1:4242/devtools/page/A'}, {id: 'W', type: 'service_worker', webSocketDebuggerUrl: 'ws://127.0.0.1:4242/devtools/page/W'}]};
  const fetchImpl = async url => ({ok: true, json: async () => answers[new URL(url).pathname]});
  const command = async (socket, method, params) => {
    calls.push([socket, method, params]);
    return method === 'Browser.getBrowserCommandLine' ? {arguments: [`--user-data-dir=${profile}`]} : {targetId: 'A'};
  };
  const browser = createBackgroundBrowser(storage, {find: () => '/x', fetchImpl, command});
  assert.deepEqual(await browser.send('Target.createTarget', {url: 'about:blank'}), {targetId: 'A'});
  assert.deepEqual(calls.at(-1), ['ws://127.0.0.1:4242/devtools/browser/x', 'Target.createTarget', {url: 'about:blank'}]);
  assert.equal(await browser.targetSocket('A'), 'ws://127.0.0.1:4242/devtools/page/A');
  assert.equal(await browser.targetSocket('W'), null, 'only a page target is a tab');
  assert.equal(await browser.targetSocket('nope'), null);
  const other = createBackgroundBrowser(storage, {find: () => '/x', fetchImpl, command: async (socket, method) => ({arguments: ['--user-data-dir=/someone/else']})});
  await assert.rejects(other.send('Target.createTarget', {}), /another profile/, 'a browser that is not ours is never sent anything');
});

test('the owned browser is never disguised: no user-agent, fingerprint, stealth or automation-hiding flag, with or without the e2e map (LinkedIn jobs 2/3, owner: "never disguise a browser as a person")', () => {
  const disguise = /user-agent|useragent|stealth|fingerprint|disable-blink-features|AutomationControlled|webdriver|excludeSwitches|lang=|accept-lang|platform/i;
  for (const env of [{}, {JOBADABRA_E2E: '1', JOBADABRA_E2E_BACKGROUND_BROWSER_ARGS: JSON.stringify(['--user-agent=Mozilla/5.0', '--disable-blink-features=AutomationControlled', '--host-resolver-rules=MAP a 127.0.0.1:1'])}]) {
    assert.equal(browserArguments('/p', '/e', env).filter(arg => disguise.test(arg)).length, 0, JSON.stringify(browserArguments('/p', '/e', env).filter(arg => disguise.test(arg))));
  }
  assert.ok(browserArguments('/p', '/e').includes('--enable-automation'), 'it says what it is');
});

test('after a restart no hidden browser runs: pageSocket says "no such page" (null), and only a browser that does not answer in time stays "cannot tell" (a throw) ([ap] 7/7 review)', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-bb-')), profile = path.join(folder, 'background-browser', 'profile');
  const storage = {path: name => path.join(folder, name)};
  const command = async () => ({arguments: [`--user-data-dir=${profile}`]});
  const refused = async () => { throw Object.assign(new TypeError('fetch failed'), {cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:4242'), {code: 'ECONNREFUSED'})}); };
  const slow = async () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); };
  assert.equal(await createBackgroundBrowser(storage, {find: () => '/x', fetchImpl: refused, command}).pageSocket('s1'), null, 'no port file: the browser never ran in this profile');
  fs.mkdirSync(profile, {recursive: true});
  fs.writeFileSync(path.join(profile, 'DevToolsActivePort'), '4242\n/devtools/browser/x');
  assert.equal(await createBackgroundBrowser(storage, {find: () => '/x', fetchImpl: refused, command}).pageSocket('s1'), null, 'a port file left by a browser that died with the app');
  await assert.rejects(createBackgroundBrowser(storage, {find: () => '/x', fetchImpl: slow, command}).pageSocket('s1'), /timeout/, 'a busy browser is not a closed page');
});

test('wake gives the worker\'s poll time to open every claimed job\'s window; reveal and close keep the short limit (hw review, 10 Nov 2026: a 10-job poll can pass 5 s, and a wake that worked would be logged as failed)', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-bb-')), profile = path.join(folder, 'background-browser', 'profile');
  fs.mkdirSync(profile, {recursive: true});
  fs.writeFileSync(path.join(profile, 'DevToolsActivePort'), '4242\n/devtools/browser/x');
  const answers = {'/json/version': {webSocketDebuggerUrl: 'ws://127.0.0.1:4242/devtools/browser/x'},
    '/json/list': [{id: 'W', type: 'service_worker', url: 'chrome-extension://id/background-owned.js', webSocketDebuggerUrl: 'ws://127.0.0.1:4242/devtools/page/W'}]};
  const fetchImpl = async url => ({ok: true, json: async () => answers[new URL(url).pathname]});
  const limits = {};
  const command = async (socket, method, params, options = {}) => {
    if (method === 'Browser.getBrowserCommandLine') return {arguments: [`--user-data-dir=${profile}`]};
    limits[params.expression.match(/\?\.(\w+)\(/)[1]] = options.timeout;
    return {result: {value: true}};
  };
  const browser = createBackgroundBrowser({path: name => path.join(folder, name)}, {find: () => '/x', fetchImpl, command});
  assert.equal(await browser.wake(), true);
  await browser.reveal('s1'); await browser.closeSession('s1');
  assert.ok(limits.poll >= 30000, `the poll may open up to 10 windows before it answers (limit ${limits.poll})`);
  assert.equal(limits.reveal, undefined, 'reveal keeps the default limit');
  assert.equal(limits.closeSession, undefined, 'close keeps the default limit');
});

// #3717 Gitar review (10 Nov 2026): the start-up sweep of LinkedIn leftovers deletes Cookies rows; a hidden browser started during it would hold that file.
test('no hidden browser starts before the start-up hold is released; the same start goes on after it (positive control)', async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-bb-hold-'));
  t.after(() => { holdStartsUntil(Promise.resolve()); fs.rmSync(home, {recursive: true, force: true}); });
  let release, asked = 0;
  holdStartsUntil(new Promise(resolve => { release = resolve; }));
  const storage = {path: name => path.join(home, name)};
  const browser = createBackgroundBrowser(storage, {find: () => { asked += 1; return null; }, fetchImpl: async () => { throw new Error('no browser in a unit test'); },
    reaper: () => {}, spawn: () => { throw new Error('no spawn in a unit test'); }});
  const started = browser.start({port: 47999, token: 'stand-in'});
  for (let turn = 0; turn < 20; turn++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(asked, 0, 'nothing of the start ran while the hold is on');
  assert.equal(fs.existsSync(storage.path('background-browser')), false, 'not even its folder');
  release();
  await assert.rejects(started, /Download the optional background browser first/);
  assert.equal(asked, 1, 'once released, the same start runs');
});
