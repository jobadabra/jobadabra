// The notice for a LinkedIn sign-in that needs the person (#3911; owner, 12 Nov 2026: "Why I don't get any notification or feedback"). Design: lib/linkedin-session.js owns the state (signin);
// a read's verdict (noteRun) yields at most one event, 'needs-you' or 'renewed', and this is the one place that raises it, through the app's notify() (a macOS notification, or a window toast when
// macOS blocks it; the click opens Settings → Connections, where the card says the same). Nothing else raises it. Guard: test/unit/main/linkedin-notice.test.js.
import {notificationLanguage} from './notification-language.js';
import {notificationText} from '../i18n/user-notifications.js';
import {state, noticedAt, noteNoticed} from './linkedin-session.js';

export const DAY_MS = 24 * 3600 * 1000;   // Why (mac-9a, 12 Nov 2026): a person who ignores "needs you" is not told at every press; the card and the step line still show it every time
const TARGET = {view: 'settings', section: 'connections'};
const TITLES = {missing: 'linkedinTitleMissing', 'signed-out': 'linkedinTitleSignedOut', check: 'linkedinTitleCheck', empty: 'linkedinTitleEmpty', renewed: 'linkedinRenewedTitle'};
const BODIES = {missing: 'linkedinBodyStep', 'signed-out': 'linkedinBodyStep', check: 'linkedinBodyCheck', empty: 'linkedinBodyEmpty', renewed: 'linkedinRenewedBody'};

/** {title, body} for a reason ('missing' | 'signed-out' | 'check' | 'empty') or 'renewed', in the person's language. */
export const noticeWords = (why, locale = 'en') => ({title: notificationText(locale, TITLES[why] || TITLES.empty), body: notificationText(locale, BODIES[why] || BODIES.empty)});

/**
 * -> tell(result): raises what noteRun returned ({event, why}). 'needs-you' at most once a day; 'renewed' once, and it starts the day over; no event, or the switch off: nothing.
 * notify is the app's (title, body, target, tone).
 */
export function linkedinTell({storage, notify, now = Date.now}) {
  return result => {
    const {event, why} = result || {};
    if ((event !== 'needs-you' && event !== 'renewed') || !state(storage).on) return;
    if (event === 'needs-you' && now() - noticedAt(storage) < DAY_MS) return;
    noteNoticed(storage, event === 'needs-you' ? now() : 0);
    const {title, body} = noticeWords(event === 'renewed' ? 'renewed' : why, notificationLanguage(storage));
    if (event === 'renewed') notify(title, body, TARGET, 'good');
    else notify(title, body, TARGET, 'warn');
  };
}
