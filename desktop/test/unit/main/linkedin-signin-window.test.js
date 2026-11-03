// The "Turn on LinkedIn" sign-in window (lib/linkedin-signin-window.js), played with a fake window and a fake cookie jar: nothing here opens a real window, reaches LinkedIn, or touches the owner's
// session or Keychain (a stand-in host and fake values). Owner, 3 Nov 2026: the person types their password on LinkedIn's own page; the app only receives the session cookies, once they are in.
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import test from 'node:test';
import {PARTITION, START_URL, createSignIn, signedIn} from '../../../lib/linkedin-signin-window.js';
import {registerLinkedinHandlers} from '../../../lib/linkedin-handlers.js';
import {SERVICE, readSession} from '../../../lib/linkedin-session.js';
import {signInEnded} from '../../../renderer/linkedin-words.js';

const SECRET = 'AQEDAR-fake-li-at-window';
const li = (value = SECRET) => ({name: 'li_at', value, domain: '.www.linkedin.com'});

// A window the test drives: `go(url, cookies)` is the person moving to a page with LinkedIn's cookies set.
function fakes({load} = {}) {
  const made = [];
  class FakeWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options; this.destroyed = false; this.shown = 0; this.url = '';
      this.cookies = []; this.cleared = 0;
      this.webContents = Object.assign(new EventEmitter(), {
        getURL: () => this.url, setWindowOpenHandler: fn => { this.openHandler = fn; },
        session: {cookies: {get: async filter => { this.askedFor = filter; await this.hold; return this.cookies; }}, clearStorageData: async () => { this.cleared++; await this.clearing; }, setPermissionRequestHandler: fn => { this.permissions = fn; }},
      });
      made.push(this);
    }
    loadURL(url) { this.loaded = url; return load ? load(this) : Promise.resolve(); }
    show() { this.shown++; } focus() {} isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this.emit('closed'); }
    async go(url, cookies = this.cookies) { this.url = url; this.cookies = cookies; this.webContents.emit('did-navigate'); await new Promise(done => setImmediate(done)); }
  }
  const opened = [];
  return {made, opened, shell: {openExternal: url => opened.push(url)}, BrowserWindow: FakeWindow};
}

test('the verdict: li_at AND a page past the sign-in pages; li_at on /login or /checkpoint is not signed in', () => {
  assert.equal(signedIn({url: 'https://www.linkedin.com/feed/', cookies: [li()]}), true);
  for (const page of ['/login', '/uas/login-submit', '/checkpoint/challenge/x', '/check/add-phone', '/authwall', '/signup']) assert.equal(signedIn({url: `https://www.linkedin.com${page}`, cookies: [li()]}), false, page);
  assert.equal(signedIn({url: 'https://www.linkedin.com/feed/', cookies: []}), false, 'no li_at yet');
  assert.equal(signedIn({url: 'https://www.linkedin.com/feed/', cookies: [{name: 'li_at', value: '', domain: '.linkedin.com'}]}), false, 'an empty li_at');
  assert.equal(signedIn({url: 'https://evil.example/feed/', cookies: [li()]}), false, 'not a LinkedIn page');
  assert.equal(signedIn({url: 'http://www.linkedin.com/feed/', cookies: [li()]}), false, 'not https');
  assert.equal(signedIn({url: 'not a url', cookies: [li()]}), false);
});

test('signing in: the window opens LinkedIn\'s own page in a private in-memory partition; the cookies come back when the page leaves sign-in; the window ends and its storage is cleared', async () => {
  const f = fakes(), signIn = createSignIn(f);
  const pending = signIn();
  const win = f.made[0];
  assert.equal(win.loaded, START_URL);
  assert.deepEqual([win.options.webPreferences.partition, win.options.webPreferences.sandbox, win.options.webPreferences.contextIsolation, win.options.webPreferences.nodeIntegration, win.options.webPreferences.preload], [PARTITION, true, true, false, undefined], 'sandboxed, no node, no preload');
  assert.ok(!PARTITION.startsWith('persist:'), 'in memory only');
  await win.go('https://www.linkedin.com/login', []);
  await win.go('https://www.linkedin.com/checkpoint/challenge/abc', [li()]);   // the person is still on a check: nothing is taken
  assert.equal(win.destroyed, false);
  await win.go('https://www.linkedin.com/feed/', [li(), {name: 'JSESSIONID', value: '"ajax:123"', domain: '.www.linkedin.com'}]);
  const answer = await pending;
  assert.equal(answer.ok, true);
  assert.deepEqual(answer.cookies.map(c => c.name), ['li_at', 'JSESSIONID']);
  assert.deepEqual(win.askedFor, {domain: 'linkedin.com'}, 'only LinkedIn\'s cookies are read');
  assert.deepEqual([win.destroyed, win.cleared], [true, 1], 'closed and cleared');
});

test('closing the window is a cancel; the timeout is a cancel; neither keeps anything', async () => {
  const f = fakes(), signIn = createSignIn(f);
  const closed = signIn();
  f.made[0].emit('closed');
  assert.deepEqual(await closed, {ok: false, reason: 'cancelled'});
  assert.equal(f.made[0].cleared, 1);
  const slow = createSignIn({...f, timeoutMs: 20})();
  assert.deepEqual(await slow, {ok: false, reason: 'timeout'});
  assert.deepEqual([f.made[1].destroyed, f.made[1].cleared], [true, 1]);
});

test('a page that cannot load ends it; a redirect abort does not', async () => {
  const f = fakes({load: () => Promise.reject(Object.assign(new Error('net'), {code: 'ERR_INTERNET_DISCONNECTED'}))});
  assert.deepEqual(await createSignIn(f)(), {ok: false, reason: 'load-failed'});
  const g = fakes({load: () => Promise.reject(Object.assign(new Error('aborted'), {code: 'ERR_ABORTED'}))});
  const pending = createSignIn(g)();
  await new Promise(done => setImmediate(done));
  assert.equal(g.made[0].destroyed, false, 'ERR_ABORTED is a redirect, not a failure');
  g.made[0].emit('closed');
  await pending;
});

test('a second press brings the same window forward and shares its answer; other sites open in the browser, never in this window', async () => {
  const f = fakes(), signIn = createSignIn(f);
  const first = signIn(), second = signIn();
  assert.equal(f.made.length, 1, 'one window');
  assert.equal(f.made[0].shown, 1, 'the second press showed it');
  assert.deepEqual(f.made[0].openHandler({url: 'https://www.linkedin.com/legal/user-agreement'}), {action: 'deny'});
  assert.deepEqual(f.opened, ['https://www.linkedin.com/legal/user-agreement'], 'a new-window link goes to the person\'s browser');
  const event = {prevented: false, preventDefault() { this.prevented = true; }};
  f.made[0].webContents.emit('will-navigate', event, 'https://accounts.example.org/oauth');
  assert.deepEqual([event.prevented, f.opened.length], [true, 2], 'a non-LinkedIn page does not load here');
  const inside = {prevented: false, preventDefault() { this.prevented = true; }};
  f.made[0].webContents.emit('will-navigate', inside, 'https://www.linkedin.com/uas/login');
  assert.equal(inside.prevented, false);
  await f.made[0].go('https://www.linkedin.com/feed/', [li()]);
  assert.equal((await first).ok, true);
  assert.equal(await second === await first, true, 'same answer');
});

// The IPC, as the app wires it: the window's cookies go to the Keychain and turn the switch on; every press leaves one line; no line carries a value.
function app({signIn, seen = null, platform = 'darwin'}) {
  const handlers = new Map(), lines = [], mine = {};
  const items = new Map();
  const keychain = {write: (service, value) => { items.set(service, value); return true; }, read: service => items.get(service) || null, remove: service => items.delete(service)};
  const storage = {settings: () => mine, saveSettings: patch => Object.assign(mine, patch)};
  registerLinkedinHandlers({DEMO: false, ipcMain: {handle: (name, fn) => handlers.set(name, fn)}, server: {setVisitRoute() {}, extensionSeen: () => seen}, storage, signIn,
    openPage: async () => ({opened: true}), deps: {keychain, platform, isolated: false}, log: (...line) => lines.push(line)});
  return {handlers, lines, items, keychain};
}

test('the handler: a sign-in keeps the session in the Keychain, turns the switch on, logs the press without a value', async () => {
  const {handlers, lines, items, keychain} = app({signIn: async () => ({ok: true, cookies: [li(), {name: 'bcookie', value: 'track', domain: '.linkedin.com'}]})});
  assert.deepEqual(await handlers.get('linkedinJobsSignIn')(), {ok: true});
  assert.equal((await handlers.get('linkedinJobsState')()).on, true);
  assert.equal(readSession({keychain}).li_at, SECRET);
  assert.equal(items.get(SERVICE).includes('track'), false, 'only the allow-listed cookies are kept');
  assert.deepEqual(lines, [['linkedin-jobs', 'press', {path: 'window', outcome: 'signed-in'}]]);
  assert.equal(JSON.stringify(lines).includes(SECRET), false);
});

test('the handler: a closed window or a Keychain that refuses leaves the switch off, with its reason and one log line each', async () => {
  const closed = app({signIn: async () => ({ok: false, reason: 'cancelled'})});
  assert.deepEqual(await closed.handlers.get('linkedinJobsSignIn')(), {ok: false, reason: 'cancelled', error: undefined});
  assert.equal((await closed.handlers.get('linkedinJobsState')()).on, false);
  assert.deepEqual(closed.lines, [['linkedin-jobs', 'press', {path: 'window', outcome: 'cancelled'}]]);
  const refused = app({signIn: async () => ({ok: true, cookies: [li()]})});
  refused.keychain.write = () => false;
  const answer = await refused.handlers.get('linkedinJobsSignIn')();
  assert.deepEqual([answer.ok, answer.reason, /Keychain/.test(answer.error)], [false, 'not-kept', true]);
  assert.equal((await refused.handlers.get('linkedinJobsState')()).on, false);
  assert.equal(refused.lines[0][2].outcome, 'not-kept');
});

test('the window\'s view says whether the Chrome extension is connected (it shows the shortcut); demo touches no window', async () => {
  assert.equal((await app({signIn: async () => ({ok: false, reason: 'cancelled'}), seen: {at: 1, version: '0.9.755', id: 'x'}}).handlers.get('linkedinJobsState')()).extension, true);
  assert.equal((await app({signIn: async () => ({ok: false, reason: 'cancelled'})}).handlers.get('linkedinJobsState')()).extension, false);
  const demo = new Map();
  registerLinkedinHandlers({DEMO: true, ipcMain: {handle: (name, fn) => demo.set(name, fn)}, server: {setVisitRoute() {}}, storage: {settings: () => { throw new Error('demo must not read the store'); }}, signIn: async () => { throw new Error('demo must not open a window'); }, openPage: async () => ({opened: true})});
  assert.deepEqual(await demo.get('linkedinJobsSignIn')(), {ok: true});
  assert.equal((await demo.get('linkedinJobsState')()).extension, false);
});

test('every way the window can end has words, and none of them blames Chrome', () => {
  for (const reason of ['cancelled', 'timeout', 'load-failed', 'no-keychain', 'not-kept', 'something-new', undefined]) {
    const [title, body, , tone] = signInEnded({ok: false, reason});
    assert.ok(title && body, `${reason}: has words`);
    assert.match(tone, /^(info|warn)$/);
    assert.doesNotMatch(`${title} ${body}`, /Chrome extension|needed/, `${reason}: no extension blame`);
  }
  assert.equal(signInEnded({ok: false, reason: 'not-kept', error: 'The Keychain would not keep it.'})[1], 'The Keychain would not keep it.');
});

// Independent review (3 Nov 2026): the lifecycle and containment edges the first tests did not play.
test('two page events at once, or a close during the cookie read, never throw on a destroyed window', async () => {
  const f = fakes(), pending = createSignIn(f)();
  const win = f.made[0];
  win.url = 'https://www.linkedin.com/feed/'; win.cookies = [li()];
  let release; win.hold = new Promise(done => { release = done; });
  win.webContents.emit('did-navigate'); win.webContents.emit('did-stop-loading');   // both reads wait on the jar
  release();
  assert.equal((await pending).ok, true);
  await new Promise(done => setImmediate(done));
  const g = fakes(), second = createSignIn(g)();
  let free; g.made[0].hold = new Promise(done => { free = done; });
  g.made[0].url = 'https://www.linkedin.com/feed/'; g.made[0].cookies = [li()];
  g.made[0].webContents.emit('did-navigate');
  g.made[0].emit('closed'); g.made[0].destroyed = true;   // the person closes it mid-read
  free();
  assert.deepEqual(await second, {ok: false, reason: 'cancelled'});
  await new Promise(done => setImmediate(done));
});

test('a server redirect to another site is held outside too, and the window grants no permission', async () => {
  const f = fakes(), pending = createSignIn(f)();
  const win = f.made[0], event = {prevented: false, preventDefault() { this.prevented = true; }};
  win.webContents.emit('will-redirect', event, 'https://elsewhere.example/landing');
  assert.deepEqual([event.prevented, f.opened], [true, ['https://elsewhere.example/landing']]);
  const granted = []; win.permissions({}, 'media', answer => granted.push(answer));
  assert.deepEqual(granted, [false]);
  win.emit('closed'); await pending;
});

test('a new press during the clean-up shares the ending window instead of opening one on the partition being cleared', async () => {
  const f = fakes(), signIn = createSignIn(f), first = signIn();
  let done; f.made[0].clearing = new Promise(resolve => { done = resolve; });
  f.made[0].emit('closed');   // clean-up starts and waits
  const again = signIn();
  assert.equal(f.made.length, 1, 'no second window while the first is still clearing');
  done();
  assert.deepEqual(await again, await first);
});

// Gitar on #3080: the Keychain is macOS-only, so on Windows the window must not open at all (the person would type a password for nothing).
test('without a Keychain (not macOS, not an isolated run) the window never opens, and the press says why', async () => {
  let opened = 0;
  const {handlers, lines} = app({platform: 'win32', signIn: async () => { opened++; return {ok: true, cookies: [li()]}; }});
  assert.deepEqual(await handlers.get('linkedinJobsSignIn')(), {ok: false, reason: 'no-keychain'});
  assert.equal(opened, 0);
  assert.deepEqual(lines, [['linkedin-jobs', 'press', {path: 'window', outcome: 'no-keychain'}]]);
  assert.equal((await handlers.get('linkedinJobsState')()).on, false);
  assert.equal(signInEnded({ok: false, reason: 'no-keychain'})[0], 'LinkedIn jobs is not available here yet');
});
