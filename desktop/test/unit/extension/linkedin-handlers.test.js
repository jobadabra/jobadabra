// LinkedIn jobs, PR 1/3: the two routes the extension calls and the window's view (lib/linkedin-handlers.js). The consent page's POST saves the session; the minute
// poll learns that the switch went off; the view never carries a cookie value.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {linkedinRoutes, linkedinView, registerLinkedinHandlers} from '../../../lib/linkedin-handlers.js';
import {SERVICE, WANTED_MS, openSignin, readSession, turnOff} from '../../../lib/linkedin-session.js';
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
  assert.equal((await handlers.get('linkedinJobsState')()).on, false, 'a sign-in turns no switch on by itself');
  assert.deepEqual(await handlers.get('linkedinJobsOn')(), {ok: true}, 'the Chrome watch turns on the switch that asked');
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
  settings.saveSettings({linkedinJobs: {...settings.settings().linkedinJobs, on: true}});   // the press that asked turns LinkedIn jobs on once the sign-in came
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

// Why (owner, 14 Nov 2026: "he must be able to enable each of them separately, but he should never login 2 times"; "Simplify, then reopen (Recommended)" after Gitar on #4297): a sign-in, by
// either way, turns no switch on; the window then turns on the one that asked, and the other later needs no second sign-in.
test('either way keeps the sign-in and turns nothing on by itself; LinkedIn jobs then turns on with no second sign-in', async () => {
  const settings = store(), kc = keychain(), handlers = new Map(), routes = new Map(), opened = [];
  const server = {setVisitRoute: (path, fn) => routes.set(path, fn), extensionSeen: () => true};
  registerLinkedinHandlers({DEMO: false, ipcMain: {handle: (name, fn) => handlers.set(name, fn)}, server, storage: settings, deps: {keychain: kc, isolated: true}, log: () => {},
    openPage: async () => { opened.push('chrome'); return {opened: true}; }, signIn: async () => ({ok: true, cookies: [{name: 'li_at', value: SECRET, domain: '.linkedin.com'}]})});
  assert.deepEqual(await handlers.get('linkedinJobsConnect')(), {opened: true}, 'the Chrome way');
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

test('the window press turns LinkedIn jobs on before replying, a renewal turns nothing on, and an open Chrome way is closed', async () => {
  for (const turnOn of ['jobs', undefined]) {
    const settings = store({linkedinJobs: {on: false}, easyApply: {on: false}});
    const kc = keychain(), handlers = new Map();
    registerLinkedinHandlers({DEMO: false, ipcMain: {handle: (name, fn) => handlers.set(name, fn)}, server: {setVisitRoute: () => {}}, storage: settings,
      deps: {keychain: kc, isolated: true}, log: () => {}, signIn: async () => ({ok: true, cookies: [{name: 'li_at', value: SECRET, domain: '.linkedin.com'}]})});
    openSignin(settings);   // Gitar on #4328: the person first opened the Chrome way, then signed in with the window
    assert.deepEqual(await handlers.get('linkedinJobsSignIn')({}, {turnOn}), {ok: true});
    assert.equal(settings.settings().linkedinJobs.on, turnOn === 'jobs', String(turnOn));
    assert.equal(settings.settings().easyApply.on, false, 'Easy Apply is never turned on here');
    assert.ok(readSession({keychain: kc}));
    assert.notEqual(settings.settings().linkedinJobs?.login?.state, 'waiting', 'the Chrome way is done: its late copy is not taken');
  }
});

test('window cancellation, failed storage and an unknown switch turn nothing on', async () => {
  for (const failure of ['cancelled', 'not-kept', 'invalid-switch']) {
    const settings = store(), kc = keychain(), handlers = new Map();
    let opened = 0;
    if (failure === 'not-kept') kc.write = () => false;
    registerLinkedinHandlers({DEMO: false, ipcMain: {handle: (name, fn) => handlers.set(name, fn)}, server: {setVisitRoute: () => {}}, storage: settings,
      deps: {keychain: kc, isolated: true}, log: () => {}, signIn: async () => { opened++; return failure === 'cancelled' ? {ok: false, reason: 'cancelled'} : {ok: true, cookies: [{name: 'li_at', value: SECRET, domain: '.linkedin.com'}]}; }});
    const answer = await handlers.get('linkedinJobsSignIn')({}, {turnOn: failure === 'invalid-switch' ? 'easy-apply' : 'jobs'});
    assert.equal(answer.ok, false, failure);
    assert.equal(answer.reason, failure);
    assert.equal(settings.settings().linkedinJobs?.on === true, false);
    assert.equal(kc.items.size, 0);
    if (failure === 'invalid-switch') assert.equal(opened, 0, 'no window opens for a switch this build does not turn on here');
  }
});

// Gitar on #4350: a sign-in kept while LinkedIn jobs is off (its press never turned the switch on) is deleted at the next start once no press can still use it; one in use stays.
test('at start a sign-in no switch uses is deleted; one LinkedIn jobs uses stays', () => {
  const now = () => Date.parse('2026-11-14T08:00:00Z');
  for (const on of [false, true]) {
    const settings = store({linkedinJobs: {on, login: {state: 'kept', at: now() - 600000}}}), kc = keychain();
    kc.items.set(SERVICE, JSON.stringify({li_at: SECRET}));
    registerLinkedinHandlers({DEMO: false, ipcMain: {handle: () => {}}, server: {setVisitRoute: () => {}}, storage: settings, deps: {keychain: kc, now}});
    assert.equal(kc.items.has(SERVICE), on, `LinkedIn jobs ${on ? 'on' : 'off'}`);
    assert.equal(settings.settings().linkedinJobs.login?.state, on ? 'kept' : undefined);
  }
});

// Gitar on #4354: a restart while a press still waits keeps its sign-in: a Chrome way still waiting, or a copy kept in the last 150 s.
test('at start a sign-in a press may still turn on stays: Chrome way waiting, or a copy just kept', () => {
  const now = () => Date.parse('2026-11-14T08:00:00Z');
  for (const [name, login, kept] of [['Chrome way waiting', {state: 'waiting', at: now() - 30000}, true], ['copy kept 30 s ago', {state: 'kept', at: now() - 30000}, true],
    ['copy kept 10 min ago', {state: 'kept', at: now() - 600000}, false], ['wait that ran out with an old item', {state: 'waiting', at: now() - 600000}, false]]) {
    const settings = store({linkedinJobs: {on: false, login}}), kc = keychain();
    kc.items.set(SERVICE, JSON.stringify({li_at: SECRET}));
    registerLinkedinHandlers({DEMO: false, ipcMain: {handle: () => {}}, server: {setVisitRoute: () => {}}, storage: settings, deps: {keychain: kc, now}});
    assert.equal(kc.items.has(SERVICE), kept, name);
    assert.equal(settings.settings().linkedinJobs.login?.state, kept ? login.state : undefined, name);
  }
});

// Gitar on #4358: a Chrome sign-out leaves LinkedIn jobs on and its sign-in lost: the extension keeps its grants and a copy from a new Chrome sign-in is taken, so one fact has one owner.
test('lost sign-in with LinkedIn jobs on: grants kept, a new Chrome copy is taken and brings it back to kept', () => {
  const settings = store({linkedinJobs: {on: true, login: {state: 'lost', at: 1}}}), kc = keychain();
  const routes = linkedinRoutes(settings, {keychain: kc, refresh: {look: () => false, delivered: () => {}}});
  assert.equal(routes.pending().revoke, false, 'the grants stay: LinkedIn jobs is still on');
  assert.deepEqual(routes.refresh({cookies: [{name: 'li_at', value: SECRET, domain: '.linkedin.com'}]}), {ok: true});
  assert.equal(settings.settings().linkedinJobs.login.state, 'kept');
  assert.equal(settings.settings().linkedinJobs.on, true);
  const off = store();
  assert.equal(linkedinRoutes(off, {keychain: kc}).pending().revoke, true, 'nothing on, nothing kept, nothing waiting: the grants go');
});

// Gitar on #4365: opening the Chrome way over an older kept sign-in takes that sign-in out at once, so a wait that ends with no copy leaves no credential behind.
test('Chrome way over an older kept sign-in: it goes now; no copy, the wait ends, nothing is left', () => {
  const t0 = Date.parse('2026-11-14T08:00:00Z'), settings = store({linkedinJobs: {on: false, login: {state: 'kept', at: t0 - 600000}}}), kc = keychain();
  kc.items.set(SERVICE, JSON.stringify({li_at: SECRET}));
  openSignin(settings, {keychain: kc, now: () => t0});
  assert.equal(kc.items.has(SERVICE), false, 'the older item is out as the Chrome way opens');
  assert.equal(settings.settings().linkedinJobs.login.state, 'waiting');
  assert.equal(linkedinView(settings, {keychain: kc, now: () => t0 + WANTED_MS + 1000}).login, 'none');
});
