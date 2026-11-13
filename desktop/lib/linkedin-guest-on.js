// Whether Find jobs reads LinkedIn's public (logged-out) job search in this app, and the shared pause its slow-down sets (spec docs/superpowers/specs/2026-11-13-linkedin-guest-search-design.md).
// Why (owner, 13 Nov 2026, asked via AskUserQuestion): "On each person's Mac (Recommended)" (an installed build, never from source, CI or a test, as EURES: lib/eures-on.js); "Public for all, sign-in
// replaces (Recommended)" (the signed-in switch on: lib/linkedin-headless.js reads instead, so one press never reads LinkedIn twice from one address); "Shared 1-day pause (Recommended)" (a 429/999
// on either read pauses both: lib/linkedin-session.js pausedUntil, one copy). The engine reads (src/sources/linkedin_guest.py) and says SLOW_DOWN once when LinkedIn asks; this file is the app's one owner of the rest.
import {reportingOff} from './telemetry.js';
import * as linkedinSession from './linkedin-session.js';

/** The engine's line when LinkedIn asks to slow down (src/sources/linkedin_guest.py SLOW_DOWN; pinned by test/unit/main/linkedin-guest-on.test.js). */
export const SLOW_DOWN = 'LinkedIn asked us to slow down';
const DAY_MS = 24 * 3600 * 1000;

/**
 * True when this press reads LinkedIn's public search.
 * @param {object} storage the app's storage (settings().linkedinJobs)
 * @param {object} env the app's own environment
 * @param {{packaged?: boolean, now?: number}} build `packaged`: an installed build (Electron's app.isPackaged); `now`: epoch ms
 * @returns {boolean}
 */
export function guestOn(storage, env = process.env, {packaged = false, now = Date.now()} = {}) {
  return packaged && !reportingOff(env, {packaged}) && !linkedinSession.state(storage).on && linkedinSession.pausedUntil(storage) <= now;
}

/** The engine's switch for one run, `{JOBADABRA_LINKEDIN_GUEST: '1'}` or nothing (lib/pipeline-env.js spreads it). */
export const guestEnv = (storage, env, build) => (guestOn(storage, env, build) ? {JOBADABRA_LINKEDIN_GUEST: '1'} : {});

/**
 * Wraps a search's line callback: every line goes on as it was; the engine's slow-down line also pauses both LinkedIn reads a day (linkedin-session notePause: the pause only,
 * never the signed-in read's result or sign-in state; Gitar on #3998).
 * @param {object} storage the app's storage
 * @param {(line: string) => void} onLine the search's own line callback
 * @param {() => number} now epoch ms
 * @returns {(line: string) => void}
 */
export function watchGuest(storage, onLine, now = Date.now) {
  return line => {
    if (String(line).startsWith(SLOW_DOWN)) linkedinSession.notePause(storage, new Date(now() + DAY_MS).toISOString());
    onLine(line);
  };
}
