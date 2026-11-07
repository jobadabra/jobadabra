// The small counter in the sidebar ("Free plan · 12 of 20 applications used"): which plan this is and what the number counts, at a glance
// (the numbers come from lib/license.js). It counts the applications USED (owner, 10 Oct 2026), so its bar fills, blue until the last 5 are left, then red; Settings → Plan
// shows the same `used` and `percent`, so the two can never disagree (0 of 40 there vs 40 of 40 here, 6 Oct 2026). The daily goal on
// Focus (applications today) is a different thing that resets each day and fills up. null when licensed: there is nothing to count.
import '../i18n/screens-helpers.js';
import {t} from '../i18n/index.js';
import {byWhere} from './store-name.js';
import {promise} from './pro-promise.js';
export function chip(state) {
  if (state?.license?.kind === 'pro') {   // a Pro account: the AI credit left, a thin bar, red from 10%
    // On our AI the bar is the credit left, also when there is none (owner, 27 Oct 2026: "if he is using in-house AI, then we should show the bar of how much AI credit
    // left"); on an own key or CLI a full bar, unlimited ("if user uses his own AI, then this bar is ok").
    if (state.pro?.ourAi) {
      const left = state.pro.hasCredit === false ? 0 : Math.max(0, Math.min(100, state.pro.creditPercent ?? 0));
      return {plan: 'Pro', text: t('helperFlow.aiCreditPercent', {percent: left}), tone: left <= 10 ? 'bad' : 'info', percent: Math.max(2, left), left: 0, used: state.used || 0,
        title: t('helperFlow.proOurCreditTip', {promise: promise()})};
    }
    const percent = state.pro?.creditPercent;
    return {plan: 'Pro', text: percent == null ? t('helperFlow.proPlan') : t('helperFlow.aiCreditPercent', {percent}), tone: (state.pro?.warn ?? 99) <= 10 ? 'bad' : 'info', percent: Math.max(2, percent ?? 100), left: 0, used: state.used || 0,
      title: t('helperFlow.proCreditTip', {promise: promise()})};
  }
  if (!state || state.licensed) return null;
  const left = Math.max(0, (state.limit || 0) - (state.used || 0));
  const used = Math.min(state.used || 0, state.limit || 0);
  const percent = state.limit ? Math.max(2, Math.min(100, Math.round(used / state.limit * 100))) : 0;
  const days = t('helperFlow.licenseDays', {count: state.daysLeft});
  if (state.ended) {
    return {plan: t('helperFlow.freePlan'), text: t('helperFlow.freePeriodOver'), tone: 'bad', percent: 100, left, used,
      title: t('helperFlow.freeEndedTip', {used: state.used, limit: state.limit, tracking: byWhere(t('helperFlow.trackingNotionWorks'), t('helperFlow.trackingWorks')), promise: promise()})};
  }
  return {plan: t('helperFlow.freePlan'), text: t('helperFlow.applicationsUsed', {used, limit: state.limit}), tone: left <= 5 ? 'bad' : 'info', percent, left, used,
    title: t('helperFlow.freeActiveTip', {used: state.used, limit: state.limit, days, promise: promise()})};
}
