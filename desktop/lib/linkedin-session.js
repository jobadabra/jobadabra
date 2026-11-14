// LinkedIn jobs on every Find jobs (owner, 31 Oct 2026: "Opt-in, warned once"; spec docs/superpowers/specs/2026-10-31-linkedin-headless-design.md): the switch, how often
// the person was asked, and the LinkedIn session the extension copied from their Chrome. The session is a credential: the Keychain only (lib/keychain.js, so a test or
// the twin writes its own file, never the owner's), never the settings file, a log, the store or an upload.
// Design (owner, 14 Nov 2026: "he must be able to enable each of them separately, but he should never login 2 times. Once logged in, then we should share it for the other"; asked via
// AskUserQuestion: "Yes, this design (Recommended)", then "Fold the split in (Recommended)"): two switches, one sign-in. This module owns the sign-in (the Keychain item + `signedIn`) and
// LinkedIn jobs' switch (`on`); lib/easy-apply-switch.js owns Easy Apply's. A sign-in turns no switch on: the press that asked turns its own switch on once it is kept (owner, 14 Nov 2026); either switch turned on while a sign-in is kept
// asks for none; the sign-in is deleted only when both switches are off (forget). Settings: settings.linkedinJobs = {on, signedIn, asked, declined, …} (not settings.linkedin: that is the
// profile import's, lib/linkedin-oauth.js). Guards: test/unit/main/linkedin-session.test.js, test/unit/main/easy-apply-switch.test.js.
import * as realKeychain from './keychain.js';
import {log as appLog} from './log.js';
import {linkedinSignedIn, SIGNIN_WAIT_MS} from '../renderer/apply-settings-model.js';

export const SERVICE = realKeychain.TWIN_LINKEDIN_SESSION;   // one owner of the item's name: lib/keychain.js (Gitar on #4246)
export const ACCOUNT = 'linkedin-jobs';
export const COOKIE_NAMES = ['li_at', 'JSESSIONID'];   // the only two LinkedIn cookies that carry the sign-in; nothing else is read, sent or kept
export const MAX_ASKS = 2;                             // owner, 31 Oct 2026: "for the first, or for the second time"
const VALUE = /^[\x21-\x7e]{1,2048}$/;                 // one printable token (JSESSIONID keeps its quotes)

const onLinkedin = domain => { const host = String(domain || '').replace(/^\./, '').toLowerCase(); return host === 'linkedin.com' || host.endsWith('.linkedin.com'); };

/** The switch and the ask counters, always the same three keys. */
export function state(storage) {
  const mine = storage.settings().linkedinJobs || {};
  return {on: mine.on === true, asked: Math.min(MAX_ASKS, Number(mine.asked) || 0), declined: Math.min(MAX_ASKS, Number(mine.declined) || 0)};
}
// Why (31 Oct 2026, LinkedIn jobs 2/3): the object also holds the last run and a pause; a write of the switch or a counter must keep them.
const save = (storage, patch) => storage.saveSettings({linkedinJobs: {...(storage.settings().linkedinJobs || {}), ...state(storage), ...patch}});

/** Reduce what the extension sent to {li_at, JSESSIONID?}, or null. Invariant: only the allow-listed names of linkedin.com with a plain token value pass; li_at is required. */
export function cleanCookies(list) {
  if (!Array.isArray(list)) return null;
  const kept = {};
  for (const item of list) {
    if (!item || !COOKIE_NAMES.includes(item.name) || !onLinkedin(item.domain) || typeof item.value !== 'string' || !VALUE.test(item.value)) continue;
    kept[item.name] ??= item.value;
  }
  return kept.li_at ? Object.fromEntries(COOKIE_NAMES.filter(name => kept[name]).map(name => [name, kept[name]])) : null;
}

/** True while a sign-in is kept for either switch (renderer/apply-settings-model.js linkedinSignedIn, the one rule). */
export const signedIn = storage => linkedinSignedIn(storage.settings());

/**
 * Store the copied session in the Keychain. It turns no switch on: the press that asked turns its own switch on once the sign-in is kept (renderer/pages/linkedin-consent.js,
 * pages/easy-apply-consent.js). -> {ok: true} | {ok: false, error}; the value is never in the answer.
 */
export function saveSession(storage, cookies, {keychain = realKeychain, now = Date.now} = {}) {
  const clean = cleanCookies(cookies);
  if (!clean) return {ok: false, error: 'No LinkedIn sign-in found. Sign in to LinkedIn, then try again.'};
  const before = signedIn(storage) ? readSession({keychain})?.li_at : undefined;   // in memory only: the same sign-in saved again keeps its clock (Gitar on #4247)
  if (!keychain.write(SERVICE, JSON.stringify(clean), {account: ACCOUNT, label: 'Jobadabra: LinkedIn session'})) return {ok: false, error: 'The Keychain would not keep the LinkedIn sign-in, so LinkedIn jobs stays off.'};
  const byChrome = storage.settings().linkedinJobs?.signedOutByChrome === true;   // Gitar on #4297: a Needs you the Chrome sign-out wrote (no read did) is ended by the next sign-in itself
  save(storage, {signedIn: true, copiedAt: now(), signedOutByChrome: undefined, ...(byChrome ? {signin: undefined} : {}), ...(before === clean.li_at ? {} : {keptAt: new Date(now()).toISOString()})});
  // Why (Gitar on #3914, 12 Nov 2026; keptAt 14 Nov 2026; owner 14 Nov 2026, "Simplify, then reopen (Recommended)" after Gitar on #4297): a sign-in turns no switch on by itself; a saved
  // copy is no verdict, so a `signin` a read wrote stays and only its keep time is stamped: the next read that works after Needs you is what says "renewed"
  return {ok: true};
}

/**
 * The extension's fresh copy at a Find jobs press (issue #2731). Only while the switch is on (a copy never arrives with it off). Cookies that pass: replace the Keychain item.
 * No usable li_at (the person signed out in Chrome): the copy is deleted, because it mirrors Chrome ("deleted ... on sign-out", spec Safety) and the step then says no-session.
 * `held` false (the extension no longer holds the LinkedIn grants, so it read nothing): the Keychain is left as it is. -> {ok, kept?}; the value is never in the answer.
 */
export function refreshSession(storage, cookies, {keychain = realKeychain, held = true, now = Date.now} = {}) {
  if (!signedIn(storage)) return {ok: false, error: 'No LinkedIn sign-in is kept'};   // Gitar on #4271: Easy Apply alone keeps one too
  if (!held) { save(storage, {copiedAt: now()}); return {ok: true, kept: true}; }   // the extension answered: no new ask for 12 h (copyIsOld)
  const clean = cleanCookies(cookies);
  if (!clean) { keychain.remove(SERVICE, {account: ACCOUNT}); save(storage, {signedIn: false, keptAt: undefined, copiedAt: undefined, ...(state(storage).on ? {signin: nextSignin(signinView(storage), 'signed-out'), signedOutByChrome: true} : {})}); return {ok: true, signedOut: true}; }   // the mark goes with the item (Gitar on #4271); On with nothing kept is Needs you, Sign in again (Gitar on #4283)
  const before = readSession({keychain})?.li_at;   // compared in memory only: a copy of the same sign-in is no new sign-in
  if (!keychain.write(SERVICE, JSON.stringify(clean), {account: ACCOUNT, label: 'Jobadabra: LinkedIn session'})) return {ok: false, error: 'The Keychain would not keep the LinkedIn sign-in'};
  save(storage, {copiedAt: now(), ...(before !== clean.li_at ? {keptAt: new Date(now()).toISOString()} : {})});
  return {ok: true};
}

/** The copied session, or null (the reader of PR 2). */
export function readSession({keychain = realKeychain} = {}) {
  try { const value = JSON.parse(keychain.read(SERVICE, {account: ACCOUNT}) || 'null'); return cleanCookies(COOKIE_NAMES.filter(name => value?.[name]).map(name => ({name, value: value[name], domain: '.linkedin.com'}))); } catch { return null; }
}

export const WANTED_MS = SIGNIN_WAIT_MS;   // Why (Gitar on #4271, #4283): a Chrome way left unfinished must not let a much later copy in; it lasts exactly as long as the window's own watch
/** The Chrome way was opened: the extension's copy is taken while the window still waits for it. It names no switch (owner, 14 Nov 2026: a sign-in turns no switch on). */
export const openSignin = (storage, {now = Date.now} = {}) => save(storage, {wanted: undefined, signinOpenAt: now()});
/** True while a Chrome way opened in the last WANTED_MS waits for its copy. */
export const signinOpen = (storage, {now = Date.now} = {}) => now() - (Number(storage.settings().linkedinJobs?.signinOpenAt) || 0) <= WANTED_MS;
/** The copy was kept: the open Chrome way is done. */
export const closeSignin = storage => save(storage, {wanted: undefined, wantedAt: undefined, signinOpenAt: undefined});

// Why (Gitar on #4276): a sign-in kept for Easy Apply alone gets no Find jobs press to ask for a fresh copy, so the extension's own minute look asks once the last copy is this old.
export const COPY_AGE_MS = 12 * 3600000;
/** True when a sign-in is kept and the extension last answered a copy (or the sign-in was kept) over 12 h ago. */
export const copyIsOld = (storage, {now = Date.now} = {}) => signedIn(storage) && now() - (Number(storage.settings().linkedinJobs?.copiedAt) || 0) > COPY_AGE_MS;

/** LinkedIn jobs on with the sign-in already kept (it was signed in for Easy Apply): nothing is asked. -> {ok: true} | {ok: false, reason: 'needs-signin'}. */
export function turnOn(storage) {
  if (!signedIn(storage)) return {ok: false, reason: 'needs-signin'};
  save(storage, {on: true, signedIn: true});
  return {ok: true};
}

/** LinkedIn jobs off: the ask counters and the shared pause stay; the sign-in goes only when Easy Apply is off too (forget). Repeatable. */
export function turnOff(storage, {keychain = realKeychain} = {}) {
  // Why (13 Nov 2026, spec 2026-11-13-linkedin-easy-apply-design.md "One LinkedIn pause"; owner's D3: a warning "stops ALL LinkedIn work for 24 h"; lg agreed): the pause outlives the switch,
  // since the guest read runs while it is off (lib/linkedin-guest-on.js); a new yes starts with no old result, but LinkedIn's wait still holds.
  save(storage, {on: false, signedIn: signedIn(storage), last: undefined, noticedAt: undefined});   // the mark is written before `on` goes, so an older sign-in stays kept for Easy Apply
  if (storage.settings().easyApply?.on !== true) forget(storage, {keychain});
  return {ok: true};
}

/** At start: a sign-in kept with both switches off (a sign-in whose press never turned its switch on, the window closed meanwhile) is deleted (Gitar on #4297). */
export function forgetUnused(storage, {keychain = realKeychain} = {}) {
  if (signedIn(storage) && !state(storage).on && storage.settings().easyApply?.on !== true) forget(storage, {keychain});
}

/** Delete the kept sign-in (both switches are off): the Keychain item, its mark, its state and its keep time. Writes no switch. */
export function forget(storage, {keychain = realKeychain} = {}) {
  keychain.remove(SERVICE, {account: ACCOUNT});
  save(storage, {signedIn: false, signin: undefined, signedOutByChrome: undefined, keptAt: undefined, copiedAt: undefined});
}

// Design (#3911, owner, 12 Nov 2026: "Why I don't get any notification or feedback"): "is the person's LinkedIn sign-in working" has ONE owner, settings.linkedinJobs.signin, moved only by a read's
// verdict (noteRun -> nextSignin). States: ok (Working, or nothing read yet) | needs-you with one reason: missing (no copy kept), signed-out (LinkedIn showed its sign-in page), check (LinkedIn asked for a
// check), empty (two reads in a row loaded no page). The step line, the notice, the Settings card and ⌘K all read signinView; the extension's copy at a press is no verdict (it feeds the read).
// Why (12 Nov 2026, #3911, evidence #3710 of 10 Nov): one empty read is not "dead": a working signed-in session also got all searches failed once (the reader could not read the results page), so only a 2nd in a row is Needs you.
const NEEDS = {'no-session': 'missing', 'signed-out': 'signed-out', check: 'check'};
const WORKING = {state: 'ok', why: '', empties: 0};
/** The sign-in state of a stored `signin` (or none). Always the same three keys. */
export const signinView = storage => ({...WORKING, ...(storage.settings().linkedinJobs?.signin || {})});
/** Pure: the state after one read's verdict. done -> ok; no-session / signed-out / check -> needs-you; failed -> one more empty, the 2nd is needs-you; anything else (stopped, limited, no-browser) changes nothing. */
export function nextSignin(prev, verdict) {
  if (verdict === 'done') return WORKING;
  if (NEEDS[verdict]) return {state: 'needs-you', why: NEEDS[verdict], empties: 0};
  if (verdict !== 'failed') return prev;
  const empties = (prev.empties || 0) + 1;
  return empties >= 2 ? {state: 'needs-you', why: 'empty', empties} : {...prev, empties};
}

/**
 * The one writer of a run's result (the step's verdict): {state, jobs, at} kept as `last`; a 429 also keeps `pauseUntil` (an ISO time); the sign-in state moves by nextSignin. Never a cookie.
 * -> {event, why}: 'needs-you' (this press ended in Needs you: raise the notice, again at every such press), 'renewed' (Needs you, then a read that worked), or null; always null while the switch is off.
 */
export function noteRun(storage, {state: verdict, jobs = 0, at, pauseUntil}, {log = appLog} = {}) {
  const prev = signinView(storage), next = nextSignin(prev, String(verdict)), live = state(storage).on;
  const ended = live && ENDED_BY_LINKEDIN.has(String(verdict)) ? endedAfter(storage, at) : null;
  save(storage, {last: {state: String(verdict), jobs: Number(jobs) || 0, at: String(at)}, ...(pauseUntil ? laterPause(storage, pauseUntil) : {}), ...(live ? {signin: next} : {}), ...(ended ? {keptAt: undefined} : {})});
  if (ended) log('linkedin-jobs', 'sign-in ended by LinkedIn', {why: String(verdict), hours: ended.hours});
  if (!live) return {event: null, why: ''};
  if (verdict === 'done' && prev.state === 'needs-you') return {event: 'renewed', why: ''};
  const told = next.state === 'needs-you' && (NEEDS[verdict] || verdict === 'failed');
  return told ? {event: 'needs-you', why: next.why} : {event: null, why: ''};
}
// Why (14 Nov 2026, owner, asked via AskUserQuestion: "Measure, then Chrome-first (Recommended)", after "If the user needs to retype user and pass every few hours, or every few days
// that's bad UX"): how long a kept sign-in lasts before LinkedIn ends it. `keptAt` is when the sign-in was kept (never a value); the first read that meets LinkedIn's sign-in page
// or a check says the hours once, in the app's log, and clears it.
const ENDED_BY_LINKEDIN = new Set(['signed-out', 'check']);
const endedAfter = (storage, at) => {
  const since = Date.parse(storage.settings().linkedinJobs?.keptAt || ''), end = Date.parse(at || '');
  return Number.isFinite(since) && Number.isFinite(end) && end >= since ? {hours: Math.round((end - since) / 3600000)} : null;
};
/** When (epoch ms, 0 = never) the last "needs you" notice was raised (lib/linkedin-notice.js: one a day). */
export const noticedAt = storage => Number(storage.settings().linkedinJobs?.noticedAt) || 0;
/** Remember when a "needs you" notice was raised (`at` epoch ms), or forget it (`at` 0, after "renewed": the next failure is told at once). Writes only that key; the other linkedinJobs keys stay. */
export const noteNoticed = (storage, at) => save(storage, {noticedAt: at || undefined});
// Why (13 Nov 2026, spec "One LinkedIn pause"; lg agreed): a later, shorter pause never shortens a longer one, whichever LinkedIn step writes it (guest read, signed-in read, Easy Apply).
const laterPause = (storage, until) => (Date.parse(until || '') > pausedUntil(storage) ? {pauseUntil: String(until)} : {});
/** The shared LinkedIn pause (an ISO time `until`), for every LinkedIn step: written only when later than the stored one; writes no `last` and no sign-in state (Gitar on #3998). Returns nothing. */
export const notePause = (storage, until) => save(storage, laterPause(storage, until));
/** Epoch ms until which LinkedIn is left alone (LinkedIn asked us to slow down or warned), or 0. */
export const pausedUntil = storage => Date.parse(storage.settings().linkedinJobs?.pauseUntil || '') || 0;

/** The ask on Find jobs: the 1st and 2nd press while off; never after On, two "Not now" or two asks. */
export const shouldAsk = mine => !mine.on && mine.asked < MAX_ASKS && mine.declined < MAX_ASKS;

/** The dialog was shown. Why (owner, 31 Oct 2026): the dialog's verdicts are the only writers of these counters, so "asked twice" cannot drift. */
export function noteAsked(storage) { const mine = state(storage); save(storage, {asked: Math.min(MAX_ASKS, mine.asked + 1)}); }
/** The person's answer to the ask: 'not-now' counts one decline (capped at 2), 'on' changes nothing (the session's arrival turns the switch on); any other word throws. */
export function noteAnswer(storage, answer) {
  if (answer === 'on') return;
  if (answer !== 'not-now') throw new Error(`unknown answer: ${answer}`);
  save(storage, {declined: Math.min(MAX_ASKS, state(storage).declined + 1)});
}
