import '../i18n/screens-helpers.js';
import {t, getLocale} from '../i18n/index.js';
import {date, number} from '../i18n/format.js';
// The "Find jobs" card on top of Jobs, as data (pure): which of its five states shows (empty first run, searching, done, failed, none), the step chips
// with the one that is running, the last lines in words, and the one number (jobs added). Drawn by pages/jobs-find.js. Guarded by: test/unit/renderer/find-card.test.js.
// Spec: docs/superpowers/specs/2026-10-16-first-jobs-fast.md
import {readableLog} from './human-log.js';
import {hasFullReport} from './searches-view.js';

// A first run reads a slice and scores 3 jobs first; the usual run starts with the employer sites. The latest line that matches a step is the
// running one. The job boards are read beside the employer sites (src/sources/boards_ahead.py, the web search from second 0), so their chip
// is not moved by the others' order: it runs from its first line or the employer read, and shows ✓ only on the engine's "Job boards: done"
// (src/sources/aggregators.py scan) or once a step after it starts (owner, 26 Oct 2026: ✓ showed before the boards a web search found were read).
export const FIRST = /^(Finding your first jobs|First jobs:)/;
const EMPLOYERS = /^(Checking employer|Reading employer|⏳ Reading employer|Titles:|Places:|⏳ Scoring|Scored |Added |Job Matches)/;
const BOARDS = {label: t('helperRest.jobBoards'), match: /^(Searching job boards|Job boards( found| first)?:|⏳ Reading job boards)/, done: /^Job boards: done\b/, beside: true};
const MORE = /^(Searching wider|Growing your sources|Source scout|🔭)/;   // Growing your sources: the line older runs printed (kept so their logs still draw)
const WEB = {label: t('helperGuide.webSearch'), web: true, beside: true};   // its own chip, beside the others (webSearchChip)
const SLICE_END = /^First jobs: (\d+ scored|\d+ found, none to score)/;
const STEPS = {
  first: [{label: t('helperRest.firstJobs'), match: FIRST}, WEB, {label: t('helperGuide.allEmployers'), match: EMPLOYERS}, BOARDS, {label: t('helperGuide.widerSearch'), match: MORE}],
  usual: [WEB, BOARDS, {label: t('helperGuide.employerSites'), match: EMPLOYERS}, {label: t('helperGuide.widerSearch'), match: MORE}],
};

export function stepChips(log = []) {
  const first = log.some(line => FIRST.test(String(line)));
  const steps = STEPS[first ? 'first' : 'usual'], order = steps.filter(step => !step.beside);   // the steps that follow each other
  let active = 0, sliceDone = !first, boardsSeen = false, boardsDone = false;   // the slice reads feeds and scores too: its own lines are not the "All employers" step
  for (const raw of log) {
    const line = String(raw);
    if (SLICE_END.test(line)) sliceDone = true;
    if (BOARDS.match.test(line)) boardsSeen = true;
    if (BOARDS.done.test(line)) boardsDone = true;
    order.forEach(({match}, i) => { if (match.test(line) && i >= active && (sliceDone || i === 0 || i > 1)) active = i; });
  }
  const employers = order.findIndex(step => step.match === EMPLOYERS);
  const state = i => (i < active ? 'done' : i === active ? 'active' : 'pending');
  const web = webSearchChip(log), last = active === order.length - 1;   // a search that never said a word about it, at its last step: not run
  return steps.map(step => (step.web ? (web.state === 'pending' && last ? {label: t('helperGuide.webNotRun'), state: 'skipped'} : web) : {label: step.label, state: !step.beside ? state(order.indexOf(step))
    : boardsDone || last ? 'done' : boardsSeen || active >= employers ? 'active' : 'pending'}));
}

// The web search's own chip (owner, 26 Oct 2026: "why I don't see here a chip with Web Search?"), its state in words from the engine's lines
// (src/sources/board_web.py): searching, the boards it found, rested until its next date (when it last searched in the note), off (why in the
// note) or no answer. Guarded by: test/unit/renderer/live-updates.test.js.
const day = iso => getLocale() === 'en' ? new Date(iso).toLocaleDateString('en-GB', {day: 'numeric', month: 'short'}) : date(iso, {day: 'numeric', month: 'short'});
const clock = iso => new Date(iso).toLocaleTimeString('en-GB', {hour: '2-digit', minute: '2-digit'});
const boardCount = names => names.replace(/\([^)]*\)/g, '').split(',').filter(name => name.trim()).length;   // "A (x, y), B" is 2 boards
const SAME_RUN = /^Job boards: no web search: searched in this run/;
export function webSearchChip(log = []) {
  let chip = {label: t('helperGuide.webSearch'), state: 'pending'}, m;
  for (const raw of log) {
    const line = String(raw);
    if (SAME_RUN.test(line)) continue;   // a second ask in this run: no news
    if (/^Job boards: (searching the web|the web search is still searching)/.test(line)) chip = {label: t('helperGuide.webSearch'), state: 'active'};
    else if ((m = /^Job boards: a web search found (.+)$/.exec(line))) {
      const n = /^no trade or local board/.test(m[1]) ? 0 : boardCount(m[1]);
      chip = {label: t('helperGuide.webFound', {found: n ? t('helperGuide.boardsFound', {count: n}) : t('helperGuide.noneFound')}), state: 'done', note: m[1]};
    } else if ((m = /^Job boards: no web search: searched (\S+), next after (\S+?);/.exec(line))) {
      chip = {label: t('helperGuide.webUntil', {day: day(m[2])}), state: 'skipped', note: t('helperGuide.searchedAgain', {day: day(m[1]), time: clock(m[1]), next: day(m[2])})};
    } else if ((m = /^Job boards: no web search: (.+)$/.exec(line))) {
      chip = {label: /^searched lately/.test(m[1]) ? t('helperGuide.webRested') : t('helperGuide.webOff'), state: 'skipped', note: m[1]};
    } else if (/^Job boards: the web search .*did not answer/.test(line)) chip = {label: t('helperGuide.webNoAnswer'), state: 'failed', note: line.replace(/^Job boards: /, '')};
  }
  return chip;
}

// Live updates (owner, 26 Oct 2026: "Keep each step's result visible: 'web search found…', 'boards read', 'employers stopped'"): every step's
// result line of this run, in words, kept until it ends, then the newest progress tick, last; ticks replace each other. A result is a line the
// engine starts with a step's name (and the scoring, added and digest lines); per-item lines (one employer, one job, one AI answer) are the
// technical log's, in Recent activity. Why (#live-updates-3-lines, owner 27 Oct 2026: "why we're showing so many lines of the log updates"): one board's
// "Job boards found: <board> N jobs, M relevant" is a per-item line like an employer's, so it is not in RESULT; the step's one summary line
// ("Job boards: done, N jobs for your search") stays. Guarded by: test/unit/renderer/live-updates.test.js.
const RESULT = /^((First jobs|Job boards|Job boards first|Employers|Titles|Places|Source scout|Warning): |Scored \d+ of |Added \d+ new job|Digest ready|⏱ Time is up \()/;
export function liveLines(log = []) {
  const results = [], tick = [];
  let matches = 0;
  for (const raw of log) {
    const line = String(raw);
    if (/^⏳ (?!Still running)/.test(line)) tick[0] = line;
    else if (RESULT.test(line) && !SAME_RUN.test(line)) results.push(line);
    else if (COUNTS.test(line)) matches = Number(COUNTS.exec(line)[2]);
  }
  // the tick says the jobs that match so far (owner, 26 Oct 2026: "13 pilot jobs found" showed nowhere while 1,221 listings were read)
  if (tick[0] && matches) tick[0] += t('helperGuide.matchingSoFar', {count: number(matches)});
  return readableLog([...results, ...tick]);
}

// This search's own numbers: the engine's last "Run counts: looked=N matches=M scored=K" line (src/run_counts.py, each job once by its URL).
const COUNTS = /^Run counts: looked=(\d+) matches=(\d+) scored=(\d+)(?: good=(\d+))?\s*$/;
export function runCounts(log = []) {
  for (let i = log.length - 1; i >= 0; i--) {
    const found = COUNTS.exec(String(log[i]));
    if (found) return {looked: Number(found[1]), matches: Number(found[2]), scored: Number(found[3]), good: Number(found[4] || 0)};
  }
  return {looked: 0, matches: 0, scored: 0, good: 0};
}

// The one number a run result shows (owner, 24 Oct 2026: "jobs added to the list", scoring and its queue are internal): the jobs this run added to the
// user's list. A finished run has its own record (run.new); a running one adds up the engine's "Added N new job(s)" lines (src/daily_search.py).
export function addedSoFar(log = []) {
  return (log || []).reduce((sum, line) => sum + Number((/^Added (\d+) new job/.exec(String(line)) || [])[1] || 0), 0);
}
/** Describe jobs added to the list using the display language’s plural form. */
export const addedWords = (n, text = t) => (n ? text('helperGuide.addedJobs', {count: n}) : text('helperGuide.noAddedJobs'));

// The employer read as progress: the latest "Reading employer job sites: 1953 of 2251" ticker line (src/progress.py), or null before it starts.
// When time ran out, the engine's "Employers: read 78 of 608 sites in the time" ends the bar there, not at the last tick (owner, 26 Oct 2026).
export function employersRead(log = []) {
  for (let i = log.length - 1; i >= 0; i--) {
    const stopped = /^Employers: read (\d+) of (\d+) sites in the time/.exec(String(log[i]));
    if (stopped) return {done: Number(stopped[1]), total: Number(stopped[2]), stopped: true};
    const found = /Reading employer job sites: (\d+) of (\d+)/.exec(String(log[i]));
    if (found) return {done: Number(found[1]), total: Number(found[2])};
  }
  return null;
}

// The sites a search that ended at the limit had read, from the engine's own count ({done, total}); {} when it reported none (no number is invented).
export const partialSites = log => { const sites = employersRead(log || []); return sites ? {done: sites.done, total: sites.total} : {}; };
// How a search that ended at the 3-minute limit says so, lower-case, for a title or a lead: with the engine's count when it gave one, else without any number (#3108).
/** Describe the search time limit using only the employer counts the engine reported. */
export const limitWords = (sites = {}, {text = t, formatNumber = number} = {}) => text('helperGuide.endedLimit')
  + (sites.total ? text('helperGuide.searchedSites', {done: formatNumber(sites.done), total: formatNumber(sites.total)}) : '');
// The title of a search that ended at the 3-minute limit (#3108): says so, how many employer sites it read when the engine reported that, and the jobs it did add.
// Never "No jobs added to your list" alone: that reads as a finished search that found nothing. Used by the result card, the pop-up and the Find card.
/** Name a partial search result with its known site counts and added jobs. */
export const partialWords = (run, added = 0, options = {}) => (options.text || t)('helperGuide.partial', {text: limitWords(partialSites(run?.log), options)})
  + (added ? ` · ${addedWords(added, options.text)}` : '');

// The bar under the numbers: counted once the engine says "N of M" employers, a sliding bar before (the search is working, the count is not known yet).
export const readProgressModel = employers => (employers
  ? {kind: 'count', done: employers.done, total: employers.total, percent: employers.total ? Math.max(2, Math.min(100, Math.round(100 * employers.done / employers.total))) : 2}
  : {kind: 'indeterminate'});

// running: window.pilot.runs().running; last: the newest finished search run; listed/scored: the Jobs list's counts (kept for the none state); anyJob: the list holds a job, a match or not (jobCounts); finishedHere: a search ended while this window was open.
export function findCard({running = null, last = null, lastSearchAt = '', listed = 0, scored = 0, anyJob = false, finishedHere = false} = {}) {
  // Why (4 Nov 2026, owner: "should not appear if there are more than 0 jobs"): listed counts matches only, so jobs tracked by hand or from email read as an empty list.
  const hasJobs = !!listed || anyJob;
  const searching = running && (running.kind || 'search') === 'search';
  if (searching) {
    const log = running.log || [];
    return {state: 'searching', chips: stepChips(log), lines: liveLines(log), ...runCounts(log), added: addedSoFar(log), employers: employersRead(log), first: log.some(line => FIRST.test(String(line)))};
  }
  if (last && last.ok === false && (finishedHere || !hasJobs)) return {state: 'failed', problem: last.problem || last.result || '', listed};
  if (finishedHere && last) return {state: 'done', listed, runId: hasFullReport(last) ? last.pageId : null, added: last.new ?? addedSoFar(last.log), ...runCounts(last.log), ...(last.endedByTime ? {partial: partialSites(last.log)} : {})};
  if (!lastSearchAt && !hasJobs) return {state: 'empty'};
  // Why (5 Nov 2026, owner: "make sure you don't affect the small card logic"): one small card for everyone past the empty first run, whatever their search history.
  return {state: 'none'};
}

// "empty" (no jobs yet) and "failed" (with none listed) depend on the list's count: before the list is read, the card keeps its first paint
// (never the big empty card over a full list for a moment).
export const waitsForList = (model, listKnown) => !listKnown && (model.state === 'empty' || model.state === 'failed');

// What the next start paints first (renderer/late-blocks.js): the card as drawn, but a search done in this window is "Find more jobs" in the next one
// (finishedHere starts false there), and a running search keeps only its shape, not its lines.
export function keptFindCard(model) {
  if (model.state === 'done') return {state: 'none'};
  if (model.state === 'searching') return {...model, lines: model.lines.slice(-3)};
  return model;
}
