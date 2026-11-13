// LinkedIn Easy Apply's limits, plan 2/5 (spec docs/superpowers/specs/2026-11-13-linkedin-easy-apply-design.md; owner, 13 Nov 2026: D2 "15/day, 2 min apart (Recommended)", D3 "Stop 24 h"):
// whether the next send may go now, the one cap counter, and what a LinkedIn warning does. The Easy Apply controller (plan 4/5) is the only caller: it asks turn() before it opens a job,
// notes every press of LinkedIn's send button, and notes every warning, checkpoint, sign-in page or 401/403/429/999.
// Settings: settings.easyApply.cap = {day, sent, lastAt} (day = the computer's local date; a new date starts at 0) and settings.easyApply.stops. The pause itself is LinkedIn's one shared pause
// (lib/linkedin-session.js notePause / pausedUntil), so a stop here also stops both LinkedIn reads, and their pause stops Easy Apply. Guard: test/unit/main/easy-apply-limits.test.js.
import {notePause, pausedUntil} from './linkedin-session.js';
import {state} from './easy-apply-switch.js';

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

/** The controller pressed LinkedIn's send button at `now`: one more for today, whatever LinkedIn answers (a press is what LinkedIn sees, so a refused send counts too). */
export function notePress(storage, now) {
  const today = counter(storage, now);
  save(storage, {cap: {day: today.day, sent: today.sent + 1, lastAt: now.toISOString()}});
}

/**
 * LinkedIn warned (a warning, checkpoint, "unusual activity", sign-in page or 401/403/429/999) at `now`: all LinkedIn pauses 24 h through the shared pause, never retried;
 * the second stop since Easy Apply was last turned on turns it off (the pause stays). LinkedIn jobs' own switch is not touched. -> {until: epoch ms, off}.
 */
export function noteStop(storage, now) {
  const until = now.getTime() + STOP_MS;
  notePause(storage, new Date(until).toISOString());
  const stops = (Number(mine(storage).stops) || 0) + 1;
  const off = stops >= STOPS_TO_OFF;
  save(storage, {stops, ...(off ? {on: false} : {})});
  return {until, off};
}
