// LinkedIn Easy Apply's switch, plan 1/5 (spec docs/superpowers/specs/2026-11-13-linkedin-easy-apply-design.md, D4 "Full text (Recommended)"): off by default; the owner's warning is shown
// once, the first time it is turned on; on only while a LinkedIn sign-in is kept (lib/linkedin-session.js signedIn). Why (owner, 14 Nov 2026, replacing 13 Nov "LinkedIn jobs first": "he must be
// able to enable each of them separately, but he should never login 2 times"): it no longer needs LinkedIn jobs on. Settings: settings.easyApply = {on, warnedAt}. Invariant: nothing here
// writes LinkedIn jobs' switch or its shared 24 h pause (spec "One LinkedIn pause"); turning off deletes the sign-in only when LinkedIn jobs is off too (linkedin-session.js forget).
// Guard: test/unit/main/easy-apply-switch.test.js.
import {forget, signedIn, state as linkedinState} from './linkedin-session.js';
import {easyApplyOn} from '../renderer/apply-settings-model.js';   // the one rule, shared with the window's Full automation confirmation

/** The saved switch, read through the sign-in: with no sign-in kept Easy Apply reads as off whatever was saved. Always the same two keys. */
export function state(storage) {
  const settings = storage.settings();
  return {on: easyApplyOn(settings), warnedAt: String(settings.easyApply?.warnedAt || '')};
}
const save = (storage, patch) => storage.saveSettings({easyApply: {...(storage.settings().easyApply || {}), ...patch}});

/** What the window draws. `offered`: the row and ⌘K entry exist. Why (owner, 13 Nov 2026: "Dev builds only until 4/5"): nothing sends before the controller (plan 4/5), so a packaged build shows no switch that does nothing. */
export const viewOf = (storage, {packaged}) => {
  const mine = state(storage);
  return {on: mine.on, signedIn: signedIn(storage), warned: !!mine.warnedAt, offered: !packaged};
};

/**
 * Turn the switch on. `warned`: the window showed the owner's warning and the person pressed Turn on. -> {ok: true} | {ok: false, reason: 'not-offered' | 'needs-signin' | 'not-warned'}.
 * Invariant: the first turn-on is refused without `warned`; its time is kept as warnedAt and never moved, so the warning is shown once.
 */
export function turnOn(storage, {warned = false, now = new Date(), packaged = false} = {}) {
  if (packaged) return {ok: false, reason: 'not-offered'};
  if (!signedIn(storage)) return {ok: false, reason: 'needs-signin'};
  const warnedAt = state(storage).warnedAt || (warned ? now.toISOString() : '');
  if (!warnedAt) return {ok: false, reason: 'not-warned'};
  save(storage, {on: true, warnedAt, stops: 0});   // Why (13 Nov 2026, D3 "a second stop turns the switch off"): stops count from the person's last yes, so a new yes starts from 0
  return {ok: true};
}

/** Turn the switch off. LinkedIn jobs' switch and the pause stay as they are; the sign-in goes too when LinkedIn jobs is off (nothing uses it). Repeatable. */
export function turnOff(storage, {keychain} = {}) {
  save(storage, {on: false});
  if (!linkedinState(storage).on) forget(storage, keychain ? {keychain} : {});
  return {ok: true};
}
