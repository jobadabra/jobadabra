// LinkedIn Easy Apply's limits, plan 2/5 (spec docs/superpowers/specs/2026-11-13-linkedin-easy-apply-design.md; owner, 13 Nov 2026: D2 "15/day, 2 min apart (Recommended)", D3 "Stop 24 h"):
// whether the next send may go now, the one cap counter, and what a LinkedIn warning does. Callers: lib/easy-apply-batch.js asks turn() before it opens a job and notes every warning,
// checkpoint or sign-in page (noteStop); the Mac's Submit gate (lib/background-apply-store.js reserve) asks sendTurn() and notes every press of LinkedIn's send button (notePress).
// Settings: settings.easyApply.cap = {day, sent, lastAt} (day = the computer's local date; a new date starts at 0) and settings.easyApply.stops. The pause itself is LinkedIn's one shared pause
// (lib/linkedin-session.js notePause / pausedUntil), so a stop here also stops both LinkedIn reads, and their pause stops Easy Apply. Guard: test/unit/main/easy-apply-limits.test.js.
import {notePause, pausedUntil} from './linkedin-session.js';
import {state, turnOff as easyApplyOff} from './easy-apply-switch.js';

export const CAP = 15;                    // D2: at most 15 sends a day per install
export const GAP_MS = 2 * 60 * 1000;      // D2: at least 2 min between sends, a fixed gap (never a random human-like delay)
export const STOP_MS = 24 * 3600 * 1000;  // D3: any LinkedIn warning stops all LinkedIn work for 24 h
const STOPS_TO_OFF = 2;                   // D3: "A second stop turns the switch off"

const pad = number => String(number).padStart(2, '0');
/** The computer's local calendar date of `now`, as YYYY-MM-DD. */
export const localDay = now => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const nextLocalMidnight = now => new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
const mine = storage => storage.settings().easyApply || {};
const save = (storage, patch) => storage.saveSettings({easyApply: {...mine(storage), ...patch}});

/** Today's counter: {day, sent, lastAt}; another date reads as 0 sent (lastAt is kept for the gap across midnight). */
function counter(storage, now) {
  const cap = mine(storage).cap || {};
  return {day: localDay(now), sent: cap.day === localDay(now) ? Number(cap.sent) || 0 : 0, lastAt: String(cap.lastAt || '')};
}

/**
 * May a send start at `now` (a Date)? -> {go: true} | {wait: 'off'} | {wait: 'paused' | 'cap' | 'gap', until: epoch ms}.
 * Invariant, in this order: the switch (Easy Apply on and LinkedIn jobs on), the shared LinkedIn pause, 15 a local day, 2 min since the last press.
 */
export function turn(storage, now) {
  if (!state(storage).on) return {wait: 'off'};
  const paused = pausedUntil(storage);
  if (paused > now.getTime()) return {wait: 'paused', until: paused};
  const today = counter(storage, now);
  if (today.sent >= CAP) return {wait: 'cap', until: nextLocalMidnight(now)};
  const next = (Date.parse(today.lastAt) || 0) + GAP_MS;
  return next > now.getTime() ? {wait: 'gap', until: next} : {go: true};
}

/**
 * May the Mac's Full automation press send on LinkedIn for this queued item now? `item`: its store state (lib/background-apply-store.js). -> {go: true} | {wait: 'cap' | 'gap', until: epoch ms}
 * | {stop: 'linkedin_not_confirmed' | 'linkedin_send_off' | 'linkedin_send_paused'} (a stop hands the filled form to the person; a wait keeps it ready).
 * Why (14 Nov 2026, owner, plan 4b-1, asked via AskUserQuestion: "In the Full auto confirm (Recommended)"; D1 "Follow the Apply mode (Recommended)"): only an item carrying its own "LinkedIn may
 * send" stamp sends; the stop ids differ from lib/easy-apply-batch.js LINKEDIN_NOTICES, whose ids mean "never opened" there, while this form is open for the person.
 */
export function sendTurn(storage, item, now) {
  if (!item?.linkedinConfirmedAt) return {stop: 'linkedin_not_confirmed'};
  const next = turn(storage, now);
  return next.wait === 'off' || next.wait === 'paused' ? {stop: `linkedin_send_${next.wait}`} : next;
}

/** The controller pressed LinkedIn's send button at `now`: one more for today, whatever LinkedIn answers (a press is what LinkedIn sees, so a refused send counts too). */
export function notePress(storage, now) {
  const today = counter(storage, now);
  save(storage, {cap: {day: today.day, sent: today.sent + 1, lastAt: now.toISOString()}});
}

/**
 * LinkedIn warned (a warning, checkpoint, "unusual activity", sign-in page or 401/403/429/999) at `now`: all LinkedIn pauses 24 h through the shared pause, never retried;
 * the second stop since Easy Apply was last turned on turns it off (the pause stays). LinkedIn jobs' own switch is not touched. `countedTo`: the newest hand-off this stop covers
 * (the store's time; default `now`); `keychain` only for tests. -> {until: epoch ms, off}.
 */
export function noteStop(storage, now, countedTo = now.getTime(), {keychain} = {}) {
  const until = now.getTime() + STOP_MS;
  notePause(storage, new Date(until).toISOString());
  const stops = (Number(mine(storage).stops) || 0) + 1;
  const off = stops >= STOPS_TO_OFF;
  save(storage, {stops, stopAt: countedTo});
  if (off) easyApplyOff(storage, keychain ? {keychain} : {});   // Why (Gitar on #4271): the one off path, so with LinkedIn jobs off too the sign-in is deleted (both off)
  return {until, off};
}

/** The newest hand-off counted so far (epoch ms, the store's hand-off time; 0 = never): one at or before it was already counted, so one page never counts as two stops (lib/easy-apply-batch.js). */
export const stopNotedAt = storage => Number(mine(storage).stopAt) || 0;

/** Hand-offs up to `countedTo` (epoch ms) were seen during a pause already on: the same stop, so only the mark moves (no new pause, no stop counted). -> {until: 0, off: false}. */
export function noteCounted(storage, countedTo) {
  save(storage, {stopAt: Math.max(stopNotedAt(storage), countedTo)});
  return {until: 0, off: false};
}
