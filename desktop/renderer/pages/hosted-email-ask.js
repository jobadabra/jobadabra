// Always on's one more ask for e-mail (owner, 5 Nov 2026: skipped in the CV step → "asked once more when the user turns on Always on; never again after that"; "Let it be on by default").
// The first "Turn on Always on" press with no consent and an address from the CV shows the CV step's switch row inside the card, ON, and stops there; the next press answers it
// (on = the consent, given 'default' or 'switched'; off = nothing sent) and goes on as before. Stored by lib/email-consent.js. Guard: test/unit/main/email-consent.test.js.
import {el} from '../components.js';
import {$, message, show} from './core.js';
import {FAILED, REST, WHAT} from '../email-consent-words.js';
import {atContinue, startsOn} from '../email-consent-choice.js';

let touched = false, busy = false;   // busy: a press is being answered (a quick double press must not build or answer twice)

// The switch row, built once, as in the CV step (index.html #cv-email): switch, title, the address and the rest of the sentence.
function build(card, address) {
  const input = el('input'); input.type = 'checkbox'; input.id = 'hosted-email-consent';
  const knob = el('span', 'switch', input); knob.append(el('span'));   // el() takes one content: the rest are appended
  const note = el('span', 'muted small', 'To '); note.append(el('b', '', address), `. ${REST}`);
  const words = el('span'); words.append(el('span', 'cv-consent-title', WHAT), note);
  const block = el('label', 'switch-row cv-consent'); block.append(knob, words);   // one label: the whole row is the switch, and its words are the input's name
  block.id = 'hosted-email-ask';
  input.addEventListener('change', () => { touched = true; });
  card.append(block);
  return block;
}

/** The Turn on press. -> true when the press stops here (the switch was just shown, or its answer could not be saved), false when the press goes on (nothing to ask, or the shown switch was just answered). */
export async function askConsentOnce(card, then) {
  if (busy) return true;
  busy = true;
  try { return await press(card, then); } finally { busy = false; }
}

// Why (5 Nov 2026, co review): "asked" is stored when the shown switch is answered, not when it is shown: leaving before the second press must not use up the one ask.
async function press(card, then) {
  const shown = $('hosted-email-ask');
  if (shown && !shown.hidden) {
    show(shown, false);
    const answer = atContinue({on: $('hosted-email-consent').checked, touched});
    await window.pilot.emailConsentAsked('alwaysOn');
    if (answer.give) {
      const done = await window.pilot.emailConsentGive({where: 'alwaysOn', given: answer.give.given}).catch(() => ({ok: false}));
      await then();   // the card reads the address it now has
      if (!done.ok) { message('hosted-set-message', done.error || FAILED, 'bad'); return true; }   // the card's own line (a toast would close an import cycle); the press stops, or turning on would write over it
    }
    return false;
  }
  const view = await window.pilot.emailConsentView().catch(() => null);
  if (!view?.askAlwaysOn) return false;
  const block = shown || build(card, view.address);
  $('hosted-email-consent').checked = startsOn(view);
  touched = false;
  show(block);
  return true;
}
