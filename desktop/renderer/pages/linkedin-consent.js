// LinkedIn jobs on every Find jobs (owner, 31 Oct 2026, spec docs/superpowers/specs/2026-10-31-linkedin-headless-design.md): the ONE consent dialog behind every door (the Settings row, the ask on
// the 1st and 2nd Find jobs press, the Suggestions entry, ⌘K) and the window's copy of the switch's state. A sign-in door asks how (owner, 14 Nov 2026: "Ask, Chrome first"): "Continue" with the
// window way picked opens a Jobadabra window on LinkedIn's own page and the answer comes back when it ends; with the Chrome way picked (only while the extension is connected) it opens the
// extension's own consent page in Chrome instead, and this module watches until the app has the session (lib/linkedin-handlers.js). The window never holds a cookie.
// Invariants: one dialog at a time; the ask is counted when shown, "Not now" only from the ask; the words are renderer/linkedin-words.js. Guard: test/unit/renderer/linkedin-consent.test.js.
import '../../i18n/screens-pages.js';
import {t} from '../../i18n/index.js';
import {$} from './core.js';
import {CONSENT, askOnPress, notOpened, renewCommandOf, signInEnded} from '../linkedin-words.js';
import {NO_PLACE} from '../targets.js';
import {SIGNIN_WAIT_MS} from '../apply-settings-model.js';

export const view = {loaded: false, on: false, signedIn: false, asked: 0, declined: 0, ask: false, hasSession: false, extension: false, easyApply: false, signin: {state: 'ok', why: '', empties: 0}};
// Why (31 Oct 2026, push gate no-circular): startup.js imports the pages that import this module, so it hands its toast in (bindToast) instead of being imported here.
let toast = () => {};
/** Startup gives this module its toast function once; before that a message is dropped, never thrown. */
export const bindToast = fn => { toast = fn; };

/** Read the switch's state from the app; tells the pages (Settings row, Suggestions) when it changed. */
export async function refreshLinkedin() {
  const before = `${view.on}:${view.signedIn}:${view.signin?.state}`;
  Object.assign(view, await window.pilot.linkedinJobsState(), {loaded: true});
  if (before !== `${view.on}:${view.signedIn}:${view.signin?.state}`) window.dispatchEvent(new Event('linkedin-changed'));
  return view;
}
const WATCH_MS = 2000, WATCH_FOR_MS = SIGNIN_WAIT_MS;
let watching = false;
// The person finishes in Chrome: look every few seconds, for as long as the main side takes the copy (SIGNIN_WAIT_MS), until the sign-in is kept. Then the press that asked turns its own
// switch on (owner, 14 Nov 2026, "Simplify, then reopen (Recommended)": a sign-in turns no switch on by itself). -> true when the sign-in came (and, for LinkedIn jobs, it is on).
async function watchUntilSignedIn(wanted) {
  if (watching) return false;
  watching = true;
  const until = Date.now() + WATCH_FOR_MS;
  try {
    while (Date.now() < until && !view.signedIn) {
      await new Promise(done => setTimeout(done, WATCH_MS));
      await refreshLinkedin().catch(() => {});
    }
  } finally { watching = false; }
  if (view.signedIn) return wanted === 'jobs' ? turnOnKept() : true;
  if (wanted === 'easy-apply') toast(t('pagesEasyApply.stayedOff'), '', NO_PLACE.itself, 'warn');   // Gitar on #4276: the copy never came, so say Easy Apply stayed off
  return false;
}

// The default way in: a Jobadabra window on LinkedIn's own sign-in page (lib/linkedin-signin-window.js). The answer comes when the window ends, so no watching is needed.
let signingIn = false;   // Why (independent review, 3 Nov 2026): the dialog is closed while the window is open, so a Find jobs press must not ask again (and count a decline) meanwhile
// `wanted`: which switch asked ('jobs' | 'easy-apply' | 'renew'); LinkedIn jobs is turned on here once the sign-in is kept, Easy Apply by its own door. -> true when the sign-in was kept.
async function signInHere(wanted) {
  const renew = wanted === 'renew';
  signingIn = true;
  const answer = await window.pilot.linkedinJobsSignIn().catch(() => null);
  signingIn = false;
  await refreshLinkedin().catch(() => {});
  // Why (Gitar on #3914, 12 Nov 2026): a renewal is no "LinkedIn jobs is on" (it was on); the next read that works is what says "renewed", so this only says the copy is saved.
  if (answer?.ok && renew) toast(t('pagesLinkedinServices.savedTitle'), t('pagesLinkedinServices.savedBody'), NO_PLACE.itself, 'good');
  else if (answer?.ok && wanted === 'jobs') return turnOnKept();
  else if (!answer?.ok) toast(...signInEnded(answer, view));
  return !!answer?.ok;   // Easy Apply says its own "on" (pages/easy-apply-consent.js)
}

// The Chrome way, while the Chrome extension is connected: its own page in Chrome copies the sign-in Chrome already has. -> true when the sign-in arrived (waits for it, except a renewal).
async function turnOnWithChrome(wanted) {
  const opened = await window.pilot.linkedinJobsConnect().catch(() => null);
  if (!opened?.opened) { toast(...notOpened(opened)); return false; }
  toast(t('pagesFinalLabels.finishChrome'), t('pagesAuditPunct.a41'), NO_PLACE.itself, 'info');
  // Why (Gitar on #4265, 14 Nov 2026): Easy Apply's door goes on only once the copy has come, so its flow waits here instead of ending before it. A renewal has nothing to wait for (Gitar on #3914).
  return wanted === 'renew' ? false : watchUntilSignedIn(wanted);
}

async function turnOnKept() {
  const answer = await window.pilot.linkedinJobsOn().catch(() => null);
  await refreshLinkedin().catch(() => {});
  if (answer?.ok) toast(t('pagesFinalLabels.linkedinOn'), t('pagesAuditSecond.a127'), NO_PLACE.itself, 'good');
  return !!answer?.ok;
}

async function turnOff() {
  await window.pilot.linkedinJobsOff();
  await refreshLinkedin();
  toast(t('pagesFinalLabels.linkedinOff'), t('pagesAuditSecond.a128'), NO_PLACE.itself, 'info');
}

/**
 * Show the consent. mode: 'ask' (Find jobs press), 'turn-on' (Settings, Suggestions, ⌘K), 'manage' (it is on: Keep on / Turn off), 'renew' (#3911: sign in again) or 'easy-apply'
 * (Easy Apply's door with no sign-in kept: pages/easy-apply-consent.js). counts: "Not now" counts as an answer (the ask only).
 * -> a promise that resolves when the dialog closed and what it chose is done: true when the sign-in was kept (or LinkedIn jobs turned on, or off for Manage); false when it is already open.
 */
export function openLinkedinConsent({mode = 'turn-on', counts = false} = {}) {
  const kept = (mode === 'turn-on' || mode === 'ask') && view.signedIn;   // two switches, one sign-in (owner, 14 Nov 2026): a kept sign-in is never asked for again
  const words = kept ? CONSENT['turn-on-kept'] : CONSENT[mode] || CONSENT['turn-on'];
  const shown = showConsent(words, {chrome: !!(words.ways && view.extension)});   // the Chrome way can be picked only while the Chrome extension is connected
  if (!shown) return Promise.resolve(false);
  const wanted = mode === 'renew' ? 'renew' : mode === 'easy-apply' ? 'easy-apply' : 'jobs';
  return shown.then(async answer => {
    if (answer === 'chrome') return turnOnWithChrome(wanted);
    if (answer === 'default') return mode === 'manage' ? turnOff().then(() => true) : kept ? turnOnKept() : signInHere(wanted);
    if (counts) await window.pilot.linkedinJobsAnswer('not-now').catch(() => {});
    return false;
  });
}

/**
 * The one LinkedIn dialog, filled with `words` ({title, lead, line, yes, no, ways?}) and shown; LinkedIn Easy Apply (pages/easy-apply-consent.js) opens it too.
 * -> a promise of how it closed ('default' = yes (the window way when `ways` is shown), 'chrome' (yes with the Chrome way picked), '' or 'cancel'), or null when it is already open (one dialog at a time).
 */
export function showConsent(words, {chrome = false} = {}) {
  const dialog = $('linkedin-dialog');
  if (dialog.open) return null;
  $('linkedin-title').textContent = words.title;
  $('linkedin-lead').textContent = words.lead;
  $('linkedin-line').textContent = words.line;
  $('linkedin-line-box').hidden = !words.line;
  $('linkedin-yes').textContent = words.yes;
  $('linkedin-no').textContent = words.no;
  const ways = !!words.ways;
  $('linkedin-ways').hidden = !ways;
  if (ways) showWays(words.ways, chrome);
  dialog.returnValue = '';
  return new Promise(resolve => {
    dialog.addEventListener('close', () => resolve(ways && dialog.returnValue === 'default' && $('linkedin-way-chrome').checked ? 'chrome' : dialog.returnValue), {once: true});
    dialog.showModal();
  });
}
// The two ways to sign in (renderer/linkedin-words.js WAYS). Chrome is picked first while the extension is connected; without it, that way is shown off with what it needs.
function showWays(ways, chrome) {
  $('linkedin-ways-title').textContent = ways.title;
  $('linkedin-way-chrome-title').textContent = ways.chrome;
  $('linkedin-way-chrome-note').textContent = chrome ? ways.chromeNote : ways.chromeMissing;
  $('linkedin-way-window-title').textContent = ways.window;
  $('linkedin-way-window-note').textContent = ways.windowNote;
  $('linkedin-way-chrome').disabled = !chrome;
  $('linkedin-way-chrome').checked = chrome;
  $('linkedin-way-window').checked = !chrome;
}
/** A toast through the function startup bound (bindToast), for the Easy Apply flow that shares this dialog. */
export const say = (...args) => toast(...args);

/** Every Find jobs press calls this (pages/jobs.js startSearch): on the 1st and 2nd press while off, one dialog. Never blocks the search. */
export async function askLinkedinOnPress(why) {
  const mine = await refreshLinkedin().catch(() => null);
  if (!askOnPress(mine, why) || signingIn || $('linkedin-dialog').open) return false;
  await window.pilot.linkedinJobsAsked();
  await openLinkedinConsent({mode: 'ask', counts: true});
  await refreshLinkedin().catch(() => {});
  return true;
}

/** The ⌘K command for the switch (pages/nav.js): "Turn on LinkedIn jobs" while off, "Turn off LinkedIn jobs" while on; it opens the same consent as every door. */
export function linkedinCommand() {
  const mode = view.on ? 'manage' : 'turn-on';
  return {label: view.on ? t('pagesLinkedinServices.turnOff') : t('pagesLinkedinServices.turnOn'), hint: t('pagesLinkedinServices.searchLinkedin'), keywords: 'linkedin jobs search background sign in connection', run: () => openLinkedinConsent({mode})};
}

/** The ⌘K command "Renew LinkedIn sign-in" (pages/nav.js) while LinkedIn jobs is on, else null; it opens the renew dialog, the same one the card's Renew opens. */
export const linkedinRenewCommand = () => renewCommandOf(view, () => openLinkedinConsent({mode: 'renew'}));

/** Adds the LinkedIn jobs commands to ⌘K through `add(group, label, hint, keywords, run)` (pages/nav.js): the switch's, then "Renew LinkedIn sign-in" while it is on. */
export function addLinkedinCommands(add) {
  for (const command of [linkedinCommand(), linkedinRenewCommand()]) if (command) add('Settings', command.label, command.hint, command.keywords, command.run);
}
