// LinkedIn Easy Apply's switch, plan 1/5 (spec docs/superpowers/specs/2026-11-13-linkedin-easy-apply-design.md, D4 "Full text (Recommended)"): off by default; the owner's warning is shown
// once, the first time it is turned on; on only while a LinkedIn sign-in is kept (owner, 14 Nov 2026: each switch on its own, one shared sign-in; replaces "LinkedIn jobs first" of 13 Nov 2026).
// Settings: settings.easyApply = {on, warnedAt}. Invariant: nothing here writes settings.linkedinJobs, so turning Easy Apply off keeps LinkedIn's shared 24 h pause and its session (spec "One LinkedIn pause").
// Guard: test/unit/main/easy-apply-switch.test.js.
import {readSession, signedIn, state as linkedinState} from './linkedin-session.js';
import * as realKeychain from './keychain.js';
import {easyApplyOn} from '../renderer/apply-settings-model.js';   // the one rule, shared with the window's Full automation confirmation

/** The saved switch, read through the sign-in: with none kept Easy Apply reads as off whatever was saved. Always the same two keys. */
export function state(storage) {
  const settings = storage.settings();
  return {on: easyApplyOn(settings), warnedAt: String(settings.easyApply?.warnedAt || '')};
}
const save = (storage, patch) => storage.saveSettings({easyApply: {...(storage.settings().easyApply || {}), ...patch}});

/** What the window draws. `offered`: the row and ⌘K entry exist. Why (owner, 13 Nov 2026: "Dev builds only until 4/5"): nothing sends before the controller (plan 4/5), so a packaged build shows no switch that does nothing. */
export const viewOf = (storage, {packaged}) => {
  const mine = state(storage);
  return {on: mine.on, linkedinOn: linkedinState(storage).on, warned: !!mine.warnedAt, offered: !packaged};
};

/**
 * Turn the switch on. `warned`: the window showed the owner's warning and the person pressed Turn on. -> {ok: true} | {ok: false, reason: 'not-offered' | 'needs-signin' | 'not-warned'}.
 * Invariant: the first turn-on is refused without `warned`; its time is kept as warnedAt and never moved, so the warning is shown once.
 */
export function turnOn(storage, {warned = false, now = new Date(), packaged = false, keychain = realKeychain} = {}) {
  if (packaged) return {ok: false, reason: 'not-offered'};
  if (!signedIn(storage) || !readSession({keychain})) return {ok: false, reason: 'needs-signin'};   // the state alone is no sign-in: the Keychain item must be there too (as lib/linkedin-session.js turnOn)
  const warnedAt = state(storage).warnedAt || (warned ? now.toISOString() : '');
  if (!warnedAt) return {ok: false, reason: 'not-warned'};
  save(storage, {on: true, warnedAt, stops: 0});   // Why (13 Nov 2026, D3 "a second stop turns the switch off"): stops count from the person's last yes, so a new yes starts from 0
  return {ok: true};
}

/** Turn the switch off. Only settings.easyApply.on changes: LinkedIn jobs, its session and its pause stay as they are. Repeatable. */
export function turnOff(storage) {
  save(storage, {on: false});
  return {ok: true};
}
