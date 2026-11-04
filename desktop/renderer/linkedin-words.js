// LinkedIn jobs on every Find jobs (owner, 31 Oct 2026, spec docs/superpowers/specs/2026-10-31-linkedin-headless-design.md): the words of the one consent and the Suggestions entry, and
// when the ask is due. Pure, so test/unit/renderer/linkedin-consent.test.js checks them; pages/linkedin-consent.js draws the dialog, and the four doors (Settings, Find jobs ask, Suggestions, ⌘K) open it.
import {NO_PLACE} from './targets.js';
export const KEY = 'linkedin:jobs';
// The owner's line (31 Oct 2026: "LinkedIn may limit accounts it thinks are automated; we read slowly and only your job searches.").
export const LINE = 'LinkedIn may limit accounts it thinks are automated; we read slowly and only your job searches.';
const WHERE = 'Settings → Connections → LinkedIn';
const LEAD = `Jobadabra can read your LinkedIn job searches every time you press Find jobs, in the background with no window. You sign in once, in a Jobadabra window, on LinkedIn's own page: you type your password there and Jobadabra never sees it. The sign-in stays on this Mac, and you can turn it off any time in ${WHERE}.`;

export const CONSENT = {
  ask: {title: 'Also search LinkedIn on every Find jobs?', lead: LEAD, line: LINE, yes: 'Sign in to LinkedIn', no: 'Not now', chrome: 'Use my Chrome sign-in'},
  'turn-on': {title: 'Also search LinkedIn on every Find jobs?', lead: LEAD, line: LINE, yes: 'Sign in to LinkedIn', no: 'Not now', chrome: 'Use my Chrome sign-in'},
  manage: {title: 'LinkedIn jobs is on', lead: 'Every Find jobs also reads your LinkedIn job searches in the background, with your LinkedIn sign-in kept in this Mac\'s Keychain. Turning it off deletes that sign-in.', line: '', yes: 'Turn off', no: 'Keep on'},
};

/** The Suggestions entry while the switch is off; `view` is the window's read of the state (pages/linkedin-consent.js), `hidden`/`held` the keys answered Not now. */
export function linkedinEntries({view, hidden = new Set(), held = new Set()} = {}) {
  if (!view?.loaded || view.on || hidden.has(KEY) || held.has(KEY)) return [];
  return [{kind: 'linkedin', home: 'focus', topic: 'profile', key: KEY, title: 'Also search LinkedIn when you find jobs', source: '',
    detail: 'In the background, no window. You sign in to LinkedIn once, in a Jobadabra window.', evidence: [], answers: ['Not now'], actions: [{label: 'Sign in to LinkedIn', do: 'turn_on_linkedin'}]}];
}

/** The ask on Find jobs: only a real Find jobs press (a re-score or Find employers goes through the same call), and only while the app says it is due. */
export const askOnPress = (view, why) => !!view?.ask && !(why && (why.reason || why.employers));

// Why "Turn on LinkedIn" opened no page, from the app (lib/extension-target.js noPageReason): the extension is only blamed when the app has not heard from it.
const NOT_OPENED = {
  missing: ['Chrome extension needed', 'LinkedIn jobs uses the Jobadabra Chrome extension. Connect it in Settings → Connections → Chrome extension, then try again.'],
  'unknown-copy': ['Jobadabra cannot open this extension copy', 'The extension is connected, but it is a copy Jobadabra does not recognise. Install it from Settings → Connections → Chrome extension, then try again.'],
  chrome: ['Chrome did not open', 'The extension is connected, but Jobadabra could not open Chrome. Open Chrome and press Turn on LinkedIn again.'],
};
/** The toast's arguments for a press that opened no page: `answer` = {opened: false, reason, note} (no answer at all reads as "missing"); `note` says how to update an older copy. */
export function notOpened(answer) {
  const [title, body] = NOT_OPENED[answer?.reason] || NOT_OPENED.missing;
  return [title, answer?.note ? `${body} ${answer.note}` : body, NO_PLACE.itself, 'warn'];
}

// How the sign-in window ended without a session (lib/linkedin-signin-window.js reasons; 'not-kept' = the Keychain or the sign-in itself was refused, its own sentence comes with it).
const SIGN_IN_ENDED = {
  cancelled: ['LinkedIn jobs is still off', 'The sign-in window was closed before you finished. Press Sign in to LinkedIn to try again.', 'info'],
  timeout: ['LinkedIn jobs is still off', 'The sign-in window waited 10 minutes and was closed. Press Sign in to LinkedIn to try again.', 'info'],
  'load-failed': ['LinkedIn did not load', 'The sign-in page did not open. Check your internet connection and press Sign in to LinkedIn again.', 'warn'],
  'no-keychain': ['LinkedIn jobs is not available here yet', 'Jobadabra keeps your LinkedIn sign-in in the system keychain, and this computer has no store for it yet. Nothing was opened.', 'info'],
  'not-kept': ['LinkedIn jobs stayed off', 'You signed in, but Jobadabra could not keep the sign-in.', 'warn'],
};
/** The toast's arguments for a sign-in window that ended with no session: `answer` = {ok: false, reason, error?}; an unknown reason reads as closed. */
export function signInEnded(answer) {
  const [title, body, tone] = SIGN_IN_ENDED[answer?.reason] || SIGN_IN_ENDED.cancelled;
  return [title, answer?.reason === 'not-kept' && answer.error ? answer.error : body, NO_PLACE.itself, tone];
}
