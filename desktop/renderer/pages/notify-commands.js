// ⌘K for the notification offer: set it up, and send the confirm mail again. They exist only while the Suggestions card would be drawn (renderer/notify-words.js offerCard).
// The state is the one pages/focus-suggestions.js read for the card; `add` is the palette's (group, label, hint, keywords, run). Guard: test/notify-commands.test.js.
import {offerCard} from '../notify-words.js';
import {NO_PLACE} from '../targets.js';

let state = null;
/** Remembers notifyState's answer for the palette (called when the card's state is read). */
export const setNotifyState = value => { state = value; };

/** Adds the palette commands for the current state (none while a channel works or the state is unread). */
export function addNotifyCommands(add) {
  const card = offerCard(state);
  if (!card) return;
  const open = () => import('./settings.js').then(({openSetting}) => openSetting('notify'));
  add('Settings', 'Get a message when something needs you', 'By e-mail or Telegram', 'notify notification email e-mail telegram message reminder alert tell me', open);
  if (card.resend) {
    add('Settings', 'Resend the confirmation e-mail', 'The link that starts your e-mails', 'resend confirm confirmation link e-mail email inbox verify', async () => {
      const done = await window.pilot.notifyResend().catch(error => ({ok: false, error: error.message}));
      const {toastMessage} = await import('./startup.js');   // loaded when pressed: startup.js reads the document, which the palette's Node test has none of
      toastMessage(done?.ok ? 'Sent again ✓' : 'Not sent', done?.ok ? 'Check your inbox (and your spam folder) for the link.' : done?.error || 'Try again in a minute.', NO_PLACE.itself, done?.ok ? 'good' : 'warn');
    });
  }
}
