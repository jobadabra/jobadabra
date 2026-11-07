// Canonical page-step lines stay English for main-process journals and replay contracts; the renderer selects explicit translated display copy.
import '../i18n/screens-helpers.js';
import {t} from '../i18n/index.js';

export const PAGE_LINES = {reading: ['Reading this page\u2026', 'Reading\u2026'], posting: ['Apply button detected. Redirecting\u2026', 'Redirecting\u2026'],
  opening: ['Apply button detected. Redirecting\u2026', 'Redirecting\u2026'], account: ['Sign in form detected', 'Sign-in page'], 'sign-up': ['Sign-up form detected', 'Sign-up page'],
  other: ['This page shows no application', 'No application here'],
  'signing-in': ['Logging in\u2026', 'Logging in\u2026'], 'signing-up': ['Creating your account\u2026', 'Creating account\u2026']};
export const pageLine = (page, short = false) => (PAGE_LINES[page] || PAGE_LINES.reading)[short ? 1 : 0];

const DISPLAY_KEYS = {reading: ['readingPage', 'readingShort'], posting: ['applyDetected', 'redirecting'], opening: ['applyDetected', 'redirecting'],
  account: ['signInDetected', 'signInPage'], 'sign-up': ['signUpDetected', 'signUpPage'], other: ['noApplication', 'noApplicationShort'],
  'signing-in': ['loggingIn', 'loggingIn'], 'signing-up': ['creatingYourAccount', 'creatingAccountShort']};
/** Translate the app-owned page-step display without altering canonical journal strings or page identifiers. */
export function displayPageLine(page, short = false) {
  return t(`helperState.${(DISPLAY_KEYS[page] || DISPLAY_KEYS.reading)[short ? 1 : 0]}`);
}
