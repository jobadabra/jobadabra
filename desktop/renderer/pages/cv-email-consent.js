// The CV step's e-mail choice, under the card: one switch ("E-mail me app notifications") with the address read from the CV in its note, ON by default; Continue with it on is the consent
// (lib/email-consent.js stores it with the date, the sentence and how it was given), off sends nothing. Moving the switch sends nothing either: only Continue does.
// Why (5 Nov 2026, owner): "we shouldn't start sending him email right away. We should still get the user consent"; the first try in the card was "Too crowded";
// then "Let it be on by default". Leaving with it off is "asked once" (Always on asks once more). Guard: test/unit/main/email-consent.test.js.
import '../../i18n/screens-pages.js';
import {t} from '../../i18n/index.js';
import {$, show} from './core.js';
import {CV_REST, CV_WHAT, FAILED} from '../email-consent-words.js';
import {atContinue, startsOn} from '../email-consent-choice.js';

const TRIES = 10, EVERY_MS = 3000;   // the CV is read in the background after it is picked: the address shows up when that read ends, so this looks a few times, then stops
let toast = () => {};   // pages/activity-panel.js hands in startup.js's toastMessage: importing it here closed an import cycle (startup → activity → activity-panel → here)
let timer = null, bound = false, touched = false, open = false, answered = false;   // open: drawn and not answered yet; answered: Continue gave this step's answer (a redraw must not offer it again, on)

/** Draws the choice for the CV step; with no address yet (the read is still running) it looks again a few times. `say`: the window's toast, for a failed save after the step is gone. */
export async function showCvEmail(left = TRIES, say = null) {
  if (say) toast = say;
  clearTimeout(timer);
  const view = await window.pilot.emailConsentView().catch(() => null);
  const there = !!view?.address && (view.consented || (view.askCv && !answered));
  show($('cv-email'), there);
  if (!bound) bind();
  if (!there) {
    open = false;
    if (left > 0 && !$('cv-file').hidden && !view?.consented) timer = setTimeout(() => showCvEmail(left - 1), EVERY_MS);
    return;
  }
  $('cv-email-address').textContent = view.address;
  $('cv-email-wording').textContent = CV_WHAT;
  $('cv-email-rest').textContent = CV_REST;
  $('cv-email-consent').disabled = view.consented;   // given: withdrawing lives in Settings → Notifications, one place
  if (view.consented) { $('cv-email-consent').checked = true; open = false; return; }
  if (!open) { $('cv-email-consent').checked = startsOn(view); touched = false; open = true; }   // a redraw while open keeps what the person set
}

function bind() {
  bound = true;
  $('cv-email-consent').addEventListener('change', () => { touched = true; });
  $('cv-next').addEventListener('click', async () => {
    if (!open || $('cv-email').hidden) return;
    open = false;
    answered = true;
    const answer = atContinue({on: $('cv-email-consent').checked, touched});
    if (answer.asked) { await window.pilot.emailConsentAsked('cv'); return; }
    const done = await window.pilot.emailConsentGive({where: 'cv', given: answer.give.given}).catch(() => ({ok: false}));
    if (!done.ok) toast(t('pagesFieldsStatus.emailNotOn'), done.error || FAILED, {card: 'notify'}, 'warn');   // the step is gone by now: said where the person is
  });
}
