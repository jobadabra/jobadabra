// The one sentence a person ticks to be e-mailed (CV step, Always on, Settings → Notifications), and what the app says when it cannot save the tick.
// Why (5 Nov 2026, owner): "I shouldn't start sending him email right away. We should still get the user consent": the sentence is stored with the date, so it must be one string.
// Guard: test/unit/main/email-consent.test.js.
// Shown as a title (WHAT) and a muted note ("To <address>. " + REST); stored as LINE, the two together, word for word.
export const WHAT = 'E-mail me when an application needs me or a strong match comes in.';
export const REST = 'We only write when something needs you. Stop any time.';
export const LINE = `${WHAT} ${REST}`;
export const FAILED = 'Could not save it just now. You can turn it on in Settings → Notifications.';
