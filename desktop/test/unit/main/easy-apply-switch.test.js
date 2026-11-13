// LinkedIn Easy Apply's switch, plan 1/5 (spec docs/superpowers/specs/2026-11-13-linkedin-easy-apply-design.md D4): off by default, on only after the owner's warning was shown once and only
// while LinkedIn jobs holds the sign-in, offered in dev builds only until sending lands, and turning it off never touches LinkedIn jobs' pause or session. lib/easy-apply-switch.js, lib/easy-apply-handlers.js.
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
const linkedinOn = (extra = {}) => ({linkedinJobs: {on: true, asked: 1, declined: 0, pauseUntil: '2026-11-14T16:47:00.000Z', ...extra}});

test('off by default, and the view says so for a fresh install', () => {
  assert.deepEqual(state(store()), {on: false, warnedAt: ''});
  assert.deepEqual(viewOf(store(), {packaged: false}), {on: false, linkedinOn: false, warned: false, offered: true});
});

test('turning on needs LinkedIn jobs on first: its sign-in is the one Easy Apply uses', () => {
  const storage = store();
  assert.deepEqual(turnOn(storage, {warned: true, now: NOW}), {ok: false, reason: 'needs-linkedin'});
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
  assert.deepEqual(turnOff(storage), {ok: true});
  assert.deepEqual(storage.mine.linkedinJobs, before);
  assert.deepEqual(state(storage), {on: false, warnedAt: NOW.toISOString()});
});

test('with LinkedIn jobs off (no sign-in kept) Easy Apply reads as off, whatever was saved', () => {
  const storage = store({linkedinJobs: {on: false}, easyApply: {on: true, warnedAt: NOW.toISOString()}});
  assert.equal(state(storage).on, false);
  assert.deepEqual(viewOf(storage, {packaged: false}), {on: false, linkedinOn: false, warned: true, offered: true});
});

// Gitar on #4008: the saved yes must not come back by itself when LinkedIn jobs is switched off and on again; Easy Apply sends from the person's account.
test('switching LinkedIn jobs off turns Easy Apply off for good; LinkedIn jobs back on leaves it off, still warned once', () => {
  const storage = store(linkedinOn());
  const keychain = {write: () => true, read: () => null, remove: () => true};
  assert.deepEqual(turnOn(storage, {warned: true, now: NOW}), {ok: true});
  linkedin.turnOff(storage, {keychain});
  assert.equal(storage.mine.easyApply.on, false, 'the saved switch itself is off, not only read as off');
  assert.equal(storage.mine.easyApply.warnedAt, NOW.toISOString());
  assert.deepEqual(linkedin.saveSession(storage, [{name: 'li_at', value: 'fake-token', domain: '.linkedin.com'}], {keychain}), {ok: true});
  assert.equal(linkedin.state(storage).on, true);
  assert.equal(state(storage).on, false, 'LinkedIn jobs on again: Easy Apply stays off until the person turns it on');
  const fresh = store(linkedinOn());
  linkedin.turnOff(fresh, {keychain});
  assert.equal(fresh.mine.easyApply, undefined, 'never turned on: nothing written');
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
  assert.deepEqual(await handlers.easyApplyState(), {on: true, linkedinOn: true, warned: true, offered: true});
  assert.deepEqual(await handlers.easyApplyOff(), {ok: true});
  assert.equal((await handlers.easyApplyState()).on, false);
});
