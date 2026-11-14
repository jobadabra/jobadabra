// LinkedIn Easy Apply's switch, plan 1/5 (spec docs/superpowers/specs/2026-11-13-linkedin-easy-apply-design.md D4): off by default, on only after the owner's warning was shown once and only
// while a LinkedIn sign-in is kept (owner, 14 Nov 2026: two switches, one sign-in), offered in dev builds only until sending lands, and turning it off never touches LinkedIn jobs' switch or pause.
// lib/easy-apply-switch.js, lib/easy-apply-handlers.js.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {registerEasyApplyHandlers} from '../../../lib/easy-apply-handlers.js';
import {state, turnOff, turnOn, viewOf} from '../../../lib/easy-apply-switch.js';
import * as linkedin from '../../../lib/linkedin-session.js';

const NOW = new Date('2026-11-13T18:00:00.000Z');
function store(settings = {}) {
  const mine = structuredClone(settings);
  return {mine, settings: () => mine, saveSettings: patch => Object.assign(mine, patch)};
}
const keychain = () => { const items = new Map(); return {items, write: (service, value) => { items.set(service, value); return true; }, read: service => items.get(service) || null, remove: service => items.delete(service)}; };
const LI = [{name: 'li_at', value: 'fake-token', domain: '.linkedin.com'}];
const linkedinOn = (extra = {}) => ({linkedinJobs: {on: true, asked: 1, declined: 0, pauseUntil: '2026-11-14T16:47:00.000Z', ...extra}});

test('off by default, and the view says so for a fresh install', () => {
  assert.deepEqual(state(store()), {on: false, warnedAt: ''});
  assert.deepEqual(viewOf(store(), {packaged: false}), {on: false, signedIn: false, warned: false, offered: true});
});

test('turning on needs a LinkedIn sign-in kept: it is the one Easy Apply sends with', () => {
  const storage = store();
  assert.deepEqual(turnOn(storage, {warned: true, now: NOW}), {ok: false, reason: 'needs-signin'});
  assert.equal(storage.mine.easyApply, undefined, 'nothing saved');
});

test('the first turn-on needs the warning shown; it is stamped once and a later turn-on keeps the first stamp', () => {
  const storage = store(linkedinOn());
  assert.deepEqual(turnOn(storage, {now: NOW}), {ok: false, reason: 'not-warned'}, 'no warning shown yet: refused');
  assert.deepEqual(turnOn(storage, {warned: true, now: NOW}), {ok: true});
  assert.deepEqual(state(storage), {on: true, warnedAt: NOW.toISOString()});
  turnOff(storage);
  assert.deepEqual(turnOn(storage, {now: new Date('2026-11-20T09:00:00.000Z')}), {ok: true}, 'warned once: no second warning');
  assert.equal(state(storage).warnedAt, NOW.toISOString());
});

test('turning off keeps LinkedIn jobs as it was: its switch, its 24 h pause and its counters', () => {
  const storage = store({...linkedinOn(), easyApply: {on: true, warnedAt: NOW.toISOString()}});
  const before = structuredClone(storage.mine.linkedinJobs);
  assert.deepEqual(turnOff(storage, {keychain: keychain()}), {ok: true});
  assert.deepEqual(storage.mine.linkedinJobs, before);
  assert.deepEqual(state(storage), {on: false, warnedAt: NOW.toISOString()});
});

test('with no sign-in kept Easy Apply reads as off, whatever was saved', () => {
  const storage = store({linkedinJobs: {on: false}, easyApply: {on: true, warnedAt: NOW.toISOString()}});
  assert.equal(state(storage).on, false);
  assert.deepEqual(viewOf(storage, {packaged: false}), {on: false, signedIn: false, warned: true, offered: true});
});

// Why (owner, 14 Nov 2026: "he must be able to enable each of them separately, but he should never login 2 times. Once logged in, then we should share it for the other"
// · "a turn on should focus just on that specific case (easy apply or linkedin jobs)" · "Then the user can press another turn on for the other"; asked via AskUserQuestion: "Yes, this design (Recommended)").
test('the owner\'s scenario: Easy Apply alone on a fresh install, LinkedIn jobs later with no second sign-in, each off on its own', () => {
  const storage = store(), kc = keychain();
  assert.deepEqual(linkedin.saveSession(storage, LI, {keychain: kc, for: 'easy-apply'}), {ok: true}, 'signed in from Easy Apply\'s door');
  assert.equal(linkedin.state(storage).on, false, 'a sign-in for Easy Apply does not turn LinkedIn jobs on');
  assert.equal(linkedin.signedIn(storage), true);
  assert.deepEqual(turnOn(storage, {warned: true, now: NOW}), {ok: true}, 'Easy Apply alone');
  assert.equal(state(storage).on, true);
  assert.deepEqual(linkedin.turnOn(storage), {ok: true}, 'LinkedIn jobs later: the kept sign-in, nothing asked');
  assert.equal(linkedin.state(storage).on, true);
  linkedin.turnOff(storage, {keychain: kc});
  assert.equal(linkedin.state(storage).on, false);
  assert.equal(state(storage).on, true, 'LinkedIn jobs off: Easy Apply keeps working');
  assert.ok(linkedin.readSession({keychain: kc}), 'the sign-in stays while Easy Apply uses it');
  turnOff(storage, {keychain: kc});
  assert.equal(linkedin.readSession({keychain: kc}), null, 'both off: the sign-in is deleted');
  assert.equal(linkedin.signedIn(storage), false);
  assert.deepEqual(linkedin.turnOn(storage), {ok: false, reason: 'needs-signin'}, 'nothing kept: the next turn-on signs in again');
});

test('LinkedIn jobs alone, then Easy Apply with no second sign-in; Easy Apply off keeps LinkedIn jobs\' sign-in', () => {
  const storage = store(), kc = keychain();
  assert.deepEqual(linkedin.saveSession(storage, LI, {keychain: kc, for: 'jobs'}), {ok: true});
  assert.equal(linkedin.state(storage).on, true);
  assert.equal(state(storage).on, false, 'a sign-in for LinkedIn jobs does not turn Easy Apply on');
  assert.deepEqual(turnOn(storage, {warned: true, now: NOW}), {ok: true}, 'only the warning, no sign-in');
  turnOff(storage, {keychain: kc});
  assert.ok(linkedin.readSession({keychain: kc}), 'LinkedIn jobs still uses it');
  assert.equal(linkedin.state(storage).on, true);
});

test('a sign-in kept before the two switches (LinkedIn jobs on, no signedIn mark) still counts as kept', () => {
  assert.equal(linkedin.signedIn(store(linkedinOn())), true);
  assert.deepEqual(turnOn(store(linkedinOn()), {warned: true, now: NOW}), {ok: true});
});

test('a renewal keeps both switches as they were', () => {
  const storage = store({linkedinJobs: {on: false, signedIn: true}, easyApply: {on: true, warnedAt: NOW.toISOString()}}), kc = keychain();
  assert.deepEqual(linkedin.saveSession(storage, LI, {keychain: kc}), {ok: true});
  assert.equal(linkedin.state(storage).on, false);
  assert.equal(state(storage).on, true);
});

test('a packaged build is not offered the switch until sending lands (owner, 13 Nov 2026: "Dev builds only until 4/5")', () => {
  assert.equal(viewOf(store(linkedinOn()), {packaged: true}).offered, false);
  const storage = store(linkedinOn());
  assert.deepEqual(turnOn(storage, {warned: true, now: NOW, packaged: true}), {ok: false, reason: 'not-offered'});
  assert.equal(state(storage).on, false);
});

test('the three channels: demo mode touches no settings; a real turn-on passes the dialog\'s warned flag', async () => {
  const handlers = {}, ipcMain = {handle: (name, fn) => { handlers[name] = fn; }};
  const demo = store(linkedinOn());
  registerEasyApplyHandlers({DEMO: true, ipcMain, storage: demo, packaged: false, clock: () => NOW});
  assert.deepEqual(Object.keys(handlers).sort(), ['easyApplyOff', 'easyApplyOn', 'easyApplyState']);
  assert.deepEqual(await handlers.easyApplyOn({}, {warned: true}), {ok: false, reason: 'not-offered'}, 'demo never says on over a row that reads off');
  assert.equal((await handlers.easyApplyState()).on, false);
  assert.equal(demo.mine.easyApply, undefined, 'demo: nothing saved');

  const real = store(linkedinOn());
  registerEasyApplyHandlers({DEMO: false, ipcMain, storage: real, packaged: false, clock: () => NOW});
  assert.deepEqual(await handlers.easyApplyOn({}, {}), {ok: false, reason: 'not-warned'});
  assert.deepEqual(await handlers.easyApplyOn({}, {warned: true}), {ok: true});
  assert.deepEqual(await handlers.easyApplyState(), {on: true, signedIn: true, warned: true, offered: true});
  assert.deepEqual(await handlers.easyApplyOff(), {ok: true});
  assert.equal((await handlers.easyApplyState()).on, false);
});
