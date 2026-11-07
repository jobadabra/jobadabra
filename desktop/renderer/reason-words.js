import '../i18n/screens-helpers.js';
import {t} from '../i18n/index.js';
// The person card's reason line for a control the fill left: one plain sentence per reason class (extension/ladder/control-ending.js REASONS; the test fails when one has no words here).
export const REASON_WORDS = {
  no_answer: t('helperTail.noAnswerReason'),
  unread: t('helperTail.unreadReason'),
  tries: t('helperTail.triesReason'),
  not_kept: t('helperTail.notKeptReason'),
  unknown: t('helperTail.unknownReason'),
};
// The reason for one left control of a form state (reviewStates), matched by the label the panel sent; '' when none.
export const reasonFor = (state, label, same) => REASON_WORDS[(state?.reasons || []).find(item => item.label === label || same?.(item.label, label))?.reason] || '';
