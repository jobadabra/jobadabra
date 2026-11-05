// The card's line for each page the extension marks (extension/page-mark.js): [full, short]. No imports: the app's page-step handler (lib/page-step.js)
// and the window (session-state.js) say the same words, and the recorded-page replays load nothing more for it.
export const PAGE_LINES = {reading: ['Reading this page\u2026', 'Reading\u2026'], posting: ['Apply button detected. Redirecting\u2026', 'Redirecting\u2026'],
  opening: ['Apply button detected. Redirecting\u2026', 'Redirecting\u2026'], account: ['Sign in form detected', 'Sign-in page'], 'sign-up': ['Sign-up form detected', 'Sign-up page'],
  other: ['This page shows no application', 'No application here'],
  'signing-in': ['Logging in\u2026', 'Logging in\u2026'], 'signing-up': ['Creating your account\u2026', 'Creating account\u2026']};
export const pageLine = (page, short = false) => (PAGE_LINES[page] || PAGE_LINES.reading)[short ? 1 : 0];
