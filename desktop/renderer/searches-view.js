import '../i18n/screens-helpers.js';
import {number} from '../i18n/format.js';
import {t} from '../i18n/index.js';
// Reports → Searches, the logic without a window (owner, 25 Oct 2026: "all the numbers in the world, how the search was performed"): a list
// row per search run and the sections of one run's full report, from a store run record (src/stores CRON_RUN_FIELDS) and its `details`
// (src/run_details.py: steps, jobs, employers, boards, AI, scoring, problems). Every part is optional: a run from before the details were
// kept shows its totals and says so. Drawn by pages/reports-searches.js. Guarded by test/unit/renderer/searches-view.test.js.
import {costText} from './ai-cost.js';
export const SEARCH_MODES = ['scheduled', 'run', 'first', 'visits', 'scout'];   // the runs that search: Find jobs (any trigger), in the browser, more employers
export const KEPT = 50;                                                          // runs listed (owner, 25 Oct 2026)
const NAMES = {scheduled: 'helperFlow.findJobs', run: 'helperFlow.findJobs', first: 'helperRest.firstJobs', visits: 'helperRest.findBrowser', scout: 'helperRest.moreEmployers'};
const WHERE = {mac: 'helperRest.thisMac', github: 'GitHub', cloud: 'helperRest.inCloud'};
const STAGES = {enrich: 'helperRest.readingJobsAI', kits: 'helperRest.applications', insight: 'helperFlow.insights', interview: 'helpers.interviews', mail: 'helperRest.emails', sources: 'helperRest.readingSources'};
const TONES = {OK: 'good', Quiet: 'neutral', Warnings: 'warn', Failed: 'bad', Running: 'info'};
const n = value => (value === null || value === undefined || value === '' ? null : number(Number(value)));
const some = pairs => pairs.filter(([, value]) => value !== null && value !== undefined && value !== '');

export const isSearchRun = row => SEARCH_MODES.includes(row?.mode || row?.kind);
// A run card or drawer entry links to its full report when it is a finished search run the store keeps (an app-side activity kind: renderer/pages/activity-basics.js KIND).
export const REPORT_KINDS = ['search', 'visits', 'scout'];
export const hasFullReport = run => !!run && !run.live && !!run.pageId && REPORT_KINDS.includes(run.kind);
/** Name a search run for display without changing its stored kind. */
export const kindName = row => t(NAMES[row?.mode || row?.kind] || 'helperRest.search');
export const secondsOf = row => row?.stats?.duration_s ?? (row?.finished_at && row?.started_at ? Math.round((Date.parse(row.finished_at) - Date.parse(row.started_at)) / 1000) : null);
/** Format the report duration in the selected display language. */
export const duration = seconds => (seconds === null || seconds === undefined ? '–' : seconds < 90 ? t('helperRest.seconds', {count: number(seconds)}) : t('helperRest.minutes', {count: number(Math.round(seconds / 60))}));

// The latest search runs, newest first.
export const searchRuns = rows => (rows || []).filter(isSearchRun).sort((a, b) => String(b.started_at).localeCompare(String(a.started_at))).slice(0, KEPT);

export function listRow(row) {
  const added = row.stats?.new_jobs;
  return {id: row.id, at: row.started_at, name: kindName(row), where: row.where === 'github' ? 'GitHub' : WHERE[row.where] ? t(WHERE[row.where]) : '', by: row.trigger || '', seconds: secondsOf(row),
    added: added === undefined ? null : added, outcome: row.status === 'Running' ? 'Running' : row.status || 'OK', tone: TONES[row.status] || 'neutral',
    kept: !!row.details};
}

/** Summarize visible search runs with locale-aware plural wording. */
export const listLine = (runs, shown = runs) => (!runs.length ? '' : shown.length === runs.length ? t('helperRest.searchesNewest', {count: runs.length}) : t('helperRest.searchesShown', {shown: number(shown.length), total: number(runs.length)}));

const money = usd => costText(usd) || null;   // only on the user's own API key (ai-cost.js)
const cell = ([label, value]) => ({label, value});
const share = (value, total) => (!total || !value ? 0 : Math.max(2, Math.min(100, Math.round(value / total * 100))));

// The report of one run, as widgets: `tiles` (the main figures, each with an icon and a tone: components summaryTiles) and `cards` in reading order.
// A card is {id, category, title, ...}: kind 'steps' (bars sized by seconds), 'funnel' (bars from postings to your list, chips of what dropped them),
// 'facts' (a number strip + chips), 'boards' (a row per board), 'list' (lines or none), 'fold' (closed by default).
export function report(row) {
  const d = row.details || {}, stats = row.stats || {}, jobs = d.jobs || {}, boards = d.boards || {}, employers = d.employers || {};
  const added = jobs.added ?? stats.new_jobs;
  const tiles = [
    added !== undefined && added !== null && {icon: 'plus', tone: added > 0 ? 'good' : 'neutral', label: t('helperRest.addedToList'), value: n(added)},
    jobs.fetched !== undefined && {icon: 'globe', tone: 'info', label: t('helperRest.postingsSeen'), value: n(jobs.fetched)},
    jobs.in_places !== undefined && {icon: 'pin', tone: 'teal', label: t('helperRest.inYourPlaces'), value: n(jobs.in_places)},
    jobs.matched !== undefined && {icon: 'target', tone: 'signal', label: t('helperRest.matchYourRoles'), value: n(jobs.matched)},
    employers.employers_checked !== undefined && {icon: 'building', tone: 'violet', label: t('helperRest.employersChecked'), value: n(employers.employers_checked)},
    secondsOf(row) !== null && {icon: 'clock', tone: 'neutral', label: t('helperRest.time'), value: duration(secondsOf(row))},
  ].filter(Boolean);
  const cards = [];
  if (!row.details) cards.push({id: 'note', kind: 'list', category: t('helperRest.detailsUpper'), title: t('helperRest.notKeptRun'), lines: [t('helperRest.beforeRunRecords')]});
  const steps = d.steps || [], total = steps.reduce((sum, step) => sum + (step.secs || 0), 0);
  if (steps.length) cards.push({id: 'steps', kind: 'steps', category: t('helperRest.howRan'), title: t('helperRest.searchStepByStep'),
    steps: steps.map(step => ({label: step.label, at: duration(step.at_s), took: duration(step.secs), share: share(step.secs, total)}))});
  if (Object.keys(jobs).length) {
    const bars = some([[t('helperRest.postingsSeen'), jobs.fetched, 'info'], [t('helperRest.inYourPlaces'), jobs.in_places, 'teal'], [t('helperRest.matchYourRoles'), jobs.matched, 'signal'], [t('helperRest.addedToList'), jobs.added, 'good']])
      .map(([label, value, tone]) => ({label, value: n(value), share: share(value, jobs.fetched), tone}));
    const other = jobs.title_hits !== undefined ? Math.max(0, jobs.title_hits - (jobs.matched || 0)) : null;
    cards.push({id: 'jobs', kind: 'funnel', category: t('helperRest.jobsUpper'), title: t('helperRest.postingsToList'), bars: bars.filter(bar => bar.value !== null),
      cells: some([[t('helperRest.changed'), n(jobs.changed)], [t('helperRest.expired'), n(jobs.expired)], [t('helperRest.matchedElsewhere'), n(other)]]).map(cell),
      chips: (jobs.dropped || []).map(item => ({label: t('helperRest.droppedFilter', {filter: item.filter}), detail: n(item.count), tone: 'warn'}))});
  }
  const empCells = some([[t('helperRest.employersChecked'), n(employers.employers_checked)], [t('helperRest.pagesRead'), n(employers.feeds)], [t('helperRest.pagesFailed'), n(employers.feed_errors)],
    [t('helperRest.hadMatchingJob'), n(employers.matched)], [t('helperRest.ideasLeft'), n(employers.pending)], [t('helperRest.checkedPerRun'), n(employers.batch)]]);
  if (empCells.length) cards.push({id: 'employers', kind: 'facts', category: t('helperRest.employersUpper'), title: t('helperRest.employers'), cells: empCells.map(cell),
    chips: employers.feed_errors ? [{label: t('helperRest.somePagesFailed'), tone: 'warn'}] : [{label: t('helperRest.everyPageRead'), tone: 'good'}]});
  if ((boards.list || []).length || Object.keys(boards).length) {
    const chips = some([[t('helperRest.sitesRefused'), boards.refused_reads, 'warn'], [t('helperRest.askedSlowDown'), boards.refused_slow_down, 'warn'], [t('helperRest.showedBotCheck'), boards.refused_captcha, 'warn'],
      [t('helperState.stopped'), boards.refused_stopped, 'warn'], [t('helperRest.afterScripts'), boards.headless_reads, 'info'], [t('helperRest.leftOpenManually'), boards.left_to_open, boards.left_to_open ? 'bad' : 'good']])
      .map(([label, value, tone]) => ({label, detail: n(value), tone}));
    cards.push({id: 'boards', kind: 'boards', category: t('helperRest.jobBoardsUpper'), title: boards.read === undefined ? t('helperRest.jobBoards') : t('helperRest.boardsRead', {count: boards.read, shown: n(boards.read)}),
      rows: (boards.list || []).map(item => ({name: item.name, jobs: n(item.jobs), relevant: n(item.relevant)})), chips});
  }
  const ai = Object.entries(d.ai || {}).filter(([stage]) => STAGES[stage]);
  const calls = ai.reduce((sum, [, info]) => sum + (info.cli_calls || 0) + (info.api_calls || 0), 0);
  const tokens = ai.reduce((sum, [, info]) => sum + (info.tokens_in || 0) + (info.tokens_out || 0), 0);
  if (ai.length || stats.billed_to) cards.push({id: 'ai', kind: 'facts', category: 'AI', title: 'AI',
    cells: some([[t('helperRest.calls'), n(calls || null)], [t('helperRest.tokens'), n(tokens || null)], [t('helperRest.cost'), money(stats.ai_cost_usd)]]).map(cell),
    chips: [...ai.map(([stage, info]) => ({label: t(STAGES[stage]), detail: info.model || info.provider || '', tone: 'info'})), ...(stats.billed_to ? [{label: stats.billed_to, tone: 'neutral'}] : [])]});
  const scoring = {...(d.scoring || {}), ...(d.ai?.score ? {model: d.ai.score.model, usd: d.ai.score.usd, tokens: (d.ai.score.tokens_in || 0) + (d.ai.score.tokens_out || 0)} : {})};
  if (Object.keys(scoring).length || stats.scored) cards.push({id: 'scoring', kind: 'fold', category: t('helperRest.scoringUpper'), title: t('helperState.scoringTask'), lines: some([
    [t('helperRest.scored'), n(scoring.done ?? stats.scored)], [t('helpers.failed'), n(scoring.failed)], [t('helperRest.waitingRefresh'), n(scoring.waiting)], [t('helpers.notScored'), n(scoring.pending)],
    [t('helperRest.topNewScore'), n(stats.top_new_score)], [t('helperRest.model'), scoring.model], [t('helperRest.tokens'), n(scoring.tokens)], [t('helperRest.cost'), money(scoring.usd)]]).map(([label, value]) => `${label}: ${value}`)});
  cards.push({id: 'problems', kind: 'list', category: t('helperRest.problemsUpper'), title: d.problems?.length ? t('helperRest.problems', {count: d.problems.length}) : t('helperRest.noProblems'),
    tone: d.problems?.length ? 'warn' : 'good', lines: d.problems || []});
  if (!row.details) cards.push({id: 'totals', kind: 'facts', category: t('helperRest.totalsUpper'), title: t('helperRest.rowKept'), cells: some([[t('helperRest.newJobs'), n(stats.new_jobs)], [t('helperRest.changed'), n(stats.changed_jobs)],
    [t('helperRest.employerPagesRead'), n(stats.feeds)], [t('helperRest.pagesFailed'), n(stats.feed_errors)], [t('helperRest.expired'), n(stats.closed_stale)], [t('helperRest.tokens'), n(stats.tokens_total)], [t('helperRest.aiCost'), money(stats.ai_cost_usd)]]).map(cell), chips: []});
  const log = String(row.log || '').split('\n').filter(Boolean);
  if (log.length) cards.push({id: 'log', kind: 'fold', category: t('helperRest.rawUpper'), title: t('helperRest.technicalLog'), lines: log, mono: true, wide: true});
  // Two small cards per row (the shared .card-grid, card-grid.js), a wide one (the Technical log) last on its own row (owner, 25 Oct 2026: "Technical log should
  // be last, full-row. The others, which have fixed height, and not too much content, they can 2 columns per row"). Guard: test/unit/renderer/searches-view.test.js.
  return {tiles, cards: [...cards.filter(card => !card.wide), ...cards.filter(card => card.wide)]};
}

// What a list row shows at a glance: the run's one-line meta (when is drawn by the page).
/** Join a search row’s display metadata, preserving its trigger value. */
export const metaOf = view => [view.where, duration(view.seconds), view.by && t('helperRest.startedBy', {by: view.by})].filter(Boolean).join(' · ');
