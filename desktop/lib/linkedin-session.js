// LinkedIn jobs on every Find jobs (owner, 31 Oct 2026: "Opt-in, warned once"; spec docs/superpowers/specs/2026-10-31-linkedin-headless-design.md): the switch, how often
// the person was asked, and the LinkedIn session the extension copied from their Chrome. The session is a credential: the Keychain only (lib/keychain.js, so a test or
// the twin writes its own file, never the owner's), never the settings file, a log, the store or an upload.
// Design (owner, 14 Nov 2026: "he must be able to enable each of them separately, but he should never login 2 times. Once logged in, then we should share it for the other"; asked via
// AskUserQuestion: "Yes, this design (Recommended)", then "Simplify, then reopen (Recommended)", then "One sign-in state (Recommended)" after Gitar's 3rd round on #4358): this module owns
// LinkedIn jobs' switch (`on`) and the ONE sign-in state (`login`, the Keychain item beside it). States: none (nothing kept) → waiting (a Chrome way opened while off; WANTED_MS, then none
// again) → kept (a copy kept: the window, the Chrome way, or a refresh). A Chrome sign-out deletes the item and writes none while the switch stays on, as before; "lost" (inactive on screen) is 5/5.
// A sign-in turns no switch on: the press that asked turns its own switch on once `kept`. Switching off deletes the sign-in (none); Easy Apply uses it only through LinkedIn jobs
// (lib/easy-apply-switch.js), so it goes off too. Settings: settings.linkedinJobs = {on, login: {state, at}, asked, declined, …} (not settings.linkedin: that is the profile import's,
// lib/linkedin-oauth.js). Guard: test/unit/main/linkedin-session.test.js.
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

export const WANTED_MS = SIGNIN_WAIT_MS;   // Why (Gitar on #4271, #4283): a Chrome way left unfinished must not let a much later copy in; it lasts exactly as long as the window's own watch
/** The one sign-in state: {state: 'none' | 'waiting' | 'kept', at} (epoch ms it began). A wait older than WANTED_MS reads as none (no stamp outlives it); an older install with no `login` reads from `on`. */
export function loginOf(storage, {now = Date.now} = {}) {
  const mine = storage.settings().linkedinJobs || {}, login = mine.login;
  if (!login) return {state: linkedinSignedIn(storage.settings()) ? 'kept' : 'none', at: 0};
  const at = Number(login.at) || 0;
  return login.state === 'waiting' && now() - at > WANTED_MS ? {state: 'none', at: 0} : {state: login.state, at};
}
const moveLogin = (storage, state, {now = Date.now} = {}) => save(storage, {login: {state, at: now()}});   // 'none' is written, not dropped: with no `login` an older install reads from `on`
/** True while a sign-in is kept (renderer/apply-settings-model.js linkedinSignedIn, the one rule). */
export const signedIn = storage => linkedinSignedIn(storage.settings());

/**
 * Store the copied session in the Keychain. It turns no switch on: the press that asked turns its own switch on once the sign-in is kept (the window's lib/linkedin-handlers.js,
 * or the Chrome watch in renderer/pages/linkedin-consent.js). -> {ok: true} | {ok: false, error}; the value is never in the answer.
 */
export function saveSession(storage, cookies, {keychain = realKeychain, now = Date.now} = {}) {
  const clean = cleanCookies(cookies);
  if (!clean) return {ok: false, error: 'No LinkedIn sign-in found. Sign in to LinkedIn, then try again.'};
  const before = readSession({keychain})?.li_at;   // in memory only: the same sign-in saved again keeps its clock, whatever the state it was in (Gitar on #4247, #4365)
  if (!keychain.write(SERVICE, JSON.stringify(clean), {account: ACCOUNT, label: 'Jobadabra: LinkedIn session'})) return {ok: false, error: 'The Keychain would not keep the LinkedIn sign-in, so LinkedIn jobs stays off.'};
  // Why (Gitar on #3914, 12 Nov 2026; keptAt 14 Nov 2026; owner 14 Nov 2026, "Simplify, then reopen (Recommended)" after Gitar on #4297, then "One sign-in state (Recommended)"): a sign-in
  // turns no switch on by itself; it moves `login` to kept. A saved copy is no verdict, so a `signin` a read wrote stays and only its keep time is stamped: the next read that works after Needs you says "renewed"
  save(storage, {login: {state: 'kept', at: now()}, ...(before === clean.li_at ? {} : {keptAt: new Date(now()).toISOString()})});
  return {ok: true};
}

/**
 * The extension's fresh copy at a Find jobs press (issue #2731). Only while a sign-in is kept. Cookies that pass replace the Keychain item (saveSession).
 * No usable li_at (the person signed out in Chrome): the copy is deleted, because it mirrors Chrome ("deleted ... on sign-out", spec Safety) and the step then says no-session.
 * `held` false (the extension no longer holds the LinkedIn grants, so it read nothing): the Keychain is left as it is. -> {ok, kept?}; the value is never in the answer.
 */
export function refreshSession(storage, cookies, {keychain = realKeychain, held = true, now = Date.now} = {}) {
  if (!takesCopy(storage, {now})) return {ok: false, error: 'No LinkedIn sign-in is kept'};   // Gitar on #4271, #4358: kept, or the switch on after a Chrome sign-out (a Chrome sign-in again brings it back)
  if (!held) return {ok: true, kept: true};
  const clean = cleanCookies(cookies);
  if (!clean) { keychain.remove(SERVICE, {account: ACCOUNT}); moveLogin(storage, 'none', {now}); save(storage, {keptAt: undefined}); return {ok: true, signedOut: true}; }   // the switch stays as it is, as on main; its "lost, inactive" look is 5/5 (owner, 14 Nov 2026: "Split the PR in two")
  return saveSession(storage, cookies, {keychain, now});
}

/** The copied session, or null (the reader of PR 2). */
export function readSession({keychain = realKeychain} = {}) {
  try { const value = JSON.parse(keychain.read(SERVICE, {account: ACCOUNT}) || 'null'); return cleanCookies(COOKIE_NAMES.filter(name => value?.[name]).map(name => ({name, value: value[name], domain: '.linkedin.com'}))); } catch { return null; }
}

const easyOn = storage => storage.settings().easyApply?.on === true;   // Easy Apply uses the sign-in too (owner, 14 Nov 2026: one sign-in, two switches)
/** True when a copy from the extension is taken, and so the extension keeps its LinkedIn grants: a Chrome way waits for it, a sign-in is kept, or LinkedIn jobs is on (a refresh, also after a Chrome sign-out). One rule, no second name (Gitar on #4380). */
export const takesCopy = (storage, deps = {}) => state(storage).on || easyOn(storage) || loginOf(storage, deps).state !== 'none';
/**
 * The Chrome way was opened with LinkedIn jobs off: the sign-in waits for its copy (WANTED_MS). A sign-in already kept with its item there stays as it is: the press turns its switch on
 * with it (owner, 14 Nov 2026: "he should never login 2 times"; Gitar on #4350, #4365: nothing is deleted, so an expired wait leaves no orphan and no working sign-in is lost).
 */
export const openSignin = (storage, deps = {}) => {
  if (state(storage).on || easyOn(storage) || (loginOf(storage, deps).state === 'kept' && readSession(deps))) return;
  moveLogin(storage, 'waiting', deps);
};

/**
 * At start, with LinkedIn jobs off: a sign-in no press can still turn on is deleted, so no unused credential stays (Gitar on #4350): a wait that ran out, or a copy kept more than
 * WANTED_MS ago (Gitar on #4354: a fresh one may still be turned on by the press that asked). Never while Easy Apply is on: it uses the sign-in.
 */
export function forgetUnused(storage, {keychain = realKeychain, now = Date.now} = {}) {
  const login = loginOf(storage, {now});
  if (state(storage).on || easyOn(storage) || !storage.settings().linkedinJobs?.login || login.state === 'waiting' || (login.state === 'kept' && now() - login.at <= WANTED_MS)) return;
  keychain.remove(SERVICE, {account: ACCOUNT});
  save(storage, {login: undefined, keptAt: undefined});
}

/** LinkedIn jobs on with the sign-in already kept (a Chrome copy that came after its window closed): nothing is asked. -> {ok: true} | {ok: false, reason: 'needs-signin'}. */
export function turnOn(storage, {keychain = realKeychain} = {}) {
  if (loginOf(storage).state !== 'kept' || !readSession({keychain})) return {ok: false, reason: 'needs-signin'};   // Gitar on #4334: the state alone is no sign-in; the Keychain item must be there too
  save(storage, {on: true});   // Gitar on #4368: the keep time `login.at` stays that of the copy
  return {ok: true};
}

/**
 * Switch off: the ask counters and the shared pause stay. The Keychain item and its mark go with it unless Easy Apply is on, which uses the same sign-in and keeps working (owner, 14 Nov 2026:
 * "Once logged in, then we should share it for the other"; replaces Gitar on #4008, where Easy Apply went off with LinkedIn jobs). Repeatable.
 */
export function turnOff(storage, {keychain = realKeychain} = {}) {
  // Why (13 Nov 2026, spec 2026-11-13-linkedin-easy-apply-design.md "One LinkedIn pause"; keptAt and the sign-in state cleared too, 14 Nov 2026; owner's D3: a warning "stops ALL LinkedIn work for 24 h"; lg agreed): the pause outlives the switch,
  // since the guest read runs while it is off (lib/linkedin-guest-on.js); a new yes starts with no old result, but LinkedIn's wait still holds.
  if (easyOn(storage)) { save(storage, {on: false, last: undefined, noticedAt: undefined}); return {ok: true}; }   // the sign-in and its mark stay for Easy Apply
  keychain.remove(SERVICE, {account: ACCOUNT});
  save(storage, {on: false, login: undefined, last: undefined, signin: undefined, noticedAt: undefined, keptAt: undefined});   // a waiting Chrome way ends with `login` (Gitar on #4340)
  return {ok: true};
}

// Design (#3911, owner, 12 Nov 2026: "Why I don't get any notification or feedback"): "is the person's LinkedIn sign-in working" has ONE owner, settings.linkedinJobs.signin, moved by a read's
// verdict (noteRun -> nextSignin). States: ok (Working, or nothing read yet) | needs-you with one reason: missing (no copy kept),
// signed-out, check (LinkedIn asked for a check), empty (two reads in a row loaded no page). The step line, the notice, the Settings card and ⌘K read signinView; a copied sign-in is no read verdict.
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
