import '../i18n/screens-helpers.js';
import {t} from '../i18n/index.js';
// The Strategy Locations card's words and edits, no DOM (owner, 17 Oct 2026): relocation is Yes / No / Not specified (all values), remote work in plain
// words, the search-only list ("Custom search coverage") and the one edit that resets it. Guarded by test/unit/renderer/locations-model.test.js.
export const RELOCATION = [['yes', t('helperMore.answerYes')], ['no', t('helperMore.answerNo')], ['unspecified', t('helperTail.notSpecified')]];

const words = text => String(text || '').replace(/(^|[\s,(-])(\p{L})/gu, (_, before, letter) => before + letter.toUpperCase());
const labels = entries => (entries || []).map(entry => words(entry.label));

// The mode now: the draft's while editing, else the stored one; never missing ("Not specified" is an answer).
export const relocationNow = (data, edits) => edits?.relocation?.set || data?.relocation || 'unspecified';

export function relocationWords(mode, abroad) {
  const places = labels(abroad);
  if (mode === 'yes') return places.length ? `Yes · ${places.join(', ')}` : t('helperMore.answerYes');
  return RELOCATION.find(([value]) => value === mode)?.[1] || t('helperTail.notSpecified');
}

// "Remote work": jobs that allow working from where you can work (owner: not "Counts · not from USA/APAC"; geographic exclusions are a separate setting).
export function remoteWords(allowed, countries) {
  if (!allowed) return t('helperTail.basedLocations');
  return countries.length ? t('helperTail.remoteAllowed', {place: countries[0]}) : t('helperTail.remoteCounts');
}

// An active search-only list replaces the preferences for the crawl only; the card says so even with Advanced collapsed.
export function coverage(data) {
  const entries = data?.lists?.searchOverride || [];
  return {active: entries.length > 0, places: labels(entries), fragments: entries.map(entry => entry.fragment)};
}
export const resetCoverage = ({fragments}) => ({searchOverride: {remove: [...fragments]}});
