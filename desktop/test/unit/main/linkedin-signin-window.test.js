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
  // A window Electron made for a page's popup (webContents 'did-create-window'): `popup()` opens one through the parent's handler and hands it to the window as Electron does.
  const children = [];
  const child = () => {
    const win = Object.assign(new EventEmitter(), {destroyed: false, isDestroyed: () => win.destroyed, destroy() { win.destroyed = true; win.emit('closed'); }});
    win.webContents = Object.assign(new EventEmitter(), {setWindowOpenHandler: fn => { win.openHandler = fn; }});
    children.push(win);
    return win;
  };
  const opened = [];
  return {made, opened, children, child, shell: {openExternal: url => opened.push(url)}, BrowserWindow: FakeWindow};
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
  for (const disposition of ['foreground-tab', 'background-tab', 'default', 'other']) assert.deepEqual(f.made[0].openHandler({url: 'https://www.linkedin.com/legal/user-agreement', disposition}), {action: 'deny'}, disposition);
  assert.deepEqual(f.opened, Array(4).fill('https://www.linkedin.com/legal/user-agreement'), 'a plain link (a tab, not a popup) goes to the person\'s browser');
  const event = {prevented: false, preventDefault() { this.prevented = true; }};
  f.made[0].webContents.emit('will-navigate', event, 'https://accounts.example.org/oauth');
  assert.deepEqual([event.prevented, f.opened.length], [true, 5], 'a non-LinkedIn page does not load here');
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
  for (const reason of ['cancelled', 'timeout', 'load-failed', 'no-keychain', 'not-kept', 'popup-ended', 'something-new', undefined]) {
    const [title, body, , tone] = signInEnded({ok: false, reason});
    assert.ok(title && body, `${reason}: has words`);
    assert.match(tone, /^(info|warn)$/);
    if (reason !== 'popup-ended') assert.doesNotMatch(`${title} ${body}`, /Chrome extension|needed/, `${reason}: no extension blame`);   // popup-ended names Chrome on purpose: it is the way out
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

// Gitar on #3080: with no secret store the window must not open at all (the person would type a password for nothing). 14 Nov 2026: Windows keeps it in its Credential Manager.
test('without a secret store (Linux, not an isolated run) the window never opens, and the press says why', async () => {
  let opened = 0;
  const {handlers, lines} = app({platform: 'linux', signIn: async () => { opened++; return {ok: true, cookies: [li()]}; }});
  assert.deepEqual(await handlers.get('linkedinJobsSignIn')(), {ok: false, reason: 'no-keychain'});
  assert.equal(opened, 0);
  assert.deepEqual(lines, [['linkedin-jobs', 'press', {path: 'window', outcome: 'no-keychain'}]]);
  assert.equal((await handlers.get('linkedinJobsState')()).on, false);
  assert.equal(signInEnded({ok: false, reason: 'no-keychain'})[0], 'LinkedIn jobs is not available here yet');
});

// Owner, 5 Nov 2026: "When I try to enable LInkedin jobs. And I click login with Google, it doesn't really work" (Chrome showed a blank accounts.google.com/gsi/select page); decision "Allow popup, you try once".
// A provider's popup (Electron disposition 'new-window') needs window.opener, so it opens as a child window of this one instead of in Chrome. It is told from a link by how it opens, never by a host.
const POPUP = {url: 'https://sso.standin.example/choose', disposition: 'new-window', frameName: 'sso', features: 'width=480,height=640'};
test('a page\'s popup opens as a child window, hardened like the parent; a link still goes to the browser', async () => {
  const f = fakes(), pending = createSignIn(f)();
  const win = f.made[0], answer = win.openHandler(POPUP);
  assert.equal(answer.action, 'allow');
  const prefs = answer.overrideBrowserWindowOptions.webPreferences;
  assert.deepEqual([prefs.partition, prefs.sandbox, prefs.contextIsolation, prefs.nodeIntegration, prefs.preload, prefs.webviewTag], [PARTITION, true, true, false, undefined, false], 'same private partition, sandboxed, no node, no preload');
  assert.equal(answer.overrideBrowserWindowOptions.parent, win, 'a child of the sign-in window');
  assert.equal(win.options.webPreferences.partition, prefs.partition);
  assert.deepEqual(f.opened, [], 'nothing went to the browser');
  assert.deepEqual(win.openHandler({url: 'http://insecure.example/', disposition: 'new-window'}), {action: 'deny'}, 'a popup is https only');
  win.emit('closed'); await pending;
});

test('the popup is held to the same rules: its own links go to the browser, a popup of a popup is a child, three at once is the limit; no host is named', async () => {
  const f = fakes(), pending = createSignIn(f)();
  const win = f.made[0], one = f.child();
  win.webContents.emit('did-create-window', one, POPUP);
  assert.deepEqual(one.openHandler({url: 'https://help.standin.example/', disposition: 'foreground-tab'}), {action: 'deny'});
  assert.deepEqual(f.opened, ['https://help.standin.example/']);
  assert.equal(one.openHandler(POPUP).action, 'allow', 'a popup of the popup follows the same rule');
  const two = f.child(), three = f.child();
  one.webContents.emit('did-create-window', two, POPUP); win.webContents.emit('did-create-window', three, POPUP);
  assert.deepEqual(win.openHandler(POPUP), {action: 'deny'}, 'a fourth popup while three are open is refused');
  two.destroy();
  assert.equal(win.openHandler(POPUP).action, 'allow', 'one closed, room again');
  win.emit('closed'); await pending;
  assert.deepEqual(f.children.map(c => c.destroyed), [true, true, true], 'every child ends with the sign-in');
});

test('closing the popup alone does not end the sign-in; signing in closes the popup and clears the storage once', async () => {
  const f = fakes(), pending = createSignIn(f)();
  const win = f.made[0], one = f.child();
  win.openHandler(POPUP); win.webContents.emit('did-create-window', one, POPUP);
  one.destroy();   // the provider page closes itself after answering
  assert.equal(win.destroyed, false);
  const again = f.child(); win.webContents.emit('did-create-window', again, POPUP);
  await win.go('https://www.linkedin.com/feed/', [li()]);
  assert.equal((await pending).ok, true, 'a sign-in that came through a popup is the same verdict');
  assert.deepEqual([again.destroyed, win.destroyed, win.cleared], [true, true, 1]);
});

test('a popup opened and the window ended without a sign-in: its own reason, so the words can point to Chrome; with no popup the reasons stay', async () => {
  const f = fakes(), signIn = createSignIn(f), closed = signIn();
  f.made[0].openHandler(POPUP); f.made[0].webContents.emit('did-create-window', f.child(), POPUP);
  f.made[0].emit('closed');
  assert.deepEqual(await closed, {ok: false, reason: 'popup-ended'});
  const quiet = signIn();
  f.made[1].emit('closed');
  assert.deepEqual(await quiet, {ok: false, reason: 'cancelled'}, 'a new attempt starts clean');
  const slow = createSignIn({...f, timeoutMs: 20})();
  f.made[2].openHandler(POPUP);
  assert.deepEqual(await slow, {ok: false, reason: 'popup-ended'}, 'the timeout after a popup reads the same');
});

test('a popup that did come through is still a sign-in: the refusal reason is only for a window that ended without one', async () => {
  const f = fakes(), pending = createSignIn(f)();
  f.made[0].openHandler(POPUP);
  await f.made[0].go('https://www.linkedin.com/feed/', [li()]);
  assert.equal((await pending).ok, true);
});

test('the handler logs the popup outcome without a value, and the words for it point to Chrome', async () => {
  const {handlers, lines} = app({signIn: async () => ({ok: false, reason: 'popup-ended'})});
  assert.deepEqual(await handlers.get('linkedinJobsSignIn')(), {ok: false, reason: 'popup-ended', error: undefined});
  assert.deepEqual(lines, [['linkedin-jobs', 'press', {path: 'window', outcome: 'popup-ended'}]]);
  const connected = signInEnded({ok: false, reason: 'popup-ended'}, {extension: true}), notYet = signInEnded({ok: false, reason: 'popup-ended'}, {extension: false});
  assert.match(connected[1], /Google or Apple/); assert.match(connected[1], /Use my Chrome sign-in/);
  assert.match(notYet[1], /Settings → Connections → Chrome extension/);
  assert.doesNotMatch(connected[1], /Settings → Connections → Chrome extension/, 'the shortcut is named only when it is there');
});

// Independent review (5 Nov 2026): the refusal words blame a provider only for a provider's popup; a popup runs on https pages only.
test('a LinkedIn popup (a help page) is not a provider: closing the window after it is a plain cancel', async () => {
  const f = fakes(), pending = createSignIn(f)();
  f.made[0].openHandler({url: 'https://www.linkedin.com/help/linkedin', disposition: 'new-window'});
  f.made[0].emit('closed');
  assert.deepEqual(await pending, {ok: false, reason: 'cancelled'});
});

test('a popup never navigates to another scheme, and one made after the sign-in ended is closed at once', async () => {
  const f = fakes(), pending = createSignIn(f)();
  const one = f.child(); f.made[0].webContents.emit('did-create-window', one, POPUP);
  const http = {prevented: false, preventDefault() { this.prevented = true; }}, https = {prevented: false, preventDefault() { this.prevented = true; }};
  one.webContents.emit('will-navigate', http, 'http://insecure.example/'); one.webContents.emit('will-redirect', https, 'https://accounts.standin.example/next');
  assert.deepEqual([http.prevented, https.prevented], [true, false]);
  f.made[0].emit('closed'); await pending;
  const late = f.child(); f.made[0].webContents.emit('did-create-window', late, POPUP);
  assert.equal(late.destroyed, true);
});

// Owner, 14 Nov 2026: "Let's store them in Keychain/Credentials Manager (windows)... If once logged in with Linkedin for Linkedin jobs, it should remember and use that session/credentials for Easy Apply".
test('on Windows the sign-in window opens and the session is kept in the computer\'s store, where Easy Apply reads it', async () => {
  const {handlers, lines, keychain} = app({platform: 'win32', signIn: async () => ({ok: true, cookies: [li()]})});
  assert.deepEqual(await handlers.get('linkedinJobsSignIn')(), {ok: true});
  assert.deepEqual(lines, [['linkedin-jobs', 'press', {path: 'window', outcome: 'signed-in'}]]);
  assert.equal(readSession({keychain}).li_at, SECRET);   // the one read LinkedIn jobs and Easy Apply share (lib/easy-apply-batch.js turn)
});
