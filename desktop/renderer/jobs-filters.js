// Jobs page, the filters in ONE multi-select: the old "Show" menu and the saved-view chips merged, each filter once, ticked together (a job
// shows when ANY ticked filter holds it). No DOM here so the tests can check it. Guarded by: test/unit/renderer/jobs-filters.test.js. Drawn by pages/jobs-filter-menu.js.
import '../i18n/screens-helpers.js';
import {t} from '../i18n/index.js';
import {isInbound} from './origin.js';
import {VIEWS} from './jobs-board-rules.js';
import {isSent, openMatches} from './jobs-view.js';

// Why (13 Nov 2026, owner: "when I open the app, it filters for latest/new matches... which shows me 0 jobs. I should always start as the default with \"total matches\""): the one start
// value, read by pages/jobs-state.js (the first list), Clear and "nothing ticked". All matches holds exactly what the Total matches counter counts (jobCounts: every match but the applied ones),
// so the list never opens empty after a person looked at every job; New matches is one tick away.
export const DEFAULT_FILTERS = ['all'];
// Saved and Dismissed live on both the old menu (a status) and the chips (a stage): one option each. A job counts when either says so
// (columnOf folds the status into the stage), so neither old list loses a job.
const STATUS_OPTIONS = [
  {id: 'open', label: t('helperFlow.newMatches'), title: t('helperFlow.undecidedJobs'), test: job => !isInbound(job) && job.status === 'unreviewed'},
  {id: 'applied', label: t('helpers.stageApplied'), title: t('helperFlow.appliedMatches'), test: isSent},   // Why (df 2/2, owner 13 Nov 2026: "Sent only"): the same rule as the Applied card (jobs-view.js isSent)
  {id: 'saved', label: t('helpers.savedPlain'), title: t('helperFlow.savedJobs'), test: (job, now) => (!isInbound(job) && job.status === 'saved') || VIEW_TEST.saved(job, now)},
  {id: 'dismissed', label: t('helpers.stageDismissed'), title: t('helperFlow.setAsideJobs'), test: (job, now) => (!isInbound(job) && job.status === 'dismissed') || VIEW_TEST.dismissed(job, now)},
];
const VIEW_TEST = Object.fromEntries(VIEWS.map(view => [view.id, view.test]));
const VIEW_LABEL = {all: t('helperFlow.anyStage')};   // "All" beside "All matches" read as the same thing
const SHARED = new Set(['saved', 'dismissed']);
export const FILTER_GROUPS = [
  {name: t('helperFlow.jobMatches'), options: [...STATUS_OPTIONS,
    {id: 'all', label: t('helperFlow.allMatches'), title: t('helperFlow.everyMatch'), test: job => openMatches([job]).length > 0}]},
  {name: t('helperFlow.yourApplications'), options: VIEWS.filter(view => !SHARED.has(view.id)).map(view => ({
    id: `view:${view.id}`, label: VIEW_LABEL[view.id] || view.label, title: view.title, test: view.test}))},
  {name: t('helperFlow.foundYou'), options: [{id: 'inbound', label: t('helperFlow.inbound'), title: t('helperFlow.inboundPeople'), test: isInbound}]},
  {name: t('helperFlow.everything'), options: [{id: 'everything', label: t('helperFlow.everything'), title: t('helperFlow.matchesAndInbound'), test: () => true}]},
];
export const FILTER_OPTIONS = FILTER_GROUPS.flatMap(group => group.options);
const BY_ID = new Map(FILTER_OPTIONS.map(option => [option.id, option]));
export const isFilter = id => BY_ID.has(id);

// What is ticked, kept valid: known ids only, never empty (nothing ticked is the default, All matches).
export const normalize = ids => {
  const known = [...new Set(ids || [])].filter(isFilter);
  return known.length ? known : [...DEFAULT_FILTERS];
};
// The jobs the ticked filters hold: any of them.
export const inFilters = (job, ids, now = Date.now()) => ids.some(id => BY_ID.get(id)?.test(job, now));
// Inside a list a counter chose (its own jobs, applied ones too), the match lists' own narrowing steps aside: All matches / Everything let every one through.
export const inFiltersLoose = (job, ids, now = Date.now()) => ids.some(id => id === 'all' || id === 'everything') || inFilters(job, ids, now);
// The one menu value an old caller or a counter means, when exactly one filter is ticked; '' when several are.
export const soleFilter = ids => (ids.length === 1 ? ids[0] : '');
export const countFor = (jobs, id, now = Date.now()) => jobs.filter(job => BY_ID.get(id).test(job, now)).length;
// Ticking toggles one filter; unticking the last one goes back to the default (All matches).
export const toggled = (ids, id) => normalize(ids.includes(id) ? ids.filter(one => one !== id) : [...ids, id]);
// The words on the button: one name, or the first with "+ n".
export const summary = ids => {
  const names = ids.map(id => BY_ID.get(id)?.label).filter(Boolean);
  return names.length <= 1 ? names[0] || '' : `${names[0]} + ${names.length - 1}`;
};
// Filters that mean something on the board (a stage column): the others (new matches, inbound, all, everything) leave every application showing.
export const BOARD_FILTERS = new Set(['saved', 'applied', 'dismissed', ...VIEWS.filter(view => !SHARED.has(view.id)).map(view => `view:${view.id}`)]);
export const boardIds = ids => ids.filter(id => BOARD_FILTERS.has(id));
// A view option is a narrowing of your applications: the Talking section and the menu's own lists step aside for them.
export const hasViewOption = ids => ids.some(id => id.startsWith('view:'));
// Where "Find more jobs" belongs: the lists that hold job matches you have not decided on. Under Applied, Inbound, Saved, Dismissed or a stage,
// a search would add rows to none of them. Why (2 Nov 2026, owner: a "Find more jobs" card over the Inbound list): one rule, read by pages/jobs-find.js.
export const FINDS_MORE = new Set(['open', 'all', 'everything']);
// The counters above the list whose lists a search adds to (New from the last run); any other counter (Interviews, Stuck) or a fixed
// set of jobs lists applications. Why (#3026, Gitar): a counter sets the filters to "all", which alone would keep the card over the Applied list.
const MATCH_COUNTERS = new Set(['fresh']);
/**
 * True when the list a search can add to is showing: no counter but a match counter is pressed, and a ticked filter (ids from FILTER_OPTIONS) lists job matches.
 * `counter`: the pressed counter (jobsState.statFilter: an id, {urls}, or null). An unknown id counts as no. Pure, never throws.
 */
export const findsMore = (ids, counter = null) => (!counter || MATCH_COUNTERS.has(counter)) && ids.some(id => FINDS_MORE.has(id));
