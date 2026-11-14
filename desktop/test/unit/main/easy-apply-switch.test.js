// LinkedIn Easy Apply's switch, plan 1/5 (spec docs/superpowers/specs/2026-11-13-linkedin-easy-apply-design.md D4): off by default, on only after the owner's warning was shown once and only
// while LinkedIn jobs holds the sign-in, offered in dev builds only until sending lands, and turning it off never touches LinkedIn jobs' pause or session. lib/easy-apply-switch.js, lib/easy-apply-handlers.js.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {registerEasyApplyHandlers} from '../../../lib/easy-apply-handlers.js';
import {state, turnOff, turnOn, viewOf} from '../../../lib/easy-apply-switch.js';
import * as linkedin from '../../../lib/linkedin-session.js';
import {noteStop} from '../../../lib/easy-apply-limits.js';
import {linkedinRoutes} from '../../../lib/linkedin-handlers.js';
import {easyApplyOn} from '../../../renderer/apply-settings-model.js';

const NOW = new Date('2026-11-13T18:00:00.000Z');
function store(settings = {}) {
  const mine = structuredClone(settings);
  return {mine, settings: () => mine, saveSettings: patch => Object.assign(mine, patch)};
}
const ITEM = JSON.stringify({li_at: 'fake-token'});
const keptItem = () => ({read: () => ITEM, write: () => true, remove: () => true});   // a fake Keychain with a kept sign-in: tests never touch the real one
const keptOnly = (extra = {}) => ({linkedinJobs: {on: false, login: {state: 'kept', at: 1}, ...extra}});   // a sign-in kept with LinkedIn jobs off
const linkedinOn = (extra = {}) => ({linkedinJobs: {on: true, asked: 1, declined: 0, pauseUntil: '2026-11-14T16:47:00.000Z', ...extra}});

test('off by default, and the view says so for a fresh install', () => {
  assert.deepEqual(state(store()), {on: false, warnedAt: ''});
  assert.deepEqual(viewOf(store(), {packaged: false}), {on: false, signedIn: false, warned: false, offered: true});
});

test('turning on needs a kept sign-in, not LinkedIn jobs: with none it says needs-signin', () => {
  const storage = store();
  assert.deepEqual(turnOn(storage, {warned: true, now: NOW, keychain: keptItem()}), {ok: false, reason: 'needs-signin'});
  const noItem = store(keptOnly());
  assert.deepEqual(turnOn(noItem, {warned: true, now: NOW, keychain: {read: () => null}}), {ok: false, reason: 'needs-signin'}, 'the state alone is no sign-in: the Keychain item must be there');
  assert.equal(storage.mine.easyApply, undefined, 'nothing saved');
});

test('the first turn-on needs the warning shown; it is stamped once and a later turn-on keeps the first stamp', () => {
  const storage = store(linkedinOn());
  assert.deepEqual(turnOn(storage, {now: NOW, keychain: keptItem()}), {ok: false, reason: 'not-warned'}, 'no warning shown yet: refused');
  assert.deepEqual(turnOn(storage, {warned: true, now: NOW, keychain: keptItem()}), {ok: true});
  assert.deepEqual(state(storage), {on: true, warnedAt: NOW.toISOString()});
  turnOff(storage);
  assert.deepEqual(turnOn(storage, {now: new Date('2026-11-20T09:00:00.000Z'), keychain: keptItem()}), {ok: true}, 'warned once: no second warning');
  assert.equal(state(storage).warnedAt, NOW.toISOString());
});

test('turning off keeps LinkedIn jobs as it was: its switch, its 24 h pause and its counters', () => {
  const storage = store({...linkedinOn(), easyApply: {on: true, warnedAt: NOW.toISOString()}});
  const before = structuredClone(storage.mine.linkedinJobs);
  assert.deepEqual(turnOff(storage), {ok: true});
  assert.deepEqual(storage.mine.linkedinJobs, before);
  assert.deepEqual(state(storage), {on: false, warnedAt: NOW.toISOString()});
});

test('with no sign-in kept Easy Apply reads as off, whatever was saved', () => {
  const storage = store({linkedinJobs: {on: false, login: {state: 'none', at: 0}}, easyApply: {on: true, warnedAt: NOW.toISOString()}});
  assert.equal(state(storage).on, false);
  assert.deepEqual(viewOf(storage, {packaged: false}), {on: false, signedIn: false, warned: true, offered: true});
});

// Owner, 14 Nov 2026: "he must be able to enable each of them separately, but he should never login 2 times" (replaces Gitar on #4008, where Easy Apply went off with LinkedIn jobs).
test('each switch alone: Easy Apply on a sign-in kept with LinkedIn jobs off; LinkedIn jobs off keeps the sign-in while Easy Apply is on', () => {
  const storage = store(keptOnly());
  assert.deepEqual(turnOn(storage, {warned: true, now: NOW, keychain: keptItem()}), {ok: true}, 'LinkedIn jobs is off and Easy Apply still turns on');
  assert.equal(easyApplyOn(storage.mine), true);
  const items = new Map([[linkedin.SERVICE, ITEM]]), keychain = {write: (key, value) => { items.set(key, value); return true; }, read: key => items.get(key) ?? null, remove: key => items.delete(key)};
  linkedin.turnOn(storage, {keychain});
  assert.equal(linkedin.state(storage).on, true);
  linkedin.turnOff(storage, {keychain});
  assert.equal(items.has(linkedin.SERVICE), true, 'the Keychain item stays: Easy Apply uses it');
  assert.equal(linkedin.signedIn(storage), true, 'and so does the kept mark');
  assert.equal(state(storage).on, true, 'Easy Apply is still on');
});

test('LinkedIn jobs off with Easy Apply off deletes the sign-in, and Easy Apply then reads off whatever was saved; warned once stays', () => {
  const storage = store({...linkedinOn({login: {state: 'kept', at: 1}}), easyApply: {on: false, warnedAt: NOW.toISOString()}});
  const items = new Map([[linkedin.SERVICE, ITEM]]), keychain = {read: key => items.get(key) ?? null, remove: key => items.delete(key)};
  linkedin.turnOff(storage, {keychain});
  assert.equal(items.size, 0, 'nobody uses it: gone');
  assert.equal(storage.mine.easyApply.warnedAt, NOW.toISOString());
  storage.mine.easyApply.on = true;   // a saved yes with no sign-in behind it
  assert.equal(state(storage).on, false, 'no sign-in: reads off');
});

test('forgetUnused and a Chrome copy leave a sign-in alone while Easy Apply is on', () => {
  const storage = store({...keptOnly({login: {state: 'kept', at: 1}}), easyApply: {on: true, warnedAt: NOW.toISOString()}});
  const removed = [], keychain = {read: () => ITEM, remove: key => removed.push(key)};
  linkedin.forgetUnused(storage, {keychain, now: () => NOW.getTime()});
  assert.deepEqual(removed, [], 'an old kept sign-in is not deleted while Easy Apply uses it');
  assert.equal(linkedin.takesCopy(storage), true);
  const idle = store(keptOnly({login: {state: 'none', at: 0}}));
  assert.equal(linkedin.takesCopy(idle), false, 'nobody asked: no copy');
});

test('a packaged build is not offered the switch until sending lands (owner, 13 Nov 2026: "Dev builds only until 4/5")', () => {
  assert.equal(viewOf(store(linkedinOn()), {packaged: true}).offered, false);
  const storage = store(linkedinOn());
  assert.deepEqual(turnOn(storage, {warned: true, now: NOW, packaged: true, keychain: keptItem()}), {ok: false, reason: 'not-offered'});
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
  registerEasyApplyHandlers({DEMO: false, ipcMain, storage: real, packaged: false, clock: () => NOW, keychain: keptItem()});
  assert.deepEqual(await handlers.easyApplyOn({}, {}), {ok: false, reason: 'not-warned'});
  assert.deepEqual(await handlers.easyApplyOn({}, {warned: true}), {ok: true});
  assert.deepEqual(await handlers.easyApplyState(), {on: true, signedIn: true, warned: true, offered: true});
  assert.deepEqual(await handlers.easyApplyOff(), {ok: true});
  assert.equal((await handlers.easyApplyState()).on, false);
});

// Gitar on #4391: a saved Easy Apply yes with no sign-in behind it (after a Chrome sign-out) is off, so it holds nothing: no copy, no kept item, no skipped clean-up.
test('a saved Easy Apply yes with no sign-in holds nothing: no copy, the Chrome way waits, clean-up runs, LinkedIn jobs off deletes the item', () => {
  const lost = () => store({linkedinJobs: {on: false, login: {state: 'none', at: 0}}, easyApply: {on: true, warnedAt: NOW.toISOString()}});
  const withItem = () => { const removed = []; return {removed, keychain: {read: () => ITEM, remove: key => removed.push(key)}}; };
  assert.equal(easyApplyOn(lost().mine), false, 'the saved yes reads off');
  assert.equal(linkedin.takesCopy(lost()), false, 'nobody asked: a copy is not taken');
  const open = lost();
  linkedin.openSignin(open, {keychain: {read: () => null}});
  assert.equal(linkedin.loginOf(open).state, 'waiting', 'the Chrome way waits for its copy');
  const orphan = withItem();
  linkedin.forgetUnused(lost(), {keychain: orphan.keychain, now: () => NOW.getTime()});
  assert.equal(orphan.removed.length, 1, 'the orphaned item is cleaned up at start');
  const jobs = store({linkedinJobs: {on: true, login: {state: 'none', at: 0}}, easyApply: {on: true, warnedAt: NOW.toISOString()}}), gone = withItem();
  linkedin.turnOff(jobs, {keychain: gone.keychain});
  assert.equal(gone.removed.length, 1, 'LinkedIn jobs off deletes the item: nothing uses it');
});

// Gitar on #4393: Easy Apply going off is the other moment the sign-in can lose its last user; both ways (the switch, a second LinkedIn stop) release it by the one rule.
test('Easy Apply off deletes the sign-in when LinkedIn jobs is off; keeps it while LinkedIn jobs is on or a Chrome way waits', () => {
  const run = (settings, off) => { const removed = []; off(store(settings), {read: () => ITEM, remove: key => removed.push(key)}, removed); return removed.length; };
  const easy = {on: true, warnedAt: NOW.toISOString()};
  const viaSwitch = (storage, keychain) => turnOff(storage, {keychain, now: () => NOW.getTime()});
  assert.equal(run({...keptOnly(), easyApply: easy}, viaSwitch), 1, 'LinkedIn jobs off: nothing uses it, it goes');
  assert.equal(run({...linkedinOn({login: {state: 'kept', at: 1}}), easyApply: easy}, viaSwitch), 0, 'LinkedIn jobs on: it stays');
  assert.equal(run({linkedinJobs: {on: false, login: {state: 'waiting', at: NOW.getTime()}}, easyApply: easy}, viaSwitch), 0, 'a Chrome way waiting is not cut short');
  const second = store({...keptOnly(), easyApply: easy});
  second.mine.easyApply.stops = 1;
  const removed = [];
  noteStop(second, new Date('2026-11-14T10:00:00.000Z'), undefined, {keychain: {read: () => ITEM, remove: key => removed.push(key)}});   // a fake Keychain, never the real one
  assert.equal(second.mine.easyApply.on, false, 'the second stop turned it off');
  assert.equal(removed.length, 1, 'and with LinkedIn jobs off the sign-in item went with it');
  assert.equal(second.mine.linkedinJobs.login, undefined, 'and its mark');
});

// Owner, 14 Nov 2026, "One 'in use' rule" (Gitar's 3rd review of 5a, #4395): Easy Apply alone uses the sign-in, so it is refreshed and its read verdicts count, like LinkedIn jobs'.
test('one in-use rule: an Easy-Apply-only sign-in takes a copy, is asked to refresh and gets read verdicts; nothing in use, none of it', () => {
  const only = () => store({...keptOnly(), easyApply: {on: true, warnedAt: NOW.toISOString()}});
  const idle = () => store(keptOnly({login: {state: 'none', at: 0}}));
  const asked = storage => linkedinRoutes(storage, {refresh: {look: () => true, delivered: () => {}}}).pending();
  assert.equal(linkedin.inUse(only()), true);
  assert.deepEqual(asked(only()), {revoke: false, refresh: true}, 'the extension keeps its grants and is asked for a fresh copy');
  assert.deepEqual(asked(idle()), {revoke: true, refresh: false}, 'nothing in use: grants given up, no ask');
  const used = only(), unused = idle();
  assert.deepEqual(linkedin.noteRun(used, {state: 'signed-out', at: '2026-11-14T10:00:00.000Z'}, {log: () => {}}), {event: 'needs-you', why: 'signed-out'}, 'LinkedIn ended it: needs you');
  assert.equal(linkedin.signinView(used).state, 'needs-you');
  assert.deepEqual(linkedin.noteRun(unused, {state: 'signed-out', at: '2026-11-14T10:00:00.000Z'}, {log: () => {}}), {event: null, why: ''}, 'nothing in use: no verdict');
  const jobs = store(linkedinOn({login: {state: 'kept', at: 1}}));
  assert.equal(linkedin.inUse(jobs), true, 'LinkedIn jobs on alone still counts');
});
