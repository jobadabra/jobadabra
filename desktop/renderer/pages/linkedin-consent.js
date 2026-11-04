// LinkedIn jobs on every Find jobs (owner, 31 Oct 2026, spec docs/superpowers/specs/2026-10-31-linkedin-headless-design.md): the ONE consent dialog behind every door (the Settings row, the ask on
// the 1st and 2nd Find jobs press, the Suggestions entry, ⌘K) and the window's copy of the switch's state. "Sign in to LinkedIn" opens a Jobadabra window on LinkedIn's own page and the answer
// comes back when it ends; "Use my Chrome sign-in" (only while the extension is connected) opens the extension's own consent page in Chrome instead, and this module watches until the app
// has the session (lib/linkedin-handlers.js). The window never holds a cookie.
// Invariants: one dialog at a time; the ask is counted when shown, "Not now" only from the ask; the words are renderer/linkedin-words.js. Guard: test/unit/renderer/linkedin-consent.test.js.
import {$} from './core.js';
import {CONSENT, askOnPress, notOpened, signInEnded} from '../linkedin-words.js';
import {NO_PLACE} from '../targets.js';

export const view = {loaded: false, on: false, asked: 0, declined: 0, ask: false, hasSession: false, extension: false};
// Why (31 Oct 2026, push gate no-circular): startup.js imports the pages that import this module, so it hands its toast in (bindToast) instead of being imported here.
let toast = () => {};
/** Startup gives this module its toast function once; before that a message is dropped, never thrown. */
export const bindToast = fn => { toast = fn; };

/** Read the switch's state from the app; tells the pages (Settings row, Suggestions) when it changed. */
export async function refreshLinkedin() {
  const before = view.on;
  Object.assign(view, await window.pilot.linkedinJobsState(), {loaded: true});
  if (before !== view.on) window.dispatchEvent(new Event('linkedin-changed'));
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
  if (view.on) toast('LinkedIn jobs is on', 'Every Find jobs now also reads your LinkedIn job searches, in the background.', NO_PLACE.itself, 'good');
}

// The default way in: a Jobadabra window on LinkedIn's own sign-in page (lib/linkedin-signin-window.js). The answer comes when the window ends, so no watching is needed.
let signingIn = false;   // Why (independent review, 3 Nov 2026): the dialog is closed while the window is open, so a Find jobs press must not ask again (and count a decline) meanwhile
async function signInHere() {
  signingIn = true;
  const answer = await window.pilot.linkedinJobsSignIn().catch(() => null);
  signingIn = false;
  await refreshLinkedin().catch(() => {});
  if (answer?.ok) toast('LinkedIn jobs is on', 'Every Find jobs now also reads your LinkedIn job searches, in the background.', NO_PLACE.itself, 'good');
  else toast(...signInEnded(answer));
}

// The shortcut while the Chrome extension is connected: its own page in Chrome copies the sign-in Chrome already has.
async function turnOnWithChrome() {
  const opened = await window.pilot.linkedinJobsConnect().catch(() => null);
  if (opened?.opened) {
    toast('Finish in Chrome', 'A Jobadabra page opened in Chrome: press "Allow and turn on LinkedIn jobs" there. This window notices by itself.', NO_PLACE.itself, 'info');
    watchUntilOn();
  } else toast(...notOpened(opened));
}

async function turnOff() {
  await window.pilot.linkedinJobsOff();
  await refreshLinkedin();
  toast('LinkedIn jobs is off', 'Your LinkedIn sign-in was deleted from this Mac.', NO_PLACE.itself, 'info');
}

/**
 * Show the consent. mode: 'ask' (Find jobs press), 'turn-on' (Settings, Suggestions, ⌘K) or 'manage' (it is on: Keep on / Turn off). counts: "Not now" counts as an answer (the ask only).
 * Resolves when the dialog closed and what it chose did its first step.
 */
export function openLinkedinConsent({mode = 'turn-on', counts = false} = {}) {
  const dialog = $('linkedin-dialog');
  if (dialog.open) return Promise.resolve(false);
  const words = CONSENT[mode] || CONSENT['turn-on'];
  $('linkedin-title').textContent = words.title;
  $('linkedin-lead').textContent = words.lead;
  $('linkedin-line').textContent = words.line;
  $('linkedin-line-box').hidden = !words.line;
  $('linkedin-yes').textContent = words.yes;
  $('linkedin-no').textContent = words.no;
  $('linkedin-chrome').textContent = words.chrome || '';
  $('linkedin-chrome').hidden = !(words.chrome && view.extension);   // the shortcut only while the Chrome extension is connected
  dialog.returnValue = '';
  return new Promise(resolve => {
    dialog.addEventListener('close', async () => {
      const yes = dialog.returnValue === 'default', chrome = dialog.returnValue === 'chrome';
      if (chrome) await turnOnWithChrome();
      else if (yes) await (mode === 'manage' ? turnOff() : signInHere());
      else if (counts) await window.pilot.linkedinJobsAnswer('not-now').catch(() => {});
      resolve(yes || chrome);
    }, {once: true});
    dialog.showModal();
  });
}

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
  return {label: view.on ? 'Turn off LinkedIn jobs' : 'Turn on LinkedIn jobs', hint: 'Search LinkedIn on every Find jobs, in the background', keywords: 'linkedin jobs search background sign in connection', run: () => openLinkedinConsent({mode})};
}
