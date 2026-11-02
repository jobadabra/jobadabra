// The moments a dialog offers Always on (spec docs/superpowers/specs/2026-11-02-always-on-moments-design.md): today one, a scheduled check that did not run because this Mac was asleep or off.
// The app notes it when it starts or wakes (before the catch-up search), the window asks next() and shows the dialog once. Guard: test/always-on-moments.test.js.
// The state of "shown" lives in settings.hostedSearch.moments, next to `skipped` (one owner; lib/hosted-search.js keeps the rest of that object).
import {nextAt} from './schedule.js';

// Why (2 Nov 2026): the schedule ticks every 10 minutes and announces a search a minute ahead (lib/schedule.js), so a Mac that was awake with the app open starts it within ~11 minutes; later than 30 means it was not running.
export const MISSED_GRACE_MS = 30 * 60 * 1000;

/** When this Mac's own scheduled search was due and did not start in time: {at: ms}, or null (not due, in setup, GitHub Always on runs it, searches only when asked). */
export function missedCheck(settings, now = Date.now()) {
  const due = nextAt(settings);
  return due != null && now - due > MISSED_GRACE_MS ? {at: due} : null;
}

/**
 * -> {note(now), next(), shown(moment, now)}. Invariants: a moment opens at most once for the install (`moments[name]` is set when it opens and never cleared, not even by Turn off or a delete);
 * never while Always on is on, nor when `available()` is false (no in-house key: the site would refuse it); a check noted stays offered until shown, whether or not the catch-up search made it up.
 */
export function createMoments(storage, {available = () => true} = {}) {
  let missed = null;
  const mine = () => storage.settings().hostedSearch || {};
  return {
    note(now = Date.now()) { const found = missedCheck(storage.settings(), now); if (found && !missed) missed = found; },
    next() {
      if (!missed || mine().on || !available() || mine().moments?.missed) return null;
      return {moment: 'missed', at: new Date(missed.at).toISOString()};
    },
    shown(moment, now = Date.now()) {
      const state = mine();
      storage.saveSettings({hostedSearch: {...state, moments: {...state.moments, [moment]: new Date(now).toISOString()}}});
    },
  };
}
