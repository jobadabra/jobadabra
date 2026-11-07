// ⌘K for the notification offer: set it up, and send the confirm mail again. They exist only while the Suggestions card would be drawn (renderer/notify-words.js offerCard).
// The state and the two actions are handed in by pages/focus-suggestions.js, which owns the card and already opens Settings and shows toasts: this module imports no page, so the palette
// (pages/nav.js) adds no import cycle (the arch gate counts them: #3011). `add` is the palette's (group, label, hint, keywords, run). Guard: test/unit/renderer/notify-commands.test.js.
import '../../i18n/screens-pages.js';
import {t} from '../../i18n/index.js';
import {offerCard} from '../notify-words.js';

let state = null, actions = {open: () => {}, resend: () => {}};
/** Remembers notifyState's answer for the palette (called when the card's state is read). */
export const setNotifyState = value => { state = value; };
/** The card's own two actions: `open` shows Settings → Notifications, `resend` sends the confirm mail again and says the result. */
export const setNotifyActions = value => { actions = value; };

/** Shows Settings → Notifications (the card's own action), for the pop-ups' "Use Telegram" and "Open Notifications". */
export const openNotifications = () => actions.open();

/** Adds the palette commands for the current state (none while a channel works or the state is unread). */
export function addNotifyCommands(add) {
  const card = offerCard(state);
  if (!card) return;
  add(t('pagesCommon.settings'), 'Get a message when something needs you', 'By e-mail or Telegram', 'notify notification email e-mail telegram message reminder alert tell me', () => actions.open());
  if (card.resend) add(t('pagesCommon.settings'), 'Resend the confirmation e-mail', 'The link that starts your e-mails', 'resend confirm confirmation link e-mail email inbox verify', () => actions.resend());
}
