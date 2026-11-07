// Feedback is saved to Notion. Sending stays with the user; Gmail remains read-only.
import '../../i18n/screens-pages.js';
import {t} from '../../i18n/index.js';
import {$, message} from './core.js';
import {loadFocus} from './focus.js';
import {loadJobs} from './jobs.js';
import {storeName} from '../store-words.js';

let current = null;
export function openFeedback(item, mode = 'receive') {
  current = {...item, mode};
  $('feedback-title').textContent = mode === 'request' ? t('pagesProfile.askFeedback') : mode === 'review' ? t('pagesProfile.employerFeedback') : t('pagesProfile.addFeedback');
  $('feedback-context').textContent = `${item.company || t('pagesEmployers.employer')} · ${item.job || item.title || t('pagesProfile.application')}`;
  $('feedback-help').textContent = mode === 'request'
    ? t('pagesInterviews.feedbackRequestHelp')
    : mode === 'review' ? t('pagesInterviews.feedbackPractice')
    : t('pagesInterviews.feedbackPasteHelp');
  $('feedback-text').value = mode === 'request' ? item.draft || '' : mode === 'review' ? item.employer_feedback || '' : '';
  $('feedback-text').readOnly = mode === 'review';
  $('feedback-copy').hidden = mode !== 'request';
  $('feedback-copy').textContent = t('pagesProfile.copyRequest');
  $('feedback-email').hidden = mode !== 'request' || !item.link;
  $('feedback-save').textContent = mode === 'request' ? t('pagesProfile.sentRequest') : mode === 'review' ? t('pagesProfile.markReviewed') : t('pagesProfile.saveFeedback');
  $('feedback-save').disabled = false;
  message('feedback-message', '');
  $('feedback-dialog').showModal();
  if (mode !== 'review') $('feedback-text').focus();
}
export async function saveFeedbackAction(item, action, text = '') {
  try {
    const result = await window.pilot.feedbackAction(item.page_id, action, text);
    if (!result.ok) return result;
    await Promise.all([loadFocus(), loadJobs()]);
    return result;
  } catch (error) { return {ok: false, error: error.message || t('pagesDynamicExperience.m162', {"storeName": storeName()})}; }
}
export function init() {
  $('feedback-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('feedback-text').value); $('feedback-copy').textContent = t('pagesProfile.copied'); }
    catch { message('feedback-message', t('pagesInterviews.copyFailed'), 'warn'); }
  });
  $('feedback-email').addEventListener('click', () => current?.link && window.pilot.openExternal(current.link));
  $('feedback-save').addEventListener('click', async event => {
    event.preventDefault();
    const action = {request: 'request', receive: 'receive', review: 'review'}[current.mode];
    const text = $('feedback-text').value.trim();
    if (action === 'receive' && !text) { message('feedback-message', t('pagesProfile.pasteFeedback'), 'warn'); return; }
    $('feedback-save').disabled = true;
    const result = await saveFeedbackAction(current, action, text);
    $('feedback-save').disabled = false;
    if (result.ok) $('feedback-dialog').close();
    else message('feedback-message', result.error || t('pagesDynamicExperience.m163', {"storeName": storeName()}), 'warn');
  });
}
