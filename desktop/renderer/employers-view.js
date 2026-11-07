import '../i18n/screens-helpers.js';
import {number} from '../i18n/format.js';
import {t} from '../i18n/index.js';
// Employers & Sources, without a window (pages/employers.js draws it): the filter, a feed status's tone, the stats line, an employer's
// research links and detail lines. Field names: src/stores/base.py EMPLOYER_FIELDS. Guarded by test/unit/renderer/employers-view.test.js.
import {shortDay} from './date.js';

// Feed status (the 🏢 Employers & Sources select) → tone: found good, nothing open info, weak warn, watched by hand bad, no feed neutral.
export const FEED_TONES = {'Feed found': 'good', 'No open jobs': 'info', 'Low relevance': 'warn', 'Manual watch': 'bad', 'No public feed': 'neutral'};
export const feedTone = status => FEED_TONES[status] || 'neutral';

// What each status means and what happens next (the scout's check: src/scout.py check_one, src/scout_notion.py employer_record).
export const FEED_HELP = {
  'Feed found': t('helperRest.feedFoundHelp'),
  'Low relevance': t('helperRest.feedLowHelp'),
  'No open jobs': t('helperRest.feedEmptyHelp'),
  'Manual watch': t('helperRest.feedManualHelp'),
  'No public feed': t('helperRest.feedNoneHelp'),
};
export const feedHelp = status => FEED_HELP[status] || '';

// Quality column: the scale and what it adds up (src/scout_probe.py quality). A row's own counts follow in its notes.
export const QUALITY_HELP = t('helperRest.qualityHelp');
/** Describe the quality score while retaining the employer’s original notes. */
export const qualityHelp = row => [t('helperRest.qualityOf', {score: number(row.quality)}), row.notes].filter(Boolean).join(' ');

const words = row => [row.name, row.website, row.cities, row.relevant_roles, row.ats, row.slug, row.notes, row.origin, row.kind, row.size]
  .filter(Boolean).join(' ').toLowerCase();

// {text, kind, feed, active: '' | 'on' | 'off'}
export function filterEmployers(rows, {text = '', kind = '', feed = '', active = ''} = {}) {
  const needle = text.trim().toLowerCase();
  return (rows || []).filter(row => (!needle || words(row).includes(needle)) && (!kind || (row.kind || 'Employer') === kind)
    && (!feed || row.feed_status === feed) && (!active || !!row.active === (active === 'on')));
}

// The feed statuses present, in the select's order, then any other value the store holds.
export function feedStatuses(rows) {
  const present = new Set((rows || []).map(row => row.feed_status).filter(Boolean));
  return [...Object.keys(FEED_TONES).filter(status => present.has(status)), ...[...present].filter(status => !(status in FEED_TONES)).sort()];
}

/** Summarize employer counts without changing feed statuses or filtering. */
export function statsLine(rows, shown = rows) {
  const all = rows || [], active = all.filter(row => row.active).length, boards = all.filter(row => row.kind === 'Job board').length;
  const feeds = all.filter(row => row.feed_status === 'Feed found').length;
  const head = t('helperRest.employerStats', {total: number(all.length), active: number(active), feeds: number(feeds)}) + (boards ? ` · ${t('helperRest.employerBoards', {count: boards})}` : '');
  return shown.length === all.length ? head : t('helperRest.shownOf', {shown: number(shown.length), text: head});
}

// The job system and its board name ("greenhouse · acme"), or the feed's host, or ''.
export function feedName(row) {
  if (row.ats) return [row.ats, row.slug].filter(Boolean).join(' · ');
  try { return row.feed ? new URL(row.feed).hostname : ''; } catch { return ''; }
}

// Links to open: [label, url]; only http(s).
export function researchLinks(row) {
  return [[t('helperRest.website'), row.website], [t('helperRest.careers'), row.careers_url], [t('helperRest.feed'), row.feed], ['Glassdoor', row.glassdoor], ['levels.fyi', row.levels_fyi]]
    .filter(([, url]) => /^https?:\/\//i.test(String(url || '')));
}

// The muted line under the name: cities, size, relevant roles.
/** Show employer metadata while preserving stored cities and role text. */
export const metaLine = row => [row.cities, row.size && t('helperRest.people', {count: row.size}), row.relevant_roles].filter(Boolean).join(' · ');

// The rest of the record, for the row's detail: [label, value] with a value only.
/** Label nonempty employer facts for display without rewriting their content. */
export function detailLines(row) {
  const yes = value => (value === true ? t('helperRest.yesLower') : value === false ? t('helperRest.noLower') : value);
  return [[t('helperRest.notes'), row.notes], [t('helperRest.integration'), row.integration], [t('helperRest.verification'), row.verification],
    [t('helperRest.preferredPlaces'), yes(row.in_preferred_places)], [t('helperMore.added'), day(row.added || row.created_at)]]
    .filter(([, value]) => value !== undefined && value !== null && value !== '');
}

// The table's sortable columns (renderer/table-sort.js). Feed status sorts in the select's order (found first); blanks go last.
export const SORT_COLUMNS = [
  {key: 'name', label: t('helpers.employer'), type: 'words', value: row => row.name},
  {key: 'kind', label: t('helperRest.kind'), type: 'words', value: row => row.kind || 'Employer'},
  {key: 'feed', label: t('helperRest.feed'), type: 'number', value: row => (row.feed_status ? -(Object.keys(FEED_TONES).indexOf(row.feed_status) + 1 || Object.keys(FEED_TONES).length + 1) : null)},
  {key: 'quality', label: t('helperRest.quality'), type: 'number', tip: QUALITY_HELP, value: row => (row.quality === '' ? null : row.quality)},
  {key: 'origin', label: t('helperRest.origin'), type: 'words', value: row => row.origin},
  {key: 'checked', label: t('helperRest.checked'), type: 'date', value: row => (row.checked ? Date.parse(row.checked) || null : null)},
  {key: 'active', label: t('helperFlow.active'), type: 'flag', value: row => (row.active ? 1 : 0)},
];

// The date a row was checked, in the screens' one format (date.js).
export const day = (iso, now = Date.now()) => shortDay(iso, now);
