// LinkedIn jobs, PR 1/3: the two routes the extension calls and the window's view (lib/linkedin-handlers.js). The consent page's POST saves the session; the minute
// poll learns that the switch went off; the view never carries a cookie value.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {linkedinRoutes, linkedinView, registerLinkedinHandlers} from '../../../lib/linkedin-handlers.js';
import {SERVICE, openSignin, readSession} from '../../../lib/linkedin-session.js';
import {createRefresh} from '../../../lib/linkedin-refresh.js';

const SECRET = 'AQEDAR-fake-li-at-value';
function store(settings = {}) { const mine = {...settings}; return {settings: () => mine, saveSettings: patch => Object.assign(mine, patch)}; }
function keychain() { const items = new Map(); return {items, write: (service, value) => { items.set(service, value); return true; }, read: service => items.get(service) || null, remove: service => items.delete(service)}; }

test('the consent page\'s POST saves the session, the poll then says keep; off says revoke', () => {
  const settings = store(), kc = keychain(), routes = linkedinRoutes(settings, {keychain: kc});
  assert.deepEqual(routes.pending(), {revoke: true, refresh: false}, 'off: the extension gives its LinkedIn permissions back');
  openSignin(settings);   // the person picked the Chrome way to turn LinkedIn jobs on
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
  assert.deepEqual(linkedinView(settings, {keychain: kc}), {on: false, asked: 0, declined: 0, signedIn: false, ask: true, hasSession: false, signin: {state: 'ok', why: '', empties: 0}});
  openSignin(settings);   // the person picked the Chrome way to turn LinkedIn jobs on
  linkedinRoutes(settings, {keychain: kc}).session({cookies: [{name: 'li_at', value: SECRET, domain: '.linkedin.com'}]});
  const view = linkedinView(settings, {keychain: kc});
  assert.deepEqual(view, {on: false, asked: 0, declined: 0, signedIn: true, ask: true, hasSession: true, signin: {state: 'ok', why: '', empties: 0}});
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
  openSignin(settings);   // the person picked the Chrome way to turn LinkedIn jobs on
  routes.get('/extension/linkedin-session')({cookies: [{name: 'li_at', value: SECRET, domain: '.linkedin.com'}]});
  assert.equal((await handlers.get('linkedinJobsState')()).on, false, 'a sign-in turns no switch on by itself');
  assert.deepEqual(await handlers.get('linkedinJobsOn')(), {ok: true}, 'the window turns on the switch that asked');
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
  openSignin(settings);   // the person picked the Chrome way to turn LinkedIn jobs on
  routes.session({cookies: [{name: 'li_at', value: SECRET, domain: '.linkedin.com'}]});
  settings.saveSettings({linkedinJobs: {...settings.settings().linkedinJobs, on: true}});   // the window's turn-on once the sign-in came
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

// Why (owner, 14 Nov 2026: "he must be able to enable each of them separately, but he should never login 2 times"; "Simplify, then reopen (Recommended)" after Gitar on #4297): a sign-in, by
// either way, turns no switch on; the window then turns on the one that asked, and the other later needs no second sign-in.
test('two switches, one sign-in: either way keeps the sign-in and turns nothing on; LinkedIn jobs then turns on with no second sign-in', async () => {
  const settings = store(), kc = keychain(), handlers = new Map(), routes = new Map(), opened = [];
  const server = {setVisitRoute: (path, fn) => routes.set(path, fn), extensionSeen: () => true};
  registerLinkedinHandlers({DEMO: false, ipcMain: {handle: (name, fn) => handlers.set(name, fn)}, server, storage: settings, deps: {keychain: kc, isolated: true}, log: () => {},
    openPage: async () => { opened.push('chrome'); return {opened: true}; }, signIn: async () => ({ok: true, cookies: [{name: 'li_at', value: SECRET, domain: '.linkedin.com'}]})});
  assert.deepEqual(await handlers.get('linkedinJobsConnect')(), {opened: true}, 'the Chrome way, asked by Easy Apply');
  routes.get('/extension/linkedin-session')({cookies: [{name: 'li_at', value: SECRET, domain: '.linkedin.com'}]});
  let view = await handlers.get('linkedinJobsState')();
  assert.equal(view.on, false, 'LinkedIn jobs stays off: the sign-in turns nothing on');
  assert.equal(view.signedIn, true);
  assert.equal(routes.get('/extension/linkedin-pending')().revoke, false, 'a kept sign-in keeps the extension\'s LinkedIn permissions');
  assert.deepEqual(await handlers.get('linkedinJobsOn')(), {ok: true}, 'LinkedIn jobs later: nothing asked');
  assert.equal((await handlers.get('linkedinJobsState')()).on, true);

  const other = store(), kc2 = keychain(), h2 = new Map();
  registerLinkedinHandlers({DEMO: false, ipcMain: {handle: (name, fn) => h2.set(name, fn)}, server: {setVisitRoute: () => {}}, storage: other, deps: {keychain: kc2, isolated: true}, log: () => {},
    openPage: async () => ({opened: true}), signIn: async () => ({ok: true, cookies: [{name: 'li_at', value: SECRET, domain: '.linkedin.com'}]})});
  assert.deepEqual(await h2.get('linkedinJobsOn')(), {ok: false, reason: 'needs-signin'}, 'nothing kept: no turn-on without a sign-in');
  assert.deepEqual(await h2.get('linkedinJobsSignIn')(), {ok: true}, 'the window way');
  view = await h2.get('linkedinJobsState')();
  assert.deepEqual([view.on, view.signedIn], [false, true], 'kept, nothing on');
  assert.ok(readSession({keychain: kc2}));
});

// Gitar on #4276, #4297: a copy is kept only while a Chrome way waits for it (or as a refresh), turns nothing on, and the open way ends only when a copy was kept.
test('an unasked copy with nothing kept is refused; a refused copy leaves the Chrome way open for the next try', () => {
  const settings = store(), kc = keychain(), routes = linkedinRoutes(settings, {keychain: kc});
  assert.equal(routes.session({cookies: [{name: 'li_at', value: SECRET, domain: '.linkedin.com'}]}).ok, false, 'nobody asked: nothing kept, nothing on');
  assert.equal(kc.items.size, 0);
  openSignin(settings);
  assert.equal(routes.session({cookies: [{name: 'bcookie', value: 'x', domain: '.linkedin.com'}]}).ok, false, 'an unusable copy');
  assert.equal(routes.session({cookies: [{name: 'li_at', value: SECRET, domain: '.linkedin.com'}]}).ok, true, 'the next copy is still taken');
  assert.equal(settings.settings().linkedinJobs.on, false, 'LinkedIn jobs never turned on');
  assert.equal(settings.settings().linkedinJobs.signinOpenAt, undefined, 'the Chrome way is done now');
});

// Gitar on #4297: a sign-in whose press never turned its switch on (the window closed meanwhile) is not kept past the next start.
test('at start, a sign-in kept with both switches off is deleted; one a switch uses stays', () => {
  const reg = storage => registerLinkedinHandlers({DEMO: false, ipcMain: {handle: () => {}}, server: {setVisitRoute: () => {}}, storage, deps: {keychain: storage.kc}, openPage: async () => ({opened: true})});
  const unused = Object.assign(store({linkedinJobs: {on: false, signedIn: true}, easyApply: {on: false}}), {kc: keychain()});
  unused.kc.items.set(SERVICE, JSON.stringify({li_at: SECRET}));
  reg(unused);
  assert.equal(unused.kc.items.has(SERVICE), false);
  assert.equal(unused.settings().linkedinJobs.signedIn, false);
  const used = Object.assign(store({linkedinJobs: {on: false, signedIn: true}, easyApply: {on: true}}), {kc: keychain()});
  used.kc.items.set(SERVICE, JSON.stringify({li_at: SECRET}));
  reg(used);
  assert.equal(used.kc.items.has(SERVICE), true, 'Easy Apply uses it');
});
