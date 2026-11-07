import '../i18n/screens-helpers.js';
import {t, getLocale} from '../i18n/index.js';
import {copyField} from '../i18n/display-copy.js';
import {date} from '../i18n/format.js';
import {ai} from './ai-name.js';
// The Focus card of an interview to prepare for: its meta line, its main button and its ⋯ entries, from the item
// src/focus.py builds (prep_at: when the kit was built; prep_stale: an interview was reviewed or booked since).
export const COST_HINT = t('helperFlow.prepCost');   // shown through ai()

// "29 Sept", or "today"
export function prepDay(at, today = new Date().toLocaleDateString('en-CA')) {
  const day = String(at || '').slice(0, 10);
  return !day || day === today ? t('helperMore.hostedToday') : (getLocale() === 'en' ? new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', {day: 'numeric', month: 'short'}) : date(new Date(`${day}T12:00:00`), {day: 'numeric', month: 'short'}));
}

// {meta: [...], primary: {label, run: 'build' | 'open' | 'join', tone, title}, more: [{label, icon, run}]}
export function prepCard(item, today) {
  const day = at => prepDay(at, today);
  const on = at => (day(at) === t('helperMore.hostedToday') ? t('helperMore.hostedToday') : t('helperFlow.onDay', {day: day(at)}));
  const meta = copyField(item, 'meta') || [], job = meta[0];
  const build = {label: t('helperFlow.prepareInterview'), run: 'build', tone: 'primary', title: ai(COST_HINT)};
  if (item.building) return {meta: [job, t('helperFlow.buildingPrep')], primary: {label: t('helperFlow.building'), run: 'join', tone: 'secondary'}, more: []};
  if (!item.prep_at) return {meta, primary: build, more: []};
  if (item.prep_stale) {
    // The kit was for an earlier call: building the one for this round comes first; the earlier kit stays on the page.
    const since = item.prep_why === 'booked' ? t('helperFlow.interviewMoved', {when: on(item.prep_since)})
      : t('helperFlow.callReviewedSince', {when: on(item.prep_since)});
    return {meta: [job, t('helperFlow.kitFrom', {day: day(item.prep_at), since})], primary: {...build, label: t('helperFlow.prepareInterview')},
      more: [{icon: 'file', label: t('helperFlow.earlierKit', {day: day(item.prep_at)}), run: 'open'}]};
  }
  return {meta: [job, t('helperFlow.prepReady', {day: day(item.prep_at)})], primary: {label: t('helperFlow.openPrepKit'), run: 'open', tone: 'primary'},
    more: [{icon: 'refresh', label: t('helperFlow.prepareAgain'), run: 'build', title: ai(COST_HINT)}]};
}
