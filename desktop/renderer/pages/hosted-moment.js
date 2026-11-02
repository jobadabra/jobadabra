// The dialog that offers Always on at a moment it matters (lib/always-on-moments.js; spec docs/superpowers/specs/2026-11-02-always-on-moments-design.md): today, a scheduled check that did not run
// because the Mac was asleep or off. Shown once per moment (the app records it when it opens); the card on Focus and Jobs stays whatever is answered here.
import {$} from './core.js';
import {NO_PLACE} from '../targets.js';
import {bindHostedOffer} from '../hosted-suggestion.js';
import {emailField} from '../hosted-step-parts.js';
import {missedWords} from '../hosted-words.js';
import {toastMessage} from './startup.js';

const RETRY_MS = 20 * 1000, RETRIES = 5, FIRST_MS = 3000;

/** Binds the dialog once at start: asks the main process for a moment 3 s after load and again on wake; shows it only when Always on can run and is off. Returns nothing; a failed read shows nothing. */
export function init() {
  const dialog = $('hosted-moment-dialog');
  if (!dialog) return;
  const draft = {};
  // Opens when the window is quiet: another dialog open (a wizard step, a confirmation) means try again shortly, a few times.
  async function ask(tries = RETRIES) {
    if (dialog.open) return;
    const [moment, hosted] = await Promise.all([window.pilot.hostedMoment(), window.pilot.hostedState()]).catch(() => []);
    if (!moment || !hosted?.canRun || hosted.on) return;
    if (document.querySelector('dialog[open]')) { if (tries > 0) setTimeout(() => ask(tries - 1), RETRY_MS); return; }
    const words = missedWords(moment.at);
    $('hosted-moment-title').textContent = words.title;
    $('hosted-moment-text').textContent = words.body;
    const go = $('hosted-moment-go'), email = hosted.email || hosted.shared || '';
    $('hosted-moment-body').replaceChildren();
    const turnOn = bindHostedOffer({body: $('hosted-moment-body'), button: go, email, emailField: () => emailField('hosted-moment-email'), draft,
      turnOn: given => window.pilot.hostedOn(given), onSuccess: sentTo => {
        dialog.close();
        toastMessage('Always on ✓', `New matches every morning to ${sentTo}.`, NO_PLACE.itself, 'good');
        window.dispatchEvent(new Event('hosted-changed'));
      }});
    go.onclick = turnOn;
    await window.pilot.hostedMomentShown(moment.moment);   // once: recorded as it opens, so Escape or Not now never brings it back
    dialog.showModal();
  }
  $('hosted-moment-later').addEventListener('click', () => dialog.close());
  window.pilot.onHostedMoment(() => ask());
  setTimeout(() => ask(), FIRST_MS);
}
