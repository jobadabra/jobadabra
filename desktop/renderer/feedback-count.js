// The sentence under the feedback box about how much of its limit is used (pure, no DOM, so a test plays every threshold).
/** Takes the characters typed and the box's maxlength; returns '' for a short note (nothing is said), "N of M characters" from 80% of the limit,
 *  and the sentence that nothing more fits at the limit. Why (4 Nov 2026, a tester): the box cut text with no word at all. */
import '../i18n/screens-helpers.js';
import {t} from '../i18n/index.js';
import {number} from '../i18n/format.js';
export function countLine(length, max) {
  const fmt = number;
  if (!(max > 0) || length < max * 0.8) return '';
  if (length >= max) return t('helperFlow.feedbackFull', {max: fmt(max)});
  return t('helperFlow.feedbackCount', {length: fmt(length), max: fmt(max)});
}
