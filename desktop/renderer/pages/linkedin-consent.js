// LinkedIn jobs on every Find jobs (owner, 31 Oct 2026, spec docs/superpowers/specs/2026-10-31-linkedin-headless-design.md): the ONE consent dialog behind every door (the Settings row, the ask on
// the 1st and 2nd Find jobs press, the Suggestions entry, ⌘K) and the window's copy of the switch's state. "Sign in to LinkedIn" opens a Jobadabra window on LinkedIn's own page and the answer
// comes back when it ends; "Use my Chrome sign-in" (only while the extension is connected) opens the extension's own consent page in Chrome instead, and this module watches until the app
// has the session (lib/linkedin-handlers.js). The window never holds a cookie.
// Invariants: one dialog at a time; the ask is counted when shown, "Not now" only from the ask; the words are renderer/linkedin-words.js. Guard: test/unit/renderer/linkedin-consent.test.js.
import '../../i18n/screens-pages.js';
import {t} from '../../i18n/index.js';
import {$} from './core.js';
import {CONSENT, askOnPress, notOpened, renewCommandOf, signInEnded} from '../linkedin-words.js';
import {NO_PLACE} from '../targets.js';

export const view = {loaded: false, on: false, asked: 0, declined: 0, ask: false, hasSession: false, extension: false, signin: {state: 'ok', why: '', empties: 0}};
// Why (31 Oct 2026, push gate no-circular): startup.js imports the pages that import this module, so it hands its toast in (bindToast) instead of being imported here.
let toast = () => {};
/** Startup gives this module its toast function once; before that a message is dropped, never thrown. */
export const bindToast = fn => { toast = fn; };

/** Read the switch's state from the app; tells the pages (Settings row, Suggestions) when it changed. */
export async function refreshLinkedin() {
  const before = `${view.on}:${view.signin?.state}`;
  Object.assign(view, await window.pilot.linkedinJobsState(), {loaded: true});
  if (before !== `${view.on}:${view.signin?.state}`) window.dispatchEvent(new Event('linkedin-changed'));
  return view;
}
const WATCH_MS = 2000, WATCH_FOR_MS = 150000;
let watching = false;
// The person finishes in Chrome: look every few seconds, for a couple of minutes, until the app has the session.
async function watchUntilOn() {
  if (watching) return;
  watching = true;
  const until = Date.now() + WATCH_FOR_MS;
  try {
    while (Date.now() < until && !view.on) {
      await new Promise(done => setTimeout(done, WATCH_MS));
      await refreshLinkedin().catch(() => {});
    }
  } finally { watching = false; }
  if (view.on) toast(t('pagesFinalLabels.linkedinOn'), t('pagesAuditSecond.a127'), NO_PLACE.itself, 'good');
}

// The default way in: a Jobadabra window on LinkedIn's own sign-in page (lib/linkedin-signin-window.js). The answer comes when the window ends, so no watching is needed.
let signingIn = false;   // Why (independent review, 3 Nov 2026): the dialog is closed while the window is open, so a Find jobs press must not ask again (and count a decline) meanwhile
async function signInHere(renew = false) {
  signingIn = true;
  const answer = await window.pilot.linkedinJobsSignIn().catch(() => null);
  signingIn = false;
  await refreshLinkedin().catch(() => {});
  // Why (Gitar on #3914, 12 Nov 2026): a renewal is no "LinkedIn jobs is on" (it was on); the next read that works is what says "renewed", so this only says the copy is saved.
  if (answer?.ok && renew) toast(t('pagesLinkedinServices.savedTitle'), t('pagesLinkedinServices.savedBody'), NO_PLACE.itself, 'good');
  else if (answer?.ok) toast(t('pagesFinalLabels.linkedinOn'), t('pagesAuditSecond.a127'), NO_PLACE.itself, 'good');
  else toast(...signInEnded(answer, view));
}

// The shortcut while the Chrome extension is connected: its own page in Chrome copies the sign-in Chrome already has.
async function turnOnWithChrome(renew = false) {
  const opened = await window.pilot.linkedinJobsConnect().catch(() => null);
  if (opened?.opened) {
    toast(t('pagesFinalLabels.finishChrome'), t('pagesAuditPunct.a41'), NO_PLACE.itself, 'info');
    if (!renew) watchUntilOn();   // a renewal has nothing to wait for: the switch is already on (Gitar on #3914: the watch ended at once and said "on")
  } else toast(...notOpened(opened));
}

async function turnOff() {
  await window.pilot.linkedinJobsOff();
  await refreshLinkedin();
  toast(t('pagesFinalLabels.linkedinOff'), t('pagesAuditSecond.a128'), NO_PLACE.itself, 'info');
}

/**
 * Show the consent. mode: 'ask' (Find jobs press), 'turn-on' (Settings, Suggestions, ⌘K), 'manage' (it is on: Keep on / Turn off) or 'renew' (#3911: it is on and needs the person: sign in again). counts: "Not now" counts as an answer (the ask only).
 * Resolves when the dialog closed and what it chose did its first step.
 */
export function openLinkedinConsent({mode = 'turn-on', counts = false} = {}) {
  const words = CONSENT[mode] || CONSENT['turn-on'];
  const shown = showConsent(words, {chrome: !!(words.chrome && view.extension)});   // the shortcut only while the Chrome extension is connected
  if (!shown) return Promise.resolve(false);
  return shown.then(async answer => {
    const yes = answer === 'default', chrome = answer === 'chrome';
    if (chrome) await turnOnWithChrome(mode === 'renew');
    else if (yes) await (mode === 'manage' ? turnOff() : signInHere(mode === 'renew'));
    else if (counts) await window.pilot.linkedinJobsAnswer('not-now').catch(() => {});
    return yes || chrome;
  });
}

/**
 * The one LinkedIn dialog, filled with `words` ({title, lead, line, yes, no, chrome?}) and shown; LinkedIn Easy Apply (pages/easy-apply-consent.js) opens it too.
 * -> a promise of how it closed ('default' = yes, 'chrome', '' or 'cancel'), or null when it is already open (one dialog at a time).
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
  $('linkedin-chrome').textContent = words.chrome || '';
  $('linkedin-chrome').hidden = !chrome;
  dialog.returnValue = '';
  return new Promise(resolve => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue), {once: true});
    dialog.showModal();
  });
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
