// The dialog that offers Always on at a moment it matters (lib/always-on-moments.js; spec docs/superpowers/specs/2026-11-02-always-on-moments-design.md): today, a scheduled check that did not run
// because the Mac was asleep or off. Shown once per moment (the app records it when it opens); the card on Focus and Jobs stays whatever is answered here.
import '../../i18n/screens-pages.js';
import {t} from '../../i18n/index.js';
import {$} from './core.js';
import {NO_PLACE} from '../targets.js';
import {bindHostedOffer, turnedOnText} from '../hosted-suggestion.js';
import {emailField} from '../hosted-step-parts.js';
import {missedWords} from '../hosted-words.js';
import {slot} from '../popup-slot.js';
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
    // One connection pop-up per app open (renderer/popup-slot.js): this one waits its turn; "shown once" is written only when it really opens.
    slot.offer({id: 'always-on-missed', rank: 1, open: async () => {
      if (dialog.open || document.querySelector('dialog[open]')) return false;
      const words = missedWords(moment.at);
      $('hosted-moment-title').textContent = words.title;
      $('hosted-moment-text').textContent = words.body;
      const go = $('hosted-moment-go'), email = hosted.email || hosted.shared || '';
      $('hosted-moment-body').replaceChildren();
      const turnOn = bindHostedOffer({body: $('hosted-moment-body'), button: go, email, emailField: () => emailField('hosted-moment-email'), draft,
        turnOn: given => window.pilot.hostedOn(given), onSuccess: async sentTo => {
          dialog.close();
          toastMessage(t('pagesFocusReports.alwaysOn'), await turnedOnText(sentTo), NO_PLACE.itself, 'good');
          window.dispatchEvent(new Event('hosted-changed'));
        }});
      go.onclick = turnOn;
      await window.pilot.hostedMomentShown(moment.moment);   // once: recorded as it opens, so Escape or Not now never brings it back
      dialog.showModal();
      return true;
    }});
  }
  $('hosted-moment-later').addEventListener('click', () => dialog.close());
  window.pilot.onHostedMoment(() => ask());
  setTimeout(() => ask(), FIRST_MS);
}
