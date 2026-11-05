// Consent to be e-mailed: the one owner of `settings.emailConsent` ({at, wording, where, given}) and `settings.emailConsentAsked` ({cv, alwaysOn}: ISO dates), and of the
// address read from the CV that is offered with it (read by lib/email-from-cv.js: this file imports nothing heavy, the senders import it). The CV's address fills forms with no consent (lib/contact-from-cv.js); only what the product SENDS needs it.
// Why (5 Nov 2026, owner): "we shouldn't start sending him email right away. We should still get the user consent"; asked in the CV step, once more at Always on, never again.
// Invariant: the CV's address is never written to `notifyEmail` and never sent to the site before a consent (lib/notify-channel.js save, the only way to the site).
// Spec: docs/superpowers/specs/2026-11-05-email-consent-design.md. Guard: test/unit/main/email-consent.test.js.
import {LINE} from '../renderer/email-consent-words.js';

export const PLACES = ['cv', 'alwaysOn'];
const LEGACY = 'Typed in Settings → Notifications before 5 Nov 2026';

/** True when the person said yes to e-mail: a stored consent, or (consent never recorded: `undefined`) an address they typed in Settings before this existed, their own act.
 * A withdrawn consent is `null`: an address left over from before does not count again. */
export const consented = storage => { const {emailConsent, notifyEmail} = storage.settings(); return emailConsent === undefined ? !!notifyEmail : !!emailConsent?.at; };

/** What the stored consent says, for the window and the sign-up alert: {at, wording, where} or null. A pre-change address reads as its own typing. */
export const consentOf = storage => {
  const {emailConsent, notifyEmail, notifyEmailAt} = storage.settings();
  return emailConsent?.at ? emailConsent : emailConsent === undefined && notifyEmail ? {at: notifyEmailAt || '', wording: LEGACY, where: 'settings', given: 'switched'} : null;
};

export const GIVEN = ['default', 'switched'];
/** Stores the consent (date, the exact wording shown, where, and `given`: 'default' = the switch was left on as it started, 'switched' = the person turned it on). Called only once the site accepted the address. */
export const record = (storage, where, wording = LINE, now = new Date(), given = 'switched') =>
  storage.saveSettings({emailConsent: {at: now.toISOString(), wording, where, given: GIVEN.includes(given) ? given : 'switched'}});

/** Withdraws it (the person unticked e-mail in Settings): the app stops mailing; the site's own stop link stays its business. */
export const clear = storage => storage.saveSettings({emailConsent: null});

/** Each place asks once: the CV step when the person leaves it without ticking, Always on when it is turned on. */
export const asked = (storage, place, now = new Date()) => {
  if (PLACES.includes(place)) storage.saveSettings({emailConsentAsked: {...storage.settings().emailConsentAsked, [place]: now.toISOString()}});
};
/** True when `place` ('cv' | 'alwaysOn') may still show the e-mail switch: no consent yet, not withdrawn, and that place never asked. Reads settings only. */
export const shouldAsk = (storage, place) => PLACES.includes(place) && !consented(storage) && storage.settings().emailConsent !== null && !storage.settings().emailConsentAsked?.[place];   // null: withdrawn in Settings, never offered again (on by default would undo it)
