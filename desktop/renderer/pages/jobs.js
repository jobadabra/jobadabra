// Jobs: loading and reloading the list, adding jobs, init(); the pieces are jobs-state/-render/-fit/-lead/-questions.js. Guarded by: search-changed, live-status-line, live-count, activity-selection-kept tests.
import '../../i18n/screens-pages.js';
import {t} from '../../i18n/index.js';
import {askLinkedinOnPress} from './linkedin-consent.js';
import {badgeLabel} from '../badge-label.js';
import {setCount} from '../components.js';
import {applicationStats, inboundCount, inProcess, jobCounts, statClick, takenDown, talkingStartsOpen, toReview} from '../jobs-view.js';
import {shared} from './shared.js';
import {keepRunLine} from '../run-lines.js';
import {refreshBusy, showSearchChanged, wireSearchChanged} from '../search-changed.js';
import {showProfileEmpty, wireProfileEmpty} from '../profile-empty.js';
import {openActivity, refreshActivity, showSearchStatus} from './activity.js';
import {paintFindCardFirst, renderFindCard, showFindRefused, wireFindCard} from './jobs-find.js';
import {$, message, savedAgo} from './core.js';
import {refreshSessions, sessionJob, sessionList} from './sessions.js';
import {sayRefused, toastMessage} from './startup.js';
import {releaseOrder, scoreQueueLine} from './score-queue.js';
import {refusal} from '../refusal.js';
import {hostStats, snapshot} from '../intel.js';
import {searchSelect} from '../search-select.js';
import {jobsState, MORE, fullKey, startListRead} from './jobs-state.js';
import {openJobPanel} from './job-panel.js';
import {applySaved, renderJobs, renderStuck, showLoading} from './jobs-render.js';
import {wireScoreCall} from './jobs-score-call.js';
import {scoreFirst} from './score-first.js';
import {noteOutdated} from './rescore-run.js';
import {TALKING_OPEN, paintTalkingFirst, renderTalkingBar} from './jobs-talking.js';
import {paintJobsSuggestionsFirst} from './focus-suggestions.js';
export {renderJobs} from './jobs-render.js';
document.addEventListener('apply-saved', event => applySaved(event.detail));   // Settings → Apply saved a mode: the rows' Apply button names it (apply-settings.js dispatches)
window.addEventListener('claude-help', () => renderJobs());   // Settings' Claude switch: the job menus follow it (claude-help.js)
export {pageKey, fullKey} from './jobs-state.js';
export {openLogFor} from './jobs-lead.js';
import {wireLead} from './jobs-lead.js';
import {wireAdd} from './jobs-add.js';
import {loadQuestions} from './jobs-questions.js';
import {wireViews} from './jobs-views.js';
import {setFilters, wireFilterMenu} from './jobs-filter-menu.js';
import {wireExport} from './jobs-export.js';
import {soleFilter} from '../jobs-filters.js';
import {markReady, refreshReady} from './jobs-ready.js';
import {storeName} from '../store-words.js';
import {jobWrites} from '../job-writes.js';
import {jobPlace} from '../targets.js';
import {wireApplyDialog} from './jobs-apply.js';
import {readThroughStep} from '../apply-readiness-read.js';
import {keepStored, wireTriage} from './jobs-triage.js';
import {plainError} from '../run-warnings.js';
import {isOutdated} from '../errors.js';
import {showOutdatedJobs} from './jobs-outdated.js';

// Every write that changes a job's stage or status ends in jobsChanged(row, patch): that row at once, then the list read again from the store
// (renderer/job-writes.js: a read older than the write is never painted). The other reads of the list go through writes.read for the same reason.
const writes = jobWrites({read: options => window.pilot.jobs(options), paint: fresh => { showJobsData(fresh); renderJobs(); }});
export const jobsChanged = (job = null, patch = {}) => writes.changed(job, patch);
// An application started (Apply, a night's form, Start again, a batch): main marked its job Applying before answering, so the row says so at once
// and the list is read again (#1737: eight forms open, the chips said "Applying 0"). Guarded by test/guards/data/apply-starts-reread.test.js.
const BEFORE_APPLYING = new Set(['', 'Saved', 'Kit ready']);
export const startedApplying = (job = null) => jobsChanged(job, job && BEFORE_APPLYING.has(job.stage || '') ? {stage: 'Applying'} : {});

// Sites that often show a sign-in page instead of the posting (src/notion/ledger.py WALLED): read like any page, with fields for the text in case.
// After "Add a job" / "Applied elsewhere" worked: the result line gets an "Open job" link that closes the dialog and opens that job's drawer.
// The list is read again first, so the drawer gets the row the list shows; a job past the list's limit opens from the result alone.
async function linkToJob(dialogId, messageId, result) {
  const added = result.job;
  await loadJobs();
  if (!added?.jobUrl) return;
  const job = (shared.allJobs || []).find(row => row.url === added.jobUrl || (added.url && row.notion_url === added.url))
    || {url: added.jobUrl, title: added.title, notion_url: added.url};
  const open = document.createElement('button');
  open.type = 'button'; open.className = 'link'; open.textContent = t('pagesJobsFinal.openJob');
  open.addEventListener('click', () => { $(dialogId).close(); openJobPanel(job); });
  $(messageId).append(' ', open);
}

const WALLED = /(^|\.)(linkedin\.com|glassdoor\.[a-z.]+|indeed\.[a-z.]+|levels\.fyi|reddit\.com)$/i;

let freshJobs = false;
let leftOpenAsked = false;  // the start-up question about sessions left open was asked (once per launch)
export async function loadJobs() {
  const landed = startListRead();   // before the kept copy paints: a Start pressed on it waits for the fresh list (jobs-state.js)
  loadQuestions();
  freshJobs = false;
  showLoading();
  jobsState.jobsLoading = true;
  jobsState.claudeReady = (await window.pilot.claudeReady().catch(() => ({ok: false}))).ok;
  try {
    // The last good list at once (lib/view-cache.js), then the fresh one from Notion replaces it.
    if (!shared.allJobs.length) {
      const saved = await window.pilot.cached('jobs');
      if (saved?.result?.jobs) { showJobsData(withoutProfileVerdict(saved.result)); jobsState.jobsLoading = false; renderJobs(); $('jobs-stats').textContent += t('pagesShortJobs.m204', {"savedAgo": savedAgo(saved.at)}); jobsState.jobsLoading = true; }
    }
    const fresh = await writes.read();
    if (fresh) { showOutdatedJobs(false); showJobsData(fresh); freshJobs = !fresh.stale; }  // from Notion now, not the cache: safe to ask about what's still Applying. null: a job was written meanwhile, its own read paints
    else await writes.settled();   // that write's reread paints the fresh list: a Start waits for it too (jobs-state.js)
  } catch (error) {
    if (isOutdated(error)) { shared.allJobs = []; showOutdatedJobs(true); $('jobs-stats').textContent = ''; }   // the app is older than its engine: the Restart card, not the saved list
    else $('jobs-stats').textContent = plainError(t('pagesDynamicJobs.m241', {"message": error.message}));
  }
  jobsState.jobsLoading = false;
  jobsState.jobsRead = true;   // read or failed: the Find jobs card stops waiting for the count
  landed();
  renderFindCard();
  renderJobs();
  if (freshJobs) {
    askAboutLeftOpen();
    // How the fit score relates to what became of each job, as counts per band and state (once a day; the app drops it if reports are off).
    if (shared.allJobs.length) window.pilot.intelSnapshot(snapshot(shared.allJobs), hostStats(shared.allJobs)).catch(() => {});
    if (shared.allJobs.length) window.pilot.benchmarkLines(shared.allJobs.map(job => job.url).filter(Boolean)).then(result => { jobsState.benchmarkText = result?.lines || {}; }).catch(() => {});
  }
}
// Once per launch, on fresh data: sessions left open by the last run whose jobs are still Applying. Keep them, go
// through them one by one (the "Did you submit?" question), or reset them all to Kit ready. A session whose job is
// already Applied never reaches here: main.js ends it as the job list is read (server.reconcileAppliedSessions).
async function askAboutLeftOpen() {
  if (leftOpenAsked || jobsState.jobsLoading || !shared.allJobs.length) return;
  await refreshSessions();
  const open = sessionList.filter(item => item.askAtStart && sessionJob(item).stage === 'Applying');
  leftOpenAsked = true;
  if (!open.length) return;
  const answer = await window.pilot.sessionsLeftOpen(open.map(item => item.id));
  if (answer?.kept) toastMessage(t('pagesShortJobs.m205', {"kept": answer.kept, count: answer.kept}),
    t('pagesDynamicJobs.m242', {count: answer.kept}), {view: 'sessions'}, 'good');
}
let jobsLimit = 200;
async function showMore() {
  const button = $('jobs-more');
  button.disabled = true;
  button.textContent = t('pagesCommon.loading');
  try {
    jobsLimit = shared.allJobs.length + MORE;
    const fresh = await writes.read({limit: jobsLimit});
    if (fresh) showJobsData(fresh);
  } catch (error) {
    toastMessage(t('pagesJobsFinal.loadMoreFailed'), error.message, {view: 'jobs'}, 'bad');
  }
  button.disabled = false;
  renderJobs();
}
// A refresh's lines that change the list while it runs: jobs closed outside your search, scores written to Notion so far. The list is read again
// then, without the loading state, so the counts move as it works (owner, 7 Oct 2026: "I want to see the 2971 decrease live").
// Each scored job counts too (owner, 7 Oct 2026: the total stayed at 51 while a refresh scored), at most one read every RELOAD_MS, the last one
// always made, so the number climbs as the refresh works.
export const LIST_CHANGED = /^First jobs: [1-9]\d* (?:found|scored)|^Jobs so far: [1-9]\d* new|^Closed [1-9]\d* job\(s\)|^Job Matches: \d+ created, \d+ updated \(so far\)|^Scored [1-9]\d* of \d+ job\(s\)$|^Score queue: done$|^Check queue: done$/;   // the last: the queue listed the jobs the search had no time to check (src/press/after_search.py)
export const RELOAD_MS = 10000;
let quietReload = null, lastReload = 0, reloadLater = null;
function reloadQuietly() {
  if (quietReload || reloadLater) return;
  const wait = Math.max(0, lastReload + RELOAD_MS - Date.now());
  reloadLater = setTimeout(() => {
    reloadLater = null;
    lastReload = Date.now();
    quietReload = writes.read().then(fresh => { if (fresh?.jobs) { showJobsData(fresh); renderJobs(); } })
      .catch(() => {}).finally(() => { quietReload = null; });
  }, wait);
}
// Why (#2759, as strategy.js's saved copy): a saved list older than a Profile rebuild would bring "Your Profile is empty" back for the seconds before the fresh read; only the fresh read says it.
const withoutProfileVerdict = ({profile_empty, ...rest}) => rest;
export function showJobsData(data) {
  jobsState.lastJobsData = data;
  renderFindCard();   // its count decides "empty" (no jobs yet)
  keepStored(data.jobs);   // each row's stored apply check, so a restart keeps "Needs you" and "Account needed" (lib/jobs-handlers.js)
  // "Your search changed" until a refresh has finished: the settings as they are now (a refresh that just ended set lastSearchAt).
  wireSearchChanged();
  window.pilot.state().then(state => { shared.state = state; showSearchChanged(state.settings); }).catch(() => {});
  if ('profile_empty' in data) showProfileEmpty(!!data.profile_empty);   // "Your Profile is empty, so fit scores are paused" (#2759): setup ends here
  {
    for (const job of takenDown(shared.allJobs, data.jobs)) {
      toastMessage(t('pagesJobsFinal.postingRemoved'), t('pagesDynamicJobs.m243', {"value1": job.company ? `${job.company} · ` : '', "value2": job.title || job.url}), jobPlace(job), 'warn');
    }
    shared.allJobs = data.jobs;
    noteOutdated(data.outdated);   // the scores from the previous strategy: Strategy's own count, kept by rescore-run.js (after the rows: its redraw reads them)
    markReady(data.jobs);   // the jobs the night filled, from the codes known so far
    refreshReady(data.jobs, () => renderJobs());   // then the app's answer; the list is drawn again when it differs
    document.dispatchEvent(new Event('menu:refresh'));   // pages/nav.js: Interviews appears with the first application
        // Total / high fit / new / companies count job matches; opportunities that found you are "In conversation".
    const count = jobCounts(data);   // one definition for every count (jobs-view.js), the Find jobs card's too
    $('jobs-stats').textContent = t('pagesShortJobs.m206', {"total": count.total}) +
      (count.week ? t('pagesDynamicJobs.m244', {"week": count.week}) : '') + (data.filtered ? t('pagesShortJobs.m207', {"filtered": data.filtered}) : '') +
      // Found but not checked yet (the engine: not scored): the next refreshes take them, a batch at a time, best places first (src/daily.py).
      (data.waiting ? t('pagesDynamicJobs.m245', {"waiting": data.waiting}) : '') +
      (data.stale ? t('pagesJobsFinal.notionUnreachable') : '');   // about Notion
    $('jobs-stats').title = t('pagesDynamicJobs.m246', {"scored": count.scored}) + (data.filtered ? t('pagesDynamicJobs.m247', {"filtered": data.filtered}) : '');
    const totalBefore = $('stat-total').textContent, flash = setCount($('stat-total'), count.total);
    // Whether a person could see it (7 Oct 2026: "the flashing is not consistently working"): logs/app.log, area ui
    if (flash !== 'same') window.pilot.uiLog?.('Total matches changed', {from: totalBefore, to: count.total, flash,
      page: document.querySelector('.view[data-view="jobs"]')?.offsetParent ? 'jobs' : 'another page',
      window: document.visibilityState, focused: document.hasFocus(), reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches}).catch?.(() => {});
    setCount($('stat-high'), count.high);
    setCount($('stat-inbound'), inboundCount(shared.allJobs));
    // The menu item counts the list as it opens ("New matches"), the number the list bar shows too. "New this week" is
    // a delta, not how many jobs there are: it goes in the tooltip and the line above the cards instead of the badge.
    const toReviewCount = toReview(shared.allJobs) + (data.review_beyond || 0);   // with the rows not loaded (a cut list)
    setCount($('nav-jobs-badge'), toReviewCount);
    Object.assign($('nav-jobs-badge'), {hidden: !toReviewCount, textContent: badgeLabel(toReviewCount),
      title: t('pagesDynamicJobs.m248', {"toReviewCount": toReviewCount, "week": count.week, count: toReviewCount})});
    setCount($('stat-companies'), count.companies);
    const applications = applicationStats(shared.allJobs);
    for (const kind of Object.keys(applications)) setCount($(`stat-${kind}`), applications[kind]);
    const talking = inProcess(shared.allJobs);
    document.querySelector('[data-stat="interviews"]').title = t('pagesDynamicJobs.m249', {"screening": talking.screening, "interviews": talking.interviews});
    document.querySelector('[data-stat="applied"]').title = t('pagesJobsFinal.sentDefinition');
    document.querySelector('[data-stat="waiting"]').title = t('pagesJobsFinal.waitingDefinition');
    document.querySelector('[data-stat="closed"]').title = t('pagesJobsFinal.closedDefinition');
    renderStuck();
  }
}

// A kit's provenance, for its tag: "Current", "Drafted with earlier inputs" (which ones changed), or "Inputs unknown".

// A list of applications from elsewhere (a Focus funnel step): only those, whatever their status.
export function showJobsIn(label, urls, from = '') {
  jobsState.statFilter = {label, from, urls: new Set((urls || []).map(fullKey))};
  setFilters(['all']);
  $('filter-text').value = '';
  renderJobs();
}

// Run at start-up, in the order the window has always done it (app.js calls each page's init in turn).
// Refresh jobs, from any button that starts one (Refresh, "score the unscored", Strategy's Re-score them now): the header status
// shows "Refreshing jobs →", the run joins Recent activity, the list reloads after. Resolves when the search ends.
// why: what this refresh is for beyond finding jobs ({reason: 'rescore', count}), said on its row in Recent activity (main.js refresh).
// Every Find jobs press (the card, Refresh, Strategy, Re-score, Find employers, search changed) comes here. A refusal (no AI credit, trial over,
// Always on could not start it) is said on the Find jobs card, or in a pop-up when the card is not on screen (26 Oct 2026: the press was silent).
// -> the main process's answer.
// The plain Find jobs press while scores are from the previous strategy asks "Score first" (pages/score-first.js scoreFirst) before anything starts.
export async function startSearch(why = undefined) {
  const held = await scoreFirst(why, {search: startSearch, reload: loadJobs, toast: toastMessage});   // Find jobs only finds: with scores from the previous strategy it asks "Score first" (owner, 2 Nov 2026)
  return held || runSearch(why);
}
// The search itself, once the person went on (or nothing was outdated): the one place a refresh starts.
async function runSearch(why) {
  refreshBusy(true);   // "Your search changed": this refresh applies it
  $('refresh').disabled = true;
  showFindRefused(null);
  renderJobs();   // the empty list stops offering "Refresh jobs" while one runs
  shared.selectedRun = null;
  askLinkedinOnPress(why).catch(() => {});   // the 1st and 2nd press while LinkedIn jobs is off: one dialog, the search does not wait for it (owner, 31 Oct 2026)
  setTimeout(() => { showSearchStatus(); refreshActivity(); window.pilot.runs().then(renderFindCard).catch(() => {}); }, 300);
  let result = null;
  try {
    result = await window.pilot.refresh(why).catch(error => ({ok: false, error: error.message}));
    const refused = refusal(result);
    // On the card when it is in view; elsewhere a pop-up. No AI credit or a Free AI line also opens the top-up dialog, which can press it again.
    if (refused && (!showFindRefused(refused) || refused.credit)) sayRefused(why?.reason === 'rescore' ? t('pagesFinalLabels.rescoreNotStarted') : why?.employers ? t('pagesFinalLabels.widerNotStarted') : t('pagesControlStatus.findNotStarted'), result, {place: {view: 'jobs'}, retry: () => startSearch(why)});
    return result;
  } finally {
    $('refresh').disabled = false;
    loadJobs();
    refreshActivity();
    showSearchStatus();
  }
}

/** A row's "Score" press: starts the scoring queue for the found jobs without a score (main: the 'refresh' channel's fixed reason 'score'); a refusal is said, never silent. */
export async function startScoreQueue() {
  const result = await window.pilot.refresh({reason: 'score'}).catch(error => ({ok: false, error: error.message}));
  if (refusal(result)) sayRefused(t('pagesJobsHelp.queueNotStarted'), result, {place: {view: 'jobs'}});
  return result;
}

export async function init() {
  searchSelect($('lead-target'));
  try { $('jobs-talking').open = talkingStartsOpen(localStorage.getItem(TALKING_OPEN)); } catch {}
  $('jobs-talking').addEventListener('toggle', event => { try { localStorage.setItem(TALKING_OPEN, event.target.open ? '1' : '0'); } catch {} renderTalkingBar(); });
  paintTalkingFirst();
  paintJobsSuggestionsFirst();   // the Suggestions bar too, as last drawn (late-blocks.js)
  $('jobs-stuck-show').addEventListener('click', () => {
    jobsState.statFilter = 'stuck';
    setFilters(['all']);
    renderJobs();
  });
  $('sort-by').addEventListener('change', () => { releaseOrder(); renderJobs(); });   // the person re-sorts: the order held for the scoring queue ends
  wireFilterMenu();   // the one Show menu (pages/jobs-filter-menu.js): every filter, ticked together
  wireViews();   // saved views + List | Board (pages/jobs-views.js): they ask for a render through this event
  document.addEventListener('jobs-rerender', () => renderJobs());
  $('jobs-filter-clear').addEventListener('click', () => { jobsState.statFilter = null; renderJobs(); });
  $('jobs-filter-back').addEventListener('click', () => document.querySelector('.nav[data-view="focus"]').click());
  // The counters filter the list to the jobs they count, whatever their status (so the list matches the number);
  // clicking the active one again, or Total matches, shows every match.
  document.querySelectorAll('[data-stat]').forEach(card => card.addEventListener('click', () => {
    const kind = card.dataset.stat;
    const next = statClick(kind, typeof jobsState.statFilter === 'string' ? jobsState.statFilter : null, soleFilter(jobsState.filters));
    jobsState.statFilter = next.stat;
    setFilters([next.filter]);   // a counter is a selection of the menu: its own list

    if (kind === 'companies' && jobsState.statFilter) $('sort-by').value = 'company';
    renderJobs();
  }));
  // Add a job: one link, then the find path (read, score, Job Matches). It shows under New matches.
  $('jobs-more').addEventListener('click', showMore);
  wireExport();
  $('import-open').addEventListener('click', () => {
    message('import-message', '');
    $('import-go').disabled = false;
    $('import-dialog').showModal();
    $('import-url').focus();
  });
  $('import-go').addEventListener('click', async event => {
    event.preventDefault();
    const url = $('import-url').value.trim();
    if (!/^https?:\/\//.test(url)) { message('import-message', t('pagesJobsFinal.pasteLink'), 'error'); return; }
    $('import-go').disabled = true;
    message('import-message', t('pagesJobsFinal.readingScoring'), 'waiting');
    const result = await window.pilot.importJob(url);
    $('import-go').disabled = false;
    message('import-message', result.text, result.ok ? 'ok' : 'error');
    if (!result.ok) return;
    $('import-url').value = '';
    setFilters(['open']);
    await linkToJob('import-dialog', 'import-message', result);
  });
  // Applied elsewhere: tracked in Notion like /add, then shown in the list as Applied.
  const setAppliedOrigin = value => $('applied-origin').querySelectorAll('button').forEach(b => b.classList.toggle('is-active', b.dataset.origin === value));
  const appliedOrigin = () => $('applied-origin').querySelector('.is-active')?.dataset.origin || 'outbound';
  $('applied-origin').addEventListener('click', event => { const b = event.target.closest('[data-origin]'); if (b) setAppliedOrigin(b.dataset.origin); });
  $('applied-open').addEventListener('click', () => {
    const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);  // local day
    $('applied-when').value = today;
    $('applied-when').max = today;  // no future dates
    message('applied-message', '');
    $('applied-go').disabled = false;
    $('applied-dialog').showModal();
    $('applied-url').focus();
  });
  $('applied-url').addEventListener('input', () => {
    let host = '';
    try { host = new URL($('applied-url').value.trim()).hostname; } catch {}
    $('applied-manual').hidden = !WALLED.test(host);
  });
  $('applied-go').addEventListener('click', async event => {
    event.preventDefault();
    const url = $('applied-url').value.trim();
    if (!/^https?:\/\//.test(url)) { message('applied-message', t('pagesJobsFinal.pasteLink'), 'error'); return; }
    $('applied-go').disabled = true;
    message('applied-message', t('pagesDynamicJobs.m250', {"storeName": storeName()}), 'waiting');
    const day = $('applied-when').value;  // YYYY-MM-DD from the date picker
    if (!day) { message('applied-message', t('pagesJobsFinal.appliedDay'), 'error'); return; }
    const manual = !$('applied-manual').hidden;
    if (manual && !$('applied-title').value.trim()) { message('applied-message', t('pagesJobsFinal.addTitle'), 'error'); return; }
    const details = {...(manual ? {title: $('applied-title').value.trim(), company: $('applied-company').value.trim(), text: $('applied-text').value.trim()} : {}),
      ...(appliedOrigin() === 'inbound' ? {origin: 'inbound'} : {})};
    const result = await window.pilot.addApplied(url, $('applied-approx').checked ? t('pagesDynamicJobs.m251', {"day": day}) : day, details);
    $('applied-go').disabled = false;
    message('applied-message', result.text, result.ok ? 'ok' : 'error');
    if (!result.ok) return;
    if (/not scored yet/.test(result.text)) {   // the page's text was not read: ask for it here, the same Track it adds the fit score
      $('applied-manual').hidden = false;
      message('applied-message', result.text, 'ok');
      await linkToJob('applied-dialog', 'applied-message', result);
      return;
    }
    $('applied-url').value = ''; $('applied-approx').checked = false; setAppliedOrigin('outbound');
    ['applied-title', 'applied-company', 'applied-text'].forEach(id => { $(id).value = ''; });
    $('applied-manual').hidden = true;
    setFilters(['applied']);  // show it where it now is
    await linkToJob('applied-dialog', 'applied-message', result);
  });
  wireLead();
  wireAdd();
  $('filter-text').addEventListener('input', renderJobs);

  // ---------- questions to answer once ----------
  // The start-up move to Notion can finish after the first read: read them again then.
  window.pilot.onMoved(steps => { if (steps.includes('open questions')) loadQuestions({force: true}); });

  window.pilot.onLog(line => {
    // A new run's first line starts a fresh live log. It does NOT clear the run you are looking at in Recent activity (6 Oct 2026: the Gmail check the app
    // starts by itself after launch switched the panel away from the run being read). Starting a run yourself clears it (Refresh, Check Gmail, View activity).
    if (shared.idleSeen || /^Searching job boards/.test(line)) { shared.logLines = []; shared.idleSeen = false; }
    keepRunLine(shared.logLines, line);   // as the app keeps it: the newest "Still running" of a row, the newest tick of each kind, every result
    refreshActivity();
    scoreQueueLine(line);   // the queue after a search: its state redraws the list (score-queue-state)
    if (LIST_CHANGED.test(line)) reloadQuietly();
  });
  // Running: its progress; done: the last Refresh jobs run itself, not whichever task happens to be running now.
  $('search-status').addEventListener('click', async () => {
    const {running, runs} = await window.pilot.runs();
    const searching = running && (running.kind || 'search') === 'search';
    shared.selectedRun = searching ? null : (runs || []).find(run => (run.kind || 'search') === 'search')?.id ?? null;
    openActivity(true);
    refreshActivity();   // draws the selected run's detail
  });
  $('refresh').addEventListener('click', () => startSearch());
  wireFindCard(() => startSearch());
  paintFindCardFirst();

  wireProfileEmpty();
  wireScoreCall({find: () => $('refresh').click()});
  document.addEventListener('rescore-state', () => renderJobs());   // the call, the card and the muted rows follow the one state
  document.addEventListener('score-queue-state', () => { renderJobs(); renderFindCard(); });   // the Find card's lead says the check runs (jobs-find.js)
  document.addEventListener('score-found-ask', () => startScoreQueue());   // ⌘K "Score found jobs" (pages/nav.js)
  shared.scoreFound = startScoreQueue;   // a row's "Score" press (pages/score-queue-draw.js)
  wireApplyDialog({startedApplying, openJob: openJobPanel});
  wireTriage({read: job => readThroughStep(window.pilot, job), match: reads => window.pilot.applyReadinessMatch(reads), cancel: () => window.pilot.triageCancel(), rerender: () => renderJobs(), toast: toastMessage, onStep: fn => window.pilot.onTriageStep?.(fn)});
}

