// When the app offers Gmail (owner, 2 Nov 2026, spec docs/superpowers/specs/2026-11-02-gmail-offer-timing-design.md): the main process decides WHEN (a first Submit, a page that asks for a mailed code)
// and tells the window; the window draws the dialog (renderer/pages/gmail-offer.js). Nothing is asked on day one and nothing once Gmail is connected.
// Invariants: `gmailOffer.asked` in the app's settings is written only here (0..MAX_ASKS, counted when the window is told); the code dialog is once per app run and never limited by that count.
// Guard: test/unit/renderer/gmail-offer.test.js.
import {googleSecrets} from './google-keys.js';

export const MAX_ASKS = 2;   // the first Submit and one later one; then only Settings, ⌘K and Suggestions (owner, 2 Nov 2026)
export const WAITING = 'the code from your e-mail: connect Gmail';   // the parked job's reason: the existing "needs you" line (terminals.noteStuck, accountNeeds)

/** Whether a Google sign-in is held (all three Keychain items; the same read Always on uses). */
export const gmailConnected = (read = googleSecrets) => Object.keys(read() || {}).length > 0;

/** The window's copy of the counter. */
export const state = storage => ({asked: Math.min(MAX_ASKS, Math.max(0, Number(storage.settings().gmailOffer?.asked) || 0))});

/**
 * The job became Applied (lib/server-env.js markApplied, every Apply mode): not connected and fewer than MAX_ASKS asks so far → count it and tell the window.
 * -> true when the window was told. `employer` only words the dialog.
 */
export function afterApply({storage, tell, connected = gmailConnected, employer = ''}) {
  if (connected() || state(storage).asked >= MAX_ASKS) return false;
  storage.saveSettings({gmailOffer: {asked: state(storage).asked + 1}});
  tell('gmail-offer', {why: 'applied', employer: String(employer || '').slice(0, 120)});
  return true;
}

/**
 * The extension's AI judged that a page asks for a code mailed to the person (/extension/account-code); the caller asks only in Full automation, the one mode where Gmail types it. Gmail not connected → the job waits with a clear reason
 * (the one existing parked state, `park`) and the window is told once per app run; other jobs in the queue are not touched. TODO(AI): re-request the code for a parked job once Gmail connects (needs the extension to ask again; JOB-223) (2 Nov 2026). -> true when Gmail is missing (the caller then skips reading the mail).
 */
export function createCodeOffer({tell, park, connected = gmailConnected}) {
  let told = false;
  return ({session, host, email}) => {
    if (!email || connected()) return false;
    if (session) park(session, 'account', host, WAITING);
    if (!told) { told = true; tell('gmail-offer', {why: 'code', host: String(host || '').slice(0, 120)}); }
    return true;
  };
}
