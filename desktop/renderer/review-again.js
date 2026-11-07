// Interviews → a reviewed row's ⋯ "Review again": its menu entry (busy while it runs) and the message after it.
// The same review as the first one (window.pilot.interviews.review), re-run on the transcript saved in Notion: it
// replaces the review and fills only the job's empty fields (src/ai/interviews.py review_again). One AI call, so the
// menu press is the ask; it never runs by itself.
import '../i18n/screens-helpers.js';
import {t} from '../i18n/index.js';
import {ai} from './ai-name.js';
import {humanError} from './run-warnings.js';
import {byWhere} from './store-name.js';

export const LABEL = t('helperFlow.reviewAgainLabel');
export const BUSY = t('helperFlow.reviewingAgain');
export const TITLE = t('helperFlow.reviewAgainTip');

// The menu entry for a row, or null (not reviewed yet: the row's own Review button does it).
export function againItem(row, busy, run) {
  if (!row?.overall) return null;
  return busy ? {label: BUSY, title: ai(t('helperFlow.reviewAgainBusy')), run: () => {}} : {label: LABEL, title: ai(TITLE), run};
}

export const START = t('helperFlow.reviewAgainStart');   // shown through ai()

// [text, tone] for the page's message line after the call returns.
export function doneMessage(result) {
  if (!result?.ok) return [t('helperFlow.reviewAgainFailed', {error: result?.error ? humanError(result.error) : t('helperFlow.noAnswer')}), 'error'];
  if (result.already) return [result.summary, 'ok'];   // a second press inside the guard window runs nothing: say that, not "replaced"
  if (result.cloud) return [t('helperFlow.reviewAgainCloud'), 'ok'];   // about Notion: Always on runs only with Notion
  return [`${result.summary}. ${byWhere(t('helperFlow.reviewReplacedNotion'), t('helperFlow.reviewReplaced'))}`, 'ok'];
}
