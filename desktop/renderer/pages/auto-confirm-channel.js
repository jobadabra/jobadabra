// The channel question inside Full automation's confirmation (owner, 2 Nov 2026: "the email/telegram notifications should be obligatory"; spec docs/superpowers/specs/2026-11-02-notify-moments-design.md):
// when the person has given no way to be told, the same dialog asks for an e-mail address and the turn-on button waits for it. The confirmation itself (autoConfirmedAt) is not touched.
import '../../i18n/screens-pages.js';
import {t} from '../../i18n/index.js';
import {$, message} from './core.js';
import {answeredWithin, automationNeedsChannel} from '../notify-words.js';
import {saveChoice} from '../notify-suggestion.js';
import {validEmail} from '../hosted-suggestion.js';

const ASK_MS = 2000;   // Why (#3011, Gitar, 2 Nov 2026): the confirmation opens within this, whatever the website does

/**
 * Prepares the question for one opening of the dialog. -> {needed, save()}; `save()` stores the address (its confirm mail goes out) and resolves true, or says why not in the dialog and resolves
 * false. Nothing needed (a channel was given, or the website could not be asked) → the field stays hidden and save() resolves true.
 */
export async function prepareChannel() {
  const box = $('auto-confirm-channel'), input = $('auto-confirm-email'), note = $('auto-confirm-channel-note'), go = $('auto-confirm-go');
  const state = await answeredWithin(window.pilot.notifyState(), ASK_MS);   // a slow website must not hold the confirmation: no answer asks nothing
  const needed = automationNeedsChannel(state);
  box.hidden = !needed;
  input.value = '';
  note.textContent = '';
  go.disabled = needed;
  input.oninput = () => { go.disabled = needed && !validEmail(input.value.trim()); };
  return {
    needed,
    async save() {
      if (!needed) return true;
      const result = await window.pilot.notifySave(saveChoice(state, input.value.trim())).catch(error => ({ok: false, error: error.message}));
      if (!result?.ok) { message('auto-confirm-channel-note', result?.error || t('pagesActivityMore.saveAddressFailed'), 'bad'); return false; }   // message(): plainError
      window.dispatchEvent(new Event('notify-changed'));
      return true;
    },
  };
}
