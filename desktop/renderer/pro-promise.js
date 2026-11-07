// The one promise every Pro offer repeats, in one place (owner, 24 Oct 2026: "emphasize that it's not subscription based, but one time payment"): never "lifetime".
import '../i18n/screens-helpers.js';
import {t} from '../i18n/index.js';
export const PROMISE = t('helperMore.paymentPromise');
export const promise = () => t('helperMore.paymentPromiseLower');   // mid-sentence: "Pro is a one-time payment, no subscription"
// The green badge by the price (components: .ui-pill tone-good), as plain data for the renderers and the test.
export const BADGE = `✓ ${PROMISE}`;
