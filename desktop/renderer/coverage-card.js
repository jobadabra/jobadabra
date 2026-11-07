import '../i18n/screens-helpers.js';
import {number as formatNumber} from '../i18n/format.js';
import {t} from '../i18n/index.js';
// The Strategy page's "your search may be too narrow" card (src/coverage.py says it; desktop/lib/strategy.js addRoles acts on it).
// Pure: the numbers in, the words and chips out. Nothing is shown for a search that catches enough, or after "Not now" for this crawl.
import {offered} from './key-sources.js';
const number = value => formatNumber(Number(value || 0));
const examples = item => item.examples?.length ? t('helperRest.coverageExamples', {examples: item.examples.join('; ')}) : '';
const counted = (key, value) => t(`helperRest.${key}`, {count: value || 0});

export function coverageCard(verdict, dismissedAt = '') {
  if (!verdict || !verdict.narrow || !Array.isArray(verdict.suggestions) || !verdict.suggestions.length) return null;
  if (dismissedAt && verdict.at && dismissedAt === verdict.at) return null;
  const percent = Math.max(1, Math.round((verdict.share || 0) * 100));
  return {
    title: verdict.local ? t('helperRest.coverageOtherLanguages') : t('helperRest.coverageNarrow'),
    text: (verdict.local ? t('helperRest.coverageLanguageLead') : '') +
      t('helperRest.coverageNumbers', {total: number(verdict.in_places), matched: number(verdict.matched), percent: number(percent)}) +
      t('helperRest.coverageTitleWords'),
    chips: verdict.suggestions.slice(0, 8).map(item => ({
      term: item.term, count: item.count || 0, label: `+ ${item.term} · ${number(item.count)}`,
      // Each new posting is read and scored once (AI, once): said before the click, because a broad word brings many.
      title: counted('openPostings', item.count) + examples(item) + t('helperRest.coverageReadOnce'),
    })),
    at: verdict.at || '',
  };
}

// "Your filters drop jobs" (src/coverage.py): excluded title words and ruled-out languages, each with the jobs it hid; a chip removes it.
export function filtersCard(verdict, dismissedAt = '') {
  const words = Array.isArray(verdict?.excluded) ? verdict.excluded : [], languages = Array.isArray(verdict?.languages) ? verdict.languages : [];
  if (!words.length && !languages.length) return null;
  if (dismissedAt && verdict.at && dismissedAt === verdict.at) return null;
  return {
    title: t('helperRest.coverageOwnFilters'),
    text: t('helperRest.coverageOwnFiltersLead'),
    chips: [...words.map(item => ({exclude: item.fragment, count: item.count || 0, label: `− "${item.fragment.replace(/\\b/g, '')}" · ${number(item.count)}`,
      title: counted('excludedJobs', item.count) + examples(item)})),
    ...languages.map(item => ({language: item.language, count: item.count || 0, label: t('helperRest.requiresLanguage', {language: item.language, count: number(item.count)}),
      title: t('helperRest.languageHidden', {count: item.count || 0, language: item.language}) + examples(item)}))],
    at: verdict.at || '',
  };
}

// "More places to find jobs" (src/coverage.py unused_sources): the job sources this install does not use, least effort first, each with what it
// takes (a free key, a paid plan). Shown whatever the coverage: more sources mean more jobs. A chip opens its panel in Settings → Connections.
export function sourcesCard(verdict, dismissedAt = '') {
  const sources = (Array.isArray(verdict?.sources) ? verdict.sources : []).filter(source => offered(source.id));   // the API-key sources are hidden while the flag is off (key-sources.js)
  if (!sources.length || (dismissedAt && verdict.at && dismissedAt === verdict.at)) return null;
  return {
    title: t('helperRest.coverageMoreSources'),
    text: t('helperRest.coverageMoreSourcesLead'),
    chips: sources.map(source => ({id: source.id, label: `+ ${source.name} · ${source.people || source.effort}`,
      title: `${source.effort}: ${source.gain}${source.people ? ` (${source.people})` : ''}`})),
    at: verdict.at || '',
  };
}

// Sites only you can open (src/sources/visits.py): employers whose site refuses automated visitors and portals with no API. A chip opens the
// page in your Chrome with a read mark; there the extension reads it by itself (owner, 7 Oct 2026). Pure like the others.
export function visitCard(verdict, dismissedAt = '') {
  const list = Array.isArray(verdict?.visits) ? verdict.visits : [];
  if (!list.length || (dismissedAt && verdict.at && dismissedAt === verdict.at)) return null;
  return {
    title: t('helperRest.coverageOnlyYou'),
    text: t('helperRest.coverageOnlyYouLead'),
    chips: list.map(item => ({url: item.url, label: t('helperRest.openSite', {name: item.name}), note: item.note || '',
      title: `${item.kind === 'portal' ? `${item.name}: ${item.why}` : `${item.name} ${item.why}`}${item.last_read ? t('helperRest.lastRead', {day: item.last_read.slice(0, 10)}) : ''}${item.note ? `. ${item.note}` : ''}`})),
    at: verdict.at || '',
  };
}

// Employers where people doing the same kind of work got interviews (src/coverage.py employers_for_you, from the shared pool, 7 Oct 2026).
// A chip shows that employer's jobs. Pure like the others.
export function employersCard(verdict, dismissedAt = '') {
  const list = Array.isArray(verdict?.for_you) ? verdict.for_you : [];
  if (!list.length || (dismissedAt && verdict.at && dismissedAt === verdict.at)) return null;
  return {
    title: t('helperRest.coveragePeerInterviews'),
    text: t('helperRest.coveragePeerLead'),
    chips: list.map(item => ({company: item.company, label: `${item.company} · ${item.interview ? counted('peerInterviews', item.interview) : t('helperRest.peerApplied', {count: number(item.applied)})}`,
      title: t('helperRest.peerHistory', {why: item.why, applied: number(item.applied), interviews: counted('peerInterviews', item.interview)})})),
    at: verdict.at || '',
  };
}

// The same card for places (src/coverage.py): roles the keywords already catch, but in places you did not list. Pure like the one above.
export function placesCard(verdict, dismissedAt = '') {
  const places = verdict?.places;
  if (!places || !Array.isArray(places.options) || !places.options.length) return null;
  if (dismissedAt && verdict.at && dismissedAt === verdict.at) return null;
  const extra = places.options.reduce((sum, option) => sum + (option.count || 0), 0);
  const elsewhere = places.elsewhere ? t('helperRest.placesVisa', {count: number(places.elsewhere)}) : '';
  return {
    title: t('helperRest.coverageOutsidePlaces'),
    text: t('helperRest.placesNumbers', {hits: number(places.title_hits), matched: number(places.matched), extra: number(extra)}) + elsewhere,
    chips: places.options.slice(0, 8).map(option => ({
      place: option.place, count: option.count || 0, label: `+ ${option.place} · ${number(option.count)}`,
      title: counted('openRoles', option.count) + examples(option) + t('helperRest.coverageReadOnce'),
    })),
    at: verdict.at || '',
  };
}

// "Roles that fit you" (src/ai/role_ideas.py): the Profile's roles as chips, with the open jobs each would add; the ones set aside never shown.
// With an AI this is the one row of role suggestions (owner, 26 Oct 2026, audit PR 6): `narrow` says how much the role words catch when the
// coverage check found them tight (under a tenth, src/coverage.py) and one idea adds 5 or more open jobs.
export function ideasCard(ideas, setAside = [], verdict = null) {
  const hidden = new Set(setAside.map(word => String(word).toLowerCase()));
  const shown = (ideas || []).filter(idea => idea?.word && !hidden.has(idea.word.toLowerCase())).slice(0, 8);
  if (!shown.length) return null;
  const narrow = verdict?.tight && shown.some(idea => (idea.count || 0) >= 5)
    ? t('helperRest.ideasNarrow', {matched: number(verdict.matched), total: number(verdict.in_places)}) : '';
  return {narrow, title: t('helperRest.coverageFitRoles'), text: t('helperRest.ideasLead'),
    chips: shown.map(idea => ({term: idea.word, count: idea.count || 0, role: idea.role, why: idea.why, label: `+ ${idea.role} · ${idea.count || 0}`, title: t('helperRest.ideaSearch', {why: idea.why, word: idea.word, jobs: counted('openJobs', idea.count)})})),
    at: shown.map(idea => idea.word).join('|')};
}
