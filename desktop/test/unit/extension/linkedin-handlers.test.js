// LinkedIn jobs, PR 1/3: the two routes the extension calls and the window's view (lib/linkedin-handlers.js). The consent page's POST saves the session; the minute
// poll learns that the switch went off; the view never carries a cookie value.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {linkedinRoutes, linkedinView, registerLinkedinHandlers} from '../../../lib/linkedin-handlers.js';
import {SERVICE, WANTED_MS, openSignin, readSession, turnOff, turnOn} from '../../../lib/linkedin-session.js';
import {createRefresh} from '../../../lib/linkedin-refresh.js';

const SECRET = 'AQEDAR-fake-li-at-value';
function store(settings = {}) { const mine = {...settings}; return {settings: () => mine, saveSettings: patch => Object.assign(mine, patch)}; }
function keychain() { const items = new Map(); return {items, write: (service, value) => { items.set(service, value); return true; }, read: service => items.get(service) || null, remove: service => items.delete(service)}; }

test('the consent page\'s POST saves the session, the poll then says keep; off says revoke', () => {
  const settings = store(), kc = keychain(), routes = linkedinRoutes(settings, {keychain: kc});
  assert.deepEqual(routes.pending(), {revoke: true, refresh: false}, 'off: the extension gives its LinkedIn permissions back');
  openSignin(settings);   // the person picked the Chrome way
  assert.deepEqual(routes.session({cookies: [{name: 'li_at', value: SECRET, domain: '.linkedin.com'}]}), {ok: true});
  assert.deepEqual(routes.pending(), {revoke: false, refresh: false});
  assert.ok(kc.items.has(SERVICE));
});

test('a POST with nothing usable is refused and the switch stays off', () => {
  const settings = store(), routes = linkedinRoutes(settings, {keychain: keychain()});
  assert.equal(routes.session({}).ok, false);
  assert.equal(routes.session({cookies: [{name: 'bcookie', value: 'x', domain: '.linkedin.com'}]}).ok, false);
  assert.deepEqual(routes.pending(), {revoke: true, refresh: false});
});

test('the window\'s view has the state and the ask, never a cookie value', () => {
  const settings = store(), kc = keychain();
  assert.deepEqual(linkedinView(settings, {keychain: kc}), {on: false, asked: 0, declined: 0, signedIn: false, login: 'none', ask: true, hasSession: false, signin: {state: 'ok', why: '', empties: 0}});
  openSignin(settings);
  linkedinRoutes(settings, {keychain: kc}).session({cookies: [{name: 'li_at', value: SECRET, domain: '.linkedin.com'}]});
  const view = linkedinView(settings, {keychain: kc});
  assert.deepEqual(view, {on: false, asked: 0, declined: 0, signedIn: true, login: 'kept', ask: true, hasSession: true, signin: {state: 'ok', why: '', empties: 0}});
  assert.equal(JSON.stringify(view).includes(SECRET), false);
});

test('registered handlers: demo mode touches no store, off deletes the item, the counters change only through the dialog\'s calls', async () => {
  const handlers = new Map(), routes = new Map(), ipcMain = {handle: (name, fn) => handlers.set(name, fn)}, server = {setVisitRoute: (path, fn) => routes.set(path, fn)};
  const settings = store(), kc = keychain();
  registerLinkedinHandlers({DEMO: false, ipcMain, server, storage: settings, openPage: async () => ({opened: true}), deps: {keychain: kc}});
  assert.deepEqual([...routes.keys()].sort(), ['/extension/linkedin-pending', '/extension/linkedin-refresh', '/extension/linkedin-session']);
  await handlers.get('linkedinJobsAsked')();
  await handlers.get('linkedinJobsAnswer')({}, 'not-now');
  assert.deepEqual((await handlers.get('linkedinJobsState')()).asked, 1);
  assert.equal((await handlers.get('linkedinJobsState')()).declined, 1);
  openSignin(settings);   // the person picked the Chrome way
  routes.get('/extension/linkedin-session')({cookies: [{name: 'li_at', value: SECRET, domain: '.linkedin.com'}]});
  assert.equal((await handlers.get('linkedinJobsState')()).on, false, 'a Chrome copy turns no switch on');
  assert.deepEqual(await handlers.get('linkedinJobsOn')(), {ok: true}, 'the press that asked turns its own switch on once its copy is kept');
  assert.equal((await handlers.get('linkedinJobsState')()).on, true);
  await handlers.get('linkedinJobsOff')();
  assert.equal(kc.items.has(SERVICE), false);
  assert.equal((await handlers.get('linkedinJobsState')()).on, false);
  assert.deepEqual(await handlers.get('linkedinJobsConnect')(), {opened: true});
  const demo = new Map(); registerLinkedinHandlers({DEMO: true, ipcMain: {handle: (name, fn) => demo.set(name, fn)}, server, storage: {settings: () => { throw new Error('demo must not read the store'); }}, openPage: async () => { throw new Error('demo must not open Chrome'); }});
  assert.equal((await demo.get('linkedinJobsState')()).on, false);
  assert.deepEqual(await demo.get('linkedinJobsConnect')(), {opened: true});
  assert.deepEqual(await demo.get('linkedinJobsOff')(), {ok: true});
});

test("#2731 a Find jobs press asks, the extension's look hears it, its copy lands in the Keychain and the press goes on", async () => {
  const settings = store(), kc = keychain(), note = createRefresh(), routes = linkedinRoutes(settings, {keychain: kc, refresh: note});
  openSignin(settings);
  routes.session({cookies: [{name: 'li_at', value: SECRET, domain: '.linkedin.com'}]});
  turnOn(settings, {keychain: kc});   // the press that asked
  assert.equal(routes.pending().refresh, false, 'nobody pressed: the look is only a look');
  const pressed = note.ask();   // the look just now made the extension "alive"
  assert.equal(routes.pending().refresh, true, 'the press is waiting: copy now');
  assert.deepEqual(routes.refresh({cookies: [{name: 'li_at', value: 'AQEDAR-fresh-value', domain: '.linkedin.com'}]}), {ok: true});
  assert.equal(await pressed, 'fresh');
  assert.equal(readSession({keychain: kc}).li_at, 'AQEDAR-fresh-value');
  assert.equal(routes.pending().refresh, false, 'asked once per press');
  settings.saveSettings({linkedinJobs: {on: false}});
  assert.deepEqual(routes.pending(), {revoke: true, refresh: false}, 'off never asks for a copy');
  assert.deepEqual(routes.refresh({held: false}), {ok: false, error: 'No LinkedIn sign-in is kept'});
});

// Gitar on #4276, #4283, #4328: a Chrome copy is kept only while the Chrome way the person opened still waits; a window sign-in closes that way.
test('a Chrome copy nobody asked for is refused; an open Chrome way keeps its grants and takes one copy; a window sign-in closes it', async () => {
  const settings = store(), kc = keychain(), routes = linkedinRoutes(settings, {keychain: kc});
  const copy = {cookies: [{name: 'li_at', value: SECRET, domain: '.linkedin.com'}]};
  assert.equal(routes.session(copy).ok, false, 'nobody asked: nothing kept, nothing on');
  assert.equal(kc.items.size, 0);
  openSignin(settings);
  assert.equal(routes.pending().revoke, false, 'an open Chrome consent must not lose its grants before its copy arrives');
  assert.equal(routes.session({cookies: [{name: 'bcookie', value: 'x', domain: '.linkedin.com'}]}).ok, false, 'an unusable copy');
  assert.equal(routes.session(copy).ok, true, 'the next copy is still taken');
  assert.notEqual(settings.settings().linkedinJobs?.login?.state, 'waiting', 'the Chrome way is done now');
  const other = store(), kc2 = keychain(), handlers = new Map();
  registerLinkedinHandlers({DEMO: false, ipcMain: {handle: (name, fn) => handlers.set(name, fn)}, server: {setVisitRoute: () => {}}, storage: other,
    deps: {keychain: kc2, isolated: true}, log: () => {}, signIn: async () => ({ok: true, cookies: copy.cookies})});
  openSignin(other);   // the person first opened the Chrome way, then signed in with the window
  assert.deepEqual(await handlers.get('linkedinJobsSignIn')(), {ok: true});
  assert.notEqual(other.settings().linkedinJobs?.login?.state, 'waiting', 'the Chrome way is done: its late copy is not taken');
});

// Gitar on #4337: a copy after the 150 s wait is refused, and a Chrome page that never opened leaves no Chrome way open.
test('a copy after the Chrome way waited 150 s is refused; a page that never opened opens no Chrome way', async () => {
  const t0 = Date.parse('2026-11-14T08:00:00Z');
  let clock = t0;
  const settings = store(), kc = keychain(), routes = linkedinRoutes(settings, {keychain: kc, now: () => clock});
  openSignin(settings, {now: () => t0});
  clock = t0 + WANTED_MS + 1000;
  assert.equal(routes.pending().revoke, true, 'the wait is over: the grants go back');
  assert.equal(routes.session({cookies: [{name: 'li_at', value: SECRET, domain: '.linkedin.com'}]}).ok, false, 'too late: nothing kept');
  assert.equal(kc.items.size, 0);
  const other = store(), handlers = new Map();
  registerLinkedinHandlers({DEMO: false, ipcMain: {handle: (name, fn) => handlers.set(name, fn)}, server: {setVisitRoute: () => {}}, storage: other, deps: {keychain: keychain()},
    openPage: async () => ({opened: null, why: 'no-extension'})});
  assert.deepEqual(await handlers.get('linkedinJobsConnect')(), {opened: null, why: 'no-extension'});
  assert.notEqual(other.settings().linkedinJobs?.login?.state, 'waiting', 'nothing opened: no copy is waited for');
  const thrown = store(), h2 = new Map();
  registerLinkedinHandlers({DEMO: false, ipcMain: {handle: (name, fn) => h2.set(name, fn)}, server: {setVisitRoute: () => {}}, storage: thrown, deps: {keychain: keychain()},
    openPage: async () => { throw new Error('Chrome would not start'); }});
  await assert.rejects(h2.get('linkedinJobsConnect')(), /Chrome would not start/);
  assert.notEqual(thrown.settings().linkedinJobs?.login?.state, 'waiting', 'a page that threw opens no Chrome way (Gitar on #4340)');
});

// Gitar on #4340: switching LinkedIn jobs off ends an open Chrome way, so a late consent copy cannot turn it back on.
test('switching off ends an open Chrome way: a late copy is refused and the grants go back', () => {
  const settings = store(), kc = keychain(), routes = linkedinRoutes(settings, {keychain: kc});
  openSignin(settings);
  turnOff(settings, {keychain: kc});
  assert.equal(routes.pending().revoke, true);
  assert.equal(routes.session({cookies: [{name: 'li_at', value: SECRET, domain: '.linkedin.com'}]}).ok, false);
  assert.equal(kc.items.size, 0);
});

// Owner, 14 Nov 2026 ("he must be able to enable each of them separately, but he should never login 2 times"), Gitar on #4317, #4374: a sign-in turns no switch on; the press that asked does, in its own call.
test('the window press turns its own switch on and says so when it cannot; a Chrome copy turns none on; a renewal while on changes nothing', async () => {
  const cookies = [{name: 'li_at', value: SECRET, domain: '.linkedin.com'}];
  const press = async (kc, options, mine = {}) => {
    const settings = store(mine), handlers = new Map();
    registerLinkedinHandlers({DEMO: false, storage: settings, ipcMain: {handle: (name, fn) => handlers.set(name, fn)}, server: {setVisitRoute: () => {}}, deps: {keychain: kc, isolated: true}, log: () => {}, signIn: async () => ({ok: true, cookies})});
    return {settings, answer: await handlers.get('linkedinJobsSignIn')({}, options)};
  };
  const good = await press(keychain(), {turnOn: 'jobs'});
  assert.deepEqual(good.answer, {ok: true});
  assert.equal(good.settings.settings().linkedinJobs.on, true, 'the window press turned its switch on');
  assert.equal((await press(keychain(), undefined)).settings.settings().linkedinJobs?.on === true, false, 'a renewal (no asking switch) turns nothing on');
  assert.deepEqual((await press(keychain(), {turnOn: 'easy-apply'})).answer, {ok: false, reason: 'invalid-switch'});
  const lost = keychain();
  lost.read = () => null;   // the item cannot be read back: nothing to turn on with
  const refused = await press(lost, {turnOn: 'jobs'});
  assert.deepEqual(refused.answer, {ok: false, kept: true, reason: 'needs-signin'});
  assert.equal(refused.settings.settings().linkedinJobs?.on === true, false, 'a refused turn-on is never "on"');
  const blind = keychain();
  blind.read = () => null;
  assert.deepEqual((await press(blind, {turnOn: 'jobs'}, {linkedinJobs: {on: true}})).answer, {ok: true}, 'LinkedIn jobs is on: a renewal turns nothing on and cannot fail');
  const settings = store(), kc = keychain(), routes = linkedinRoutes(settings, {keychain: kc});
  assert.equal(routes.session({cookies}).ok, false, 'nobody asked: refused, nothing on');
  openSignin(settings);
  assert.deepEqual(routes.session({cookies}), {ok: true});
  assert.equal(settings.settings().linkedinJobs.on === true, false, 'the Chrome copy turns no switch on: the window\'s watch asks for it');
  assert.equal(settings.settings().linkedinJobs.login.state, 'kept');
});

// Gitar on #4350, #4354: a sign-in kept while LinkedIn jobs is off is deleted at the next start once no press can still use it; a Chrome wait or a fresh copy stays; one in use stays.
test('at start a sign-in no press can still turn on is deleted; waiting, fresh and in-use ones stay', () => {
  const now = () => Date.parse('2026-11-14T08:00:00Z');
  for (const [name, mine, kept] of [['LinkedIn jobs on', {on: true, login: {state: 'kept', at: now() - 600000}}, true], ['Chrome way waiting', {on: false, login: {state: 'waiting', at: now() - 30000}}, true],
    ['copy kept 30 s ago', {on: false, login: {state: 'kept', at: now() - 30000}}, true], ['copy kept 10 min ago', {on: false, login: {state: 'kept', at: now() - 600000}}, false]]) {
    const settings = store({linkedinJobs: mine}), kc = keychain();
    kc.items.set(SERVICE, JSON.stringify({li_at: SECRET}));
    registerLinkedinHandlers({DEMO: false, ipcMain: {handle: () => {}}, server: {setVisitRoute: () => {}}, storage: settings, deps: {keychain: kc, now}});
    assert.equal(kc.items.has(SERVICE), kept, name);
  }
});

// Gitar on #4350, #4365: opening the Chrome way with nothing kept waits for its copy; a kept sign-in is used by the window (consent test), so the main side never deletes it.
test('the Chrome way with nothing kept waits for its copy and expires', async () => {
  const none = store(), handlers = new Map();
  registerLinkedinHandlers({DEMO: false, ipcMain: {handle: (name, fn) => handlers.set(name, fn)}, server: {setVisitRoute: () => {}}, storage: none, deps: {keychain: keychain(), now: () => 1}, log: () => {}, openPage: async () => ({opened: true})});
  await handlers.get('linkedinJobsConnect')();
  assert.equal(none.settings().linkedinJobs.login.state, 'waiting');
});

// Gitar on #4358: a Chrome sign-out leaves LinkedIn jobs on: the extension keeps its grants and a copy from a new Chrome sign-in is taken, so one fact has one owner.
test('signed out in Chrome with LinkedIn jobs on: grants kept, a new Chrome copy is taken and the sign-in is kept again', () => {
  const settings = store({linkedinJobs: {on: true, login: {state: 'none', at: 1}}}), kc = keychain();
  const routes = linkedinRoutes(settings, {keychain: kc, refresh: {look: () => false, delivered: () => {}}});
  assert.equal(routes.pending().revoke, false, 'the grants stay: LinkedIn jobs is still on');
  assert.deepEqual(routes.refresh({cookies: [{name: 'li_at', value: SECRET, domain: '.linkedin.com'}]}), {ok: true});
  assert.equal(settings.settings().linkedinJobs.login.state, 'kept');
  assert.equal(settings.settings().linkedinJobs.on, true);
  assert.equal(linkedinRoutes(store(), {keychain: kc}).pending().revoke, true, 'nothing on, nothing kept, nothing waiting: the grants go');
});
