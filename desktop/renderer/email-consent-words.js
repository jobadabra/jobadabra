import '../i18n/screens-helpers.js';
import {t} from '../i18n/index.js';
// The one sentence a person ticks to be e-mailed (CV step, Always on, Settings → Notifications), and what the app says when it cannot save the tick.
// Why (5 Nov 2026, owner): "I shouldn't start sending him email right away. We should still get the user consent": the sentence is stored with the date, so it must be one string.
// Guard: test/unit/main/email-consent.test.js.
// Shown as a title (WHAT) and a muted note ("To <address>. " + REST); stored as LINE, the two together, word for word.
export const WHAT = 'E-mail me when an application needs me or a strong match comes in.';
export const REST = 'We only write when something needs you. Stop any time.';
export const LINE = `${WHAT} ${REST}`;
export const FAILED = t('helperTail.consentSaveFailed');

// The CV step's own switch (owner, 6 Nov 2026: "that switch on the CV, it should be for enabling the email notifications", on by default): label + note as shown, no promotional line. `<address>` stands for the one found in the CV;
// the stored consent keeps this sentence word for word (where: 'cv'). Always on and Settings keep LINE.
export const CV_WHAT = 'E-mail me app notifications';
export const CV_REST = 'Choose which ones in Settings → Notifications.';
export const CV_LINE = `${CV_WHAT}. We found <address> in your CV. ${CV_REST}`;
/** What Settings → Notifications says beside the Email switch while it has no address (and what a consent given there stores): the CV step's label, same words (owner, 6 Nov 2026). */
export const SETTINGS_LINE = `${CV_WHAT}.`;
/** The sentence a consent stored from `where` ('cv' | 'alwaysOn' | 'settings') carries: what that place showed. */
export const wordingOf = where => (where === 'cv' ? CV_LINE : where === 'settings' ? SETTINGS_LINE : LINE);
/** What a row turned on in Settings stores as the person's act (no address on our site yet): the row's own line, as shown beside its switch. */
export const rowLine = name => `E-mail me: ${name}.`;
