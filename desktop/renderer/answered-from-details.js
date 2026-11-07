// The one line for questions a form asked that Your details already answers (owner, 17 Oct 2026, Decision 2): the Jobs card, the drawer and the Profile banner say it the same way.
// Guarded by test/unit/main/question-base-facts.test.js.
import '../i18n/screens-helpers.js';
import {t} from '../i18n/index.js';
/** Format the known count answered from Your details; the count and stored answers are unchanged. */
export const fromDetailsLine = count => t('helperFlow.fromDetails', {count});
