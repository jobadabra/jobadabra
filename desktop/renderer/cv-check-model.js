import '../i18n/screens-helpers.js';
import {t} from '../i18n/index.js';
import {number} from '../i18n/format.js';
// The CV check as Profile → CV shows it (owner review fix 8, mockup 08, 18 Oct 2026): one summary line, the fixes first (parser and content review in one
// list, most important first), the passed checks, score parts and extracted text kept for the folds, and the cost line under each action. Pure (no DOM):
// the data is lib/cv-check.js's saved result; guarded by test/unit/renderer/cv-check-model.test.js.
import {costText} from './ai-cost.js';
export const RANK = {high: 0, medium: 1, low: 2};

// Every fix, the most important first: a parser check that failed is high, one to look at is medium; a content fix keeps the AI's impact. Ties keep their order.
export function fixesOf(data) {
  const parser = (data?.ats?.checks || []).filter(check => check.status !== 'pass')
    .map(check => ({priority: check.status === 'fail' ? 'high' : 'medium', title: check.label, issue: check.detail, suggestion: check.fix || '', from: 'readability'}));
  const content = (data?.ai?.fixes || [])
    .map(fix => ({priority: fix.impact in RANK ? fix.impact : 'low', title: fix.where, issue: fix.issue, suggestion: fix.suggestion || '', from: 'content'}));
  return [...parser, ...content].map((fix, at) => ({fix, at})).sort((a, b) => RANK[a.fix.priority] - RANK[b.fix.priority] || a.at - b.at).map(each => each.fix);
}
export const passedOf = data => (data?.ats?.checks || []).filter(check => check.status === 'pass');

// "Mostly readable · 3 issues · 2 content suggestions": what a folded card says.
export function summaryOf(data) {
  const ats = data?.ats, ai = data?.ai;
  if (!ats) return t('helperProfile.notChecked');
  const issues = ats.checks.filter(check => check.status !== 'pass').length;
  return [ats.verdict, issues ? t('helperRest.issues', {count: issues}) : t('helperRest.noIssues'), ai ? t('helperRest.contentSuggestions', {count: ai.fixes.length}) : ''].filter(Boolean).join(' · ');
}

// The quiet line under an action, before it runs (owner, 18 Oct 2026): the readability check uses no AI; the content review says how it is paid: the plan's
// allowance, or the last run's recorded cost labelled as past (never an estimate), or that the cost varies. billing: the AI the review would use now.
export function costLine(action, {billing = '', ai = null} = {}) {
  if (action === 'readability') return t('helperRest.noAiUsage');
  if (billing === 'subscription') return t('helperRest.planAllowance');
  const last = ai?.billing !== 'subscription' && costText(ai?.usd);
  if (last) return t('helperRest.lastReviewCost', {cost: last});
  return t('helperRest.providerCostVaries');
}

// A score's tone, the thresholds the card always used: readability good from 90, content from 85; ok from 75 / 70.
export const scoreTone = (kind, score) => (score >= (kind === 'content' ? 85 : 90) ? 'good' : score >= (kind === 'content' ? 70 : 75) ? 'ok' : 'low');

// "3 pages · 328 KB · Uploaded 12 Oct": the document row's facts that are known (pages only once the check read it).
export function documentFacts({pages = 0, size = 0, addedAt = ''} = {}, when = at => at) {
  const kb = size ? (size >= 1024 * 1024 ? `${number(size / 1024 / 1024, {minimumFractionDigits: 1, maximumFractionDigits: 1})} MB` : `${number(Math.max(1, Math.round(size / 1024)))} KB`) : '';
  return [pages ? t('helperRest.pages', {count: pages}) : '', kb, addedAt ? t('helperRest.uploadedWhen', {when: when(addedAt)}) : ''].filter(Boolean).join(' · ');
}
