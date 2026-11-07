// Localize credit estimates for the desktop while the shared website estimate remains dependency-free.
import '../i18n/screens-helpers.js';
import {t} from '../i18n/index.js';
import {applicationsFor} from './credit-buys.js';

/** Describe the unchanged shared estimate in the display language; nonpositive estimates stay empty. */
export const buysWords = creditEur => {
  const count = applicationsFor(creditEur);
  return count > 0 ? t('helperMore.aboutApplications', {count}) : '';
};
/** Append the localized estimate to an amount without ever emitting empty parentheses. */
export const buysSuffix = creditEur => (buysWords(creditEur) ? ` (${buysWords(creditEur)})` : '');
