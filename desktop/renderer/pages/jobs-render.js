// Jobs page, the list: renderJobs (rows, filters, row actions), the stuck banner, loading state, kit label. Guarded by: test/unit/renderer/count-flash.test.js.
import {counted as countedLabel} from './page-counts.js';
import '../../i18n/screens-pages.js';
import {t} from '../../i18n/index.js';
import {createRowApply} from './jobs-apply-row.js';
import '../../i18n/focus-cards.js';
import {copyField} from '../../i18n/display-copy.js';
import {ai} from '../ai-name.js';
import {chip, el, holdMenu, isInteractiveTarget, moreButton, pill, tag} from '../components.js';
import {resumeOffered} from '../claude-help.js';
import {triageChip} from './jobs-triage.js';
import {columnOf} from '../jobs-board-rules.js';
import {isInbound} from '../origin.js';
import {looksLikeLink, matches} from '../filter.js';
import {fitRing} from '../fit-ring.js';
import {followFilter, searchingNow} from './jobs-find.js';
import {icon} from '../icons.js';
import {band, byStat, isStuck, fitTooltip, newOfTotal, openMatches, PLACE_UNCLEAR, prepareState, preparing, sorted, statPressed, statusPill, tags, unscoredWhy} from '../jobs-view.js';
import {shared} from './shared.js';
import {$, show} from './core.js';
import {openSession} from './session-log.js';
import {sessionState, refreshSessions, sessionFor, sessionList, sessionsLoaded} from './sessions.js';
import {toastMessage} from './startup.js';
import {rowApply} from '../apply-settings-model.js';
import {jobPlace} from '../targets.js';
import {openFeedback} from './feedback.js';
import {outcomeChoices, reopenable} from '../outcome-tap.js';
import {scoreBucket} from '../intel.js';
import {askWhy} from './dismiss-reason.js';
import {openMatchCheck} from './match-check.js';
import {jobsState, MORE, pageKey, fullKey} from './jobs-state.js';
import {renderExport} from './jobs-export.js';
import {byStore, storeName} from '../store-words.js';
import {fitDetail} from './jobs-fit.js';
import {openJobPanel, panelUrl} from './job-panel.js';
import {jobsChanged, loadJobs, showJobsData, startedApplying} from './jobs.js';
import {paintViews} from './jobs-views.js';
import {renderFilterMenu} from './jobs-filter-menu.js';
import {NA, rowModel} from '../job-row-model.js';
import {companyCell, placeCell} from './jobs-row-cells.js';
import {alsoOnTags, holdsAny, linksOf, onEveryCopy, setStatusOnCopies} from './jobs-copies.js';
import {renderTalking} from './jobs-talking.js';
import {boardIds, findsMore, hasViewOption, inFilters, inFiltersLoose, soleFilter} from '../jobs-filters.js';
import {paintScoreCall} from './jobs-score-call.js';
import {drawQueueRing, paintQueueBar} from './score-queue-draw.js';
import {heldOrder, queueRuns} from './score-queue.js';
import {staleLabel, staleTip} from '../rescore-words.js';

// Applying, with no session open for it: one to settle (banner on Jobs).
const stuck = job => isStuck(job, entry => sessionList.some(item => pageKey(item.url) === pageKey(entry.url)));
export function renderStuck() {
  // Not before the sessions are known: with none loaded yet every Applying job would look abandoned for a moment.
  const count = sessionsLoaded ? shared.allJobs.filter(stuck).length : 0;
  show($('jobs-stuck'), count > 0);
  $('jobs-stuck-text').textContent = t('pagesDynamicJobs.m231', {"count": count});
}

// Work in progress on a job (redrafting its kit, tailoring its CV), shown on its row while the menu is closed.
const busyNotes = new Map();
const claudeStarted = new Set();

document.addEventListener('sessions-loaded', () => renderStuck());

const COUNTS_ALL = new Set(['applied', 'waiting', 'interviews', 'closed']);
/**
 * Settings → Apply saved a mode: remember it for the rows and redraw them, so every Apply button names the mode a press will use.
 * Why (#3437, Gitar review): setting the state alone left the rows on the old label until an unrelated redraw.
 * @param {object} saved the settings just saved (pages/apply-settings.js dispatches them in the 'apply-saved' event)
 * @returns {void}
 */
export function applySaved(saved) {
  if (shared.state) shared.state.settings = saved;
  renderJobs();
}

/**
 * The words of the list bar: "12 new of 13 matches" on the plain New matches list (newOfTotal), "4 of 195 jobs" under a counter, else the plain count, then how many rows the engine left out.
 * @param {{split: ?{new: number, total: number}, statLabel: string, shown: number, all: number, notLoaded: number}} bar the split newOfTotal gave, the counter's name, the rows drawn, every loaded job, the rows not loaded
 * @returns {string}
 */
function listBarText({split, statLabel, shown, all, notLoaded}) {
  const plural = count => countedLabel('job', count);
  const head = split ? t('pagesJobsHelp.newOfTotal', split) : statLabel ? t('pagesShortJobs.m195', {"length": shown, "plural": plural(all)}) : plural(shown);
  return head + (notLoaded ? t('pagesDynamicJobs.m238', {"notLoaded": notLoaded}) : '');
}

// clean-code-ok: Why (31 Oct 2026): the 252 complexity is the whole Jobs row draw, unchanged; this PR adds two lines to it (hold and restore the open ⋯ menu); splitting the draw is its own refactor.
export function renderJobs() {
  const restoreMenu = holdMenu(document.querySelector('.view[data-view="jobs"]'), 'url');   // Why (31 Oct 2026, owner): an open ⋯ menu survives the redraw a sessions update causes; only a menu on this page
  const filters = jobsState.filters;
  const filter = soleFilter(filters);   // '' when several are ticked
  const now = Date.now();
  renderFilterMenu();
  followFilter(findsMore(filters, jobsState.statFilter));   // the Find more jobs card follows the list (jobs-filters.js findsMore)
  const text = $('filter-text').value.trim();
  // A pasted link finds that job whatever its status; words filter within the chosen status.
  const anyStatus = looksLikeLink(text);
  // The counters count every application (real workload); without one, the ticked filters decide (jobs-filters.js): any of them holds the job;
  // a pasted link finds any job.
  const counted = jobsState.statFilter === 'stuck' ? shared.allJobs.filter(stuck)
    : jobsState.statFilter?.urls ? shared.allJobs.filter(job => holdsAny(job, jobsState.statFilter.urls, fullKey))
    : jobsState.statFilter ? byStat(COUNTS_ALL.has(jobsState.statFilter) ? shared.allJobs : openMatches(shared.allJobs), jobsState.statFilter) : null;
  const by = $('sort-by').value;
  const rows = heldOrder(sorted((counted || shared.allJobs)
    .filter(job => (anyStatus && !counted) || (counted ? inFiltersLoose(job, filters, now) : inFilters(job, filters, now)))
    .filter(job => matches(job, text)),
  filter === 'inbound' && !counted && by === 'best' ? 'activity' : by));   // heldOrder: rows keep their place while the scoring queue's scores land (pages/score-queue.js)
  jobsState.visible = rows;   // pages/jobs-export.js saves these
  renderExport();
  renderTalking(!!counted || filters.includes('inbound') || filters.includes('everything') || hasViewOption(filters) || !!text);
  // Jobs found but never scored: the AI step did not run (it is not answering, a limit, no engine). Say so, once, above the list: the
  // rows show "Not scored" and a friend took that for a bug (2 Oct 2026, a search whose AI calls had stalled).
  // A job whose place is unclear is not the AI failing: its row says why (unscoredWhy).
  const unscored = shared.allJobs.filter(job => job.fit == null && job.status === 'unreviewed' && !job.place_unclear).length;
  // The one callout: scores from the previous strategy (Re-score), else jobs not scored yet; the re-score's own card. While the queue after a search runs, its bar says it instead.
  paintScoreCall(unscored, searchingNow() || queueRuns());
  paintQueueBar();
  const body = $('jobs-body');
  body.replaceChildren();
  for (const job of rows) {
    const row = el('article', 'job-row');
    const parts = rowModel(job);   // what this job's state and source draw (job-row-model.js)
    Object.assign(row.dataset, {code: job.code || '', url: job.url || ''});   // a notification's click scrolls to it (pages/open-target.js)
    // Fit: a ring filled to the score. A row whose score has a
    // breakdown behind it says so with a caret, and the ring opens it.
    const fit = el('div', `fit-cell ${band(job.fit)}${job.stale && job.fit != null ? ' is-stale' : ''}`);   // the old score stays, muted (owner, 2 Nov 2026), until the re-score replaces it
    const ring = fitRing(job.fit);
    const canOpen = job.fit != null && !!job.fit_detail;
    const caret = icon('chevron', `icon fit-caret${canOpen ? '' : ' is-hidden'}`);  // on every row: the rings line up
    const ringRow = el('div', 'fit-ring-row');
    ringRow.append(ring, caret);
    const scoring = job.fit == null && searchingNow() && !job.place_unclear;   // found by the search that is running: its score comes next
    const old = !!job.stale && job.fit != null;
    fit.append(ringRow);
    if (old && parts.fit) fit.append(el('span', 'fit-label', staleLabel));   // only a stale score has words under its ring (style.css .is-stale .fit-label); the tooltip says the rest
    if (!parts.fit) {   // an applied, rejected or inbound job with no score: the same ring, saying N/A, never "Not scored" (job-row-model.js)
      ring.replaceChildren(el('span', '', NA));
    }
    const inQueue = parts.fit && job.fit == null && !scoring && !job.place_unclear && drawQueueRing(fit, ring, job, shared.scoreFound || null);   // queued, scoring, or the Score press (pages/score-queue-draw.js)
    if (!inQueue) fit.title = !parts.fit ? t('pagesJobsHelp.noScore') : scoring ? t('pagesJobsHelp.scoring') : job.fit == null ? unscoredWhy(job) : `${old ? `${staleTip} ` : ''}${fitTooltip(job.fit, canOpen ? t('pagesControlStatus.clickWhy') : '')}`;
    const live = sessionFor(job.url);
    const [statusLabel, statusTone] = live && !live.endedAt ? sessionState(live) : [statusPill(job).label, statusPill(job).tone];

    const role = el('div', 'role');
    const titleLine = el('div', 'title-line');
    // An opportunity that found you has no posting (its link is the email or chat): the title opens its Notion page.
    const inNotion = isInbound(job) && !!job.notion_url;
    const link = Object.assign(el('a', '', job.title), {href: '#', title: inNotion ? t('pagesCommon.openNotion') : t('pagesJobsHelp.openJobDetails')});
    link.addEventListener('click', event => { event.preventDefault(); if (inNotion) window.pilot.openNotion(job.notion_url, event.metaKey); else openJobPanel(job, 'overview'); });   // the posting itself: the drawer's "Open posting"
    titleLine.append(link);
    for (const also of alsoOnTags(job)) titleLine.append(tag(also.text, {title: also.title}));   // the same posting on another site: one row (src/desktop_job_copies.py)
    role.append(titleLine);
    // Why (2026-10-30, owner; 2 Nov 2026 N/A for a job with nothing to apply to, the slot stays so every row is built alike): Localized display keys preserve this rule: the mode of the job's last read, or "Not checked" (spec 2026-10-30-apply-triage)
    role.append(parts.triage ? triageChip(job) : chip(NA, {tone: 'neutral', title: t('pagesJobsHelp.nothingApply')}));
    // Always: no reason keeps its line, so every row is the same height; Why (2 Nov 2026, owner: "for the content we're missing, we should add N/A"): an empty line read as a hole.
    role.append(Object.assign(el('div', 'reason', job.reason || NA), job.reason ? {title: job.reason} : {className: 'reason is-na'}));
    const chips = el('div', 'tags');
    // Three skill tags, the rest behind "+N".
    const skills = tags(job, 8);
    for (const skill of skills.slice(0, 3)) chips.append(tag(skill, {title: skill}));   // one line: a long phrase is cut with … and read in full on hover (style.css .tags)
    if (skills.length > 3) chips.append(tag(`+${skills.length - 3}`, {title: skills.slice(3).join(', ')}));
    // A section of the job's page (kit, rejection review): Notion's page when the store has one, else the job's page here (pages/job-panel.js).
    const openPage = (tab, event) => (job.notion_url ? window.pilot.openNotion(job.notion_url, event?.metaKey) : openJobPanel(job, tab));
    if (job.tailored && job.code) chips.append(tag(t('pagesAuditPunct.a31'), {title: t('pagesActivity.cvHighlighted'),
      onClick: () => window.pilot.openTailoredCv(job.code)}));
    if (parts.rejection) chips.append(tag(`🔎 ${parts.rejection}`, {title: job.rejection_lesson || t('pagesJobs.whyRejected'),
      onClick: event => openPage('review', event)}));
    if (busyNotes.has(job.url)) chips.append(tag(busyNotes.get(job.url), {busy: true}));
    role.append(chips);   // always: a row without chips keeps the chip line's height, so every row is the same

    const company = companyCell(parts), place = placeCell(job);   // jobs-row-cells.js: N/A and a blank avatar where nothing is named

    const status = el('div', 'status-cell');
    status.append(pill(statusLabel, statusTone));
    // The kit's eligibility verdict: a badge, with the reason on hover.
    if (job.ineligible) {
      const verdict = Object.assign(pill(t('pagesJobs.notEligible'), 'bad'), {tabIndex: 0});
      verdict.classList.add('tip');
      verdict.dataset.tip = job.ineligible;
      status.append(verdict);
    }
    if (job.place_unclear && job.fit == null) {
      const unclear = Object.assign(pill(PLACE_UNCLEAR, 'warn'), {tabIndex: 0});
      unclear.classList.add('tip');
      unclear.dataset.tip = unscoredWhy(job);
      status.append(unclear);
    }

    const box = el('div', 'row-actions');
    const menu = [];
    // Notion is the source of truth: if it can't be written, nothing changes and the user is told.
    const setStatus = next => async () => {
      const result = await setStatusOnCopies(job, next, (url, status) => window.pilot.setStatus(url, status));   // a merged row stands for every copy of its posting (pages/jobs-copies.js)
      if (!result.ok) { toastMessage(t('pagesJobs.statusNotChanged'), result.error || t('pagesCommon.wrong'), jobPlace(job), 'bad'); return; }
      const stage = result.stage || job.stage;   // what Notion now holds (a dismissed job in process becomes Closed)
      jobsChanged(job, {status: next, stage: next === 'applied' && stage === 'Applying' ? 'Applied' : stage});
      if (next === 'dismissed' && jobsState.statFilter?.urls) linksOf([job]).forEach(url => jobsState.statFilter.urls.delete(fullKey(url)));   // a counter's list is a fixed set of jobs: it must let the dismissed one go
      renderJobs();
      if (next === 'dismissed') askWhy(job);   // one optional tap: why (counted with the score band only)
    };
    // The row's Apply and the ⋯ menu's per-job modes, through Apply readiness (pages/jobs-apply-row.js); `modes` are listed after the job's own pages.
    const applier = createRowApply(job, {rerender: renderJobs}), modes = [];
    // Why (2026-11-05, owner screenshots): queued and filling sessions must open their existing work, never offer another Apply, regardless of AI provider.
    if (job.status !== 'applied' && job.url && live) {
      const open = el('button', `row-main ${live.status === 'input' ? 'state-apply' : 'state-opened'}`, live.status === 'input' ? t('pagesCommon.continue') : t('pagesJobs.viewSession'));
      open.title = live.note || t('pagesJobs.openSession');
      open.addEventListener('click', () => openSession(live.id));
      box.append(open);
    } else if (job.status !== 'applied' && job.url && (job.kit || job.ready)) {
      // Stays "Opened" for the session (until marked applied); a click opens it again.
      const opened = shared.openedInChrome.has(pageKey(job.url));
      // The easy way is the main button: Chrome opens the form in a normal tab and the extension fills it from the kit.
      // Apply with Claude (a session that drives Chrome through the employer's site, sign-up and every page) is in the
      // ⋯ menu, for pages the extension can't reach on its own.
      // Filled on the server: the main button opens that filled form (the night's hand-off) to check and submit, not a new fill.
      const fill = Object.assign(el('button', `row-main ${opened && !job.ready ? 'state-opened' : 'state-apply'}`, job.ready ? t('pagesJobs.reviewSubmit') : opened ? t('pagesJobs.opened') : rowApply(shared.state?.settings).label), {
        title: job.ready ? t('pagesJobsHelp.serverFilled') : opened ? t('pagesJobsHelp.openedChromeHelp') : rowApply(shared.state?.settings).tip});
      fill.addEventListener('click', async () => {
        if (!job.ready) return applier.start(fill);
        const result = await window.pilot.readyOpen(job.code).catch(error => ({ok: false, error: error.message}));
        if (result.cancelled) return;
        if (result.ok) { shared.openedInChrome.add(pageKey(job.url)); startedApplying(job); renderJobs(); } else toastMessage(t('pagesJobs.filledOpenFailed'), result.error || t('pagesJobsHelp.tryReady'), jobPlace(job), 'bad');
      });
      box.append(fill);
      if (!job.ready) modes.push(...applier.modeItems());   // Why (8 Nov 2026, code review of R2): a form filled on the server opens its hand-off; a fresh start would skip those answers
      if (jobsState.claudeReady && resumeOffered()) {
        const started = claudeStarted.has(pageKey(job.url));
        menu.push({icon: 'bot', label: started ? t('pagesJobs.claudeApplying') : t('pagesJobs.applyClaude'), disabled: started,
          title: started ? t('pagesJobsHelp.claudeWindow') :
            t('pagesAuditSecond.a109') +
            t('pagesAuditPunct.a32'),
          run: async () => {
            const result = await window.pilot.applyWithClaude(job.url, {title: job.title, company: job.company, location: job.location, workMode: job.work_mode});
            if (result.cancelled) return;
            if (result.ok) { claudeStarted.add(pageKey(job.url)); startedApplying(job); if (result.session) await refreshSessions(); renderJobs(); return; }
            // The list said there was a kit but Notion has none (removed or redrafting): Apply drafts it again.
            if (/kit/i.test(result.error || '')) { toastMessage(t('pagesJobs.prepareFailed'), t('pagesJobs.pressApply'), jobPlace(job), 'warn'); loadJobs(); } else toastMessage(t('pagesJobs.claudeFailed'), result.error || t('pagesCommon.tryAgain'), jobPlace(job), 'bad');
          }});
      }
    } else if (job.status !== 'applied' && job.url && job.code) {
      // No kit yet: Apply drafts it first (reads the form's questions, answers each, writes a cover letter), then opens
      // the form in Chrome as it does for a job with a kit. "Prepare only" is in the ⋯ menu.
      const state = prepareState(job);
      const busy = state === 'local';
      const prepare = Object.assign(el('button', busy ? 'row-main state-prepare' : 'row-main state-apply', state === 'failed' ? t('pagesJobs.retryApply') : state ? t('pagesJobs.preparing') : rowApply(shared.state?.settings).label), {
        title: state === 'local' ? t('pagesJobsHelp.preparingHelp')
          : t('pagesJobsHelp.prepareFillHelp')});
      if (busy) { prepare.disabled = true; prepare.classList.add('busy', 'state-busy'); }  // spinner only; the fixed width keeps the row still
      // The press takes the job's one lock (applier.start): a ⋯ pick still drafting the kit makes this press start nothing (#3638). The row rebuilds from `preparing` while the draft runs.
      const track = next => { if (next) preparing.set(job.code, next); else preparing.delete(job.code); renderJobs(); };
      prepare.addEventListener('click', () => applier.start(null, {track}));
      box.append(prepare);
      modes.push(...applier.modeItems());
    }

    // Long work started from the menu: a note on the row until it's done.
    const background = async (note, work) => {
      if (busyNotes.has(job.url)) return;
      busyNotes.set(job.url, note);
      renderJobs();
      try { await work(); } finally { busyNotes.delete(job.url); renderJobs(); }
    };
    menu.push({icon: 'file', label: t('pagesJobs.openJobPage'), run: () => openJobPanel(job),
      title: t('pagesJobsHelp.jobPageHelp')});
    if (job.notion_url) menu.push({icon: job.kit ? 'file-text' : 'layers', label: t('pagesCommon.openNotion'), run: event => window.pilot.openNotion(job.notion_url, event.metaKey),
      title: t('pagesJobsHelp.jobNotion')});   // about Notion
    menu.push({icon: 'external', label: isInbound(job) ? t('pagesJobs.openMessage') : t('pagesCommon.openPosting'), run: () => window.pilot.openExternal(job.url), title: isInbound(job) ? t('pagesJobsHelp.messageOrigin') : t('pagesJobs.jobPosting')});
    menu.push(...modes);
    if (job.page_id) menu.push({icon: 'chat', label: t('pagesProfile.addFeedback'), run: () => openFeedback({...job, job: job.title}, 'receive')});
    if (job.employer_feedback && job.page_id) menu.push({icon: 'chat', label: t('pagesJobs.readFeedback'), run: () => openFeedback({...job, job: job.title}, 'review')});
    // The saved review is a tag on the row; the menu says it in words too, as the tag alone did not read as clickable.
    if (job.rejection) menu.push({icon: 'file', label: t('pagesJobs.viewRejection'),
      title: job.rejection_lesson || t('pagesJobsHelp.rejectionHelp'), run: event => openPage('review', event)});
    if (job.stage === 'Rejected') {
      // Claude reads the posting, what was sent, the timeline and any interview reviews: presentation, hard skills,
      // soft skills, or a different profile (nothing to improve). Written on the job's Notion page.
      menu.push({icon: 'search', label: job.rejection ? t('pagesJobs.reviewRejection') : t('pagesJobs.whyMe'),
        title: ai(t('pagesAuditPunct.a33')),
        run: () => background(t('pagesFinalLabels.reviewingRejection'), async () => {
          const result = await window.pilot.reviewRejection(job.url);
          toastMessage(result.ok ? t('pagesJobs.rejectionReviewed') : t('pagesInterviews.reviewFailed'), copyField(result, 'text'), jobPlace(job), result.ok ? 'good' : 'bad');
          if (result.ok) loadJobs();
        })});
    }
    if (job.code) {
      // A CV tailored to this posting (reworded, reordered bullets from your own CV; the extension uploads it here).
      const tailorNow = () => background(t('pagesAuditPunct.a34'), async () => {
        const result = await window.pilot.tailorCv(job.code, `${job.title} · ${job.company}`, job.url);
        if (result.ok) job.tailored = true; else toastMessage(t('pagesJobs.tailorFailed'), result.error || t('pagesCommon.tryAgain'), jobPlace(job), 'bad');
      });
      menu.push({icon: 'scissors', wand: true, label: job.tailored ? t('pagesJobs.retailor') : t('pagesActivity.tailor'),
        title: t('pagesJobsHelp.tailorHelp'),
        run: tailorNow});
      // Which terms the posting asks for the CV states, and which requirements could be a yes/no question on the form (a dialog: nothing added to the list).
      menu.push({icon: 'scale', label: t('pagesJobs.checkCv'), title: t('pagesJobsHelp.cvMatchHelp'),
        run: () => openMatchCheck(job, {tailor: tailorNow})});
    }
    // "How did it go?": one click records what the employer did (in Notion, like a stage the Gmail check finds) and counts it anonymously,
    // by job board and days only, when Technical reports are on. It is how Jobadabra learns which applications get answers.
    const choices = job.url ? outcomeChoices(job.stage, storeName()) : [];
    if (choices.length) {
      menu.push('-');
      if (jobsState.benchmarkText[job.url]) menu.push({icon: 'info', label: jobsState.benchmarkText[job.url], disabled: true, title: t('pagesJobsHelp.anonymousStats')});
      for (const choice of choices) {
        menu.push({icon: choice.icon, label: choice.label, title: choice.title, run: async () => {
          const result = await onEveryCopy(job, url => window.pilot.markOutcome({url, outcome: choice.outcome, appliedOn: job.applied_on, bucket: scoreBucket(job.fit)}));
          if (!result.ok) { toastMessage(t('pagesCommon.notSaved'), result.error || t('pagesCommon.tryAgain'), jobPlace(job), 'bad'); return; }
          jobsChanged(job, choice.outcome !== 'reply' ? {stage: result.stage} : {});   // a reply is an event only: the stage stays where it is
          toastMessage(t('pagesJobs.saved'), t('pagesDynamicJobs.m233', {"value1": choice.label.replace(/^(Heard back|No answer): /, ''), "storeName": storeName()}), jobPlace(job), 'good');
          renderJobs();
        }});
      }
    }
    // Actions read as verbs (the Status column shows where a job stands).
    menu.push('-');
    if (job.status !== 'saved') menu.push({icon: 'bookmark', label: t('pagesCommon.save'), run: setStatus('saved'), title: t('pagesJobsHelp.keepList')});
    if (job.stage === 'Applying') {  // the session is over or was closed: say what happened, instead of staying Applying
      menu.push({icon: 'tick', label: t('pagesSession.iSubmitted'), run: setStatus('applied'), title: t('pagesDynamicJobs.m234', {"storeName": storeName()})});
      menu.push({icon: 'undo', label: t('pagesJobs.notSubmitted'), title: t('pagesJobsHelp.markNotSubmitted'), run: async () => {
        const result = await onEveryCopy(job, url => window.pilot.unapplyJob(url));
        if (!result.ok) { toastMessage(t('pagesJobs.statusNotChanged'), result.error || t('pagesCommon.wrong'), jobPlace(job), 'bad'); return; }
        jobsChanged(job, {stage: 'Kit ready', status: 'saved'});
        renderJobs();
      }});
    } else if (job.status !== 'applied') menu.push({icon: 'tick', label: t('pagesJobs.markApplied'), run: setStatus('applied'), title: t('pagesJobsHelp.trackApplied')});
    if (job.stage === 'Applied') menu.push({icon: 'undo', label: t('pagesJobsHelp.wasNotSubmitted'), title: t('pagesJobsHelp.removeApplied'),
      run: async () => {
        // Only a bare Applied: a stage past it (a confirmation, an interview) is the employer's own evidence.
        if (!confirm(t('pagesDynamicJobs.m235', {"storeName": storeName()})
          + t('pagesJobsHelp.falseApplied'))) return;
        const result = await onEveryCopy(job, url => window.pilot.notSubmitted(url));
        if (!result.ok) { toastMessage(t('pagesJobs.notChanged'), result.error || t('pagesCommon.wrong'), jobPlace(job), 'bad'); return; }
        jobsChanged(job, {stage: 'Applying', status: 'applied'});
        toastMessage(t('pagesJobs.backApplying'), t('pagesDynamicJobs.m236', {"value1": result.events ? t('pagesDynamicJobs.eventsRemoved', {count: result.events, store: byStore('Notion ', '')}) : ''}), jobPlace(job), 'good');
        renderJobs();
      }});
    if (reopenable(job.stage)) menu.push({icon: 'undo', label: t('pagesJobs.reopen'), run: setStatus('applied'), title: t('pagesDynamicJobs.m237', {"storeName": storeName()})});
    if (job.status !== 'dismissed') menu.push({icon: 'close', label: t('pagesCommon.dismiss'), run: setStatus('dismissed'), title: t('pagesJobsHelp.notInterested'), danger: true});
    // A dismissed job can go for good (owner, 7 Oct 2026): its Notion pages to the trash (30 days there), and no search brings it back.
    else menu.push({icon: 'trash', label: t('pagesCommon.delete'), danger: true, title: byStore(t('pagesJobsFinal.deleteNotion'), t('pagesJobsFinal.deleteForever')),
      run: async () => {
        if (!confirm(t('pagesShortJobs.m194', {"title": job.title, "company": job.company, "byStore": byStore(t('pagesJobsFinal.notionTrashHelp'), t('pagesJobsFinal.localDeleteHelp'))}))) return;
        const result = await onEveryCopy(job, url => window.pilot.deleteJob(url));
        if (!result?.ok) { toastMessage(t('pagesJobsFinal.notDeleted'), result?.error || t('pagesCommon.wrong'), jobPlace(job), 'bad'); return; }
        const left = shared.allJobs.filter(other => other !== job);
        shared.allJobs = left;
        // The header and counters are counted from loaded data (showJobsData): counted again now, one job fewer.
        if (jobsState.lastJobsData) showJobsData({...jobsState.lastJobsData, jobs: left, total: jobsState.lastJobsData.total == null ? jobsState.lastJobsData.total : jobsState.lastJobsData.total - 1});
        toastMessage(t('pagesJobsFinal.deleted'), result.trashed ? byStore(t('pagesJobsFinal.pagesTrash'), t('pagesJobsFinal.isDeleted')) : t('pagesJobsFinal.notComeBack'), {view: 'jobs'}, 'good');
        renderJobs();
      }});
    box.append(moreButton(menu, t('pagesJobsFinal.moreJob')));

    row.append(fit, role, company, place, status, box);
    // The job's drawer (pages/job-panel.js): a click anywhere on the row outside its controls and its analysis (the score ring opens that, when there is one).
    if (panelUrl() && panelUrl() === job.url) row.classList.add('is-selected');
    row.addEventListener('click', event => {
      if (!isInteractiveTarget(event.target, row) && !(canOpen && fit.contains(event.target)) && !event.target.closest('.fit-detail, .ui-menu')) openJobPanel(job);   // the score cell opens the drawer too, unless it opens its own analysis
    });
    // The score ring opens why: Match analysis (the score's parts, strengths and gaps; Notion Job Matches keeps
    // them). The caret turns with it, and the row's own one-line summary steps aside for the panel's lead.
    if (canOpen) {
      const close = () => {
        row.querySelector('.fit-detail')?.remove();
        fit.classList.remove('is-open');
        fit.title = t('pagesJobsFinal.whyScore');
      };
      fit.classList.add('is-clickable');
      fit.addEventListener('click', () => {
        if (row.querySelector('.fit-detail')) { close(); return; }
        fit.classList.add('is-open');
        fit.title = t('pagesJobsFinal.hideMatch');
        row.append(fitDetail(job, close, () => openJobPanel(job, 'match')));
      });
    }
    body.append(row);
  }
  // What the list is filtered to, said once: a chip (✕ shows every job) and "4 of 195 jobs".
  const statLabel = jobsState.statFilter?.label || {applied: t('pagesExtraCommon.applied'), waiting: t('pagesControlStatus.waitingReply'), interviews: t('pagesControlStatus.inProcess'), closed: t('pagesControlStatus.closed'),
    stuck: t('pagesControlStatus.stillApplying'), high: t('pagesControlStatus.highFit'), companies: t('pagesControlStatus.oneCompany')}[jobsState.statFilter];
  renderStuck();
  // The engine sends the best rows only (src/desktop.py jobs): say how many are left out and offer them, never a silent cut (7 Oct 2026: 200 of 1,335).
  const notLoaded = Math.max(0, (jobsState.lastJobsData?.total ?? 0) - shared.allJobs.length);
  $('jobs-count').textContent = listBarText({split: newOfTotal({filter, statFilter: jobsState.statFilter, text, shown: rows.length, data: jobsState.lastJobsData}), statLabel, shown: rows.length, all: shared.allJobs.length, notLoaded});
  show($('jobs-more'), notLoaded > 0);
  $('jobs-more').textContent = t('pagesShortJobs.m196', {"value1": Math.min(notLoaded, MORE)});
  show($('jobs-filter'), !!statLabel);
  $('jobs-filter-text').textContent = statLabel ? t('pagesShortJobs.m197', {"statLabel": statLabel}) : '';
  show($('jobs-filter-back'), jobsState.statFilter?.from === 'focus');
  // A filter from another page (a Focus funnel step) is none of the boxes: they're greyed out until it's cleared.
  document.querySelectorAll('.stat-cards').forEach(cards => cards.classList.toggle('is-dimmed', !!jobsState.statFilter?.urls));
  document.querySelectorAll('[data-stat]').forEach(card => card.setAttribute('aria-pressed', String(statPressed(card.dataset.stat, jobsState.statFilter, filter))));
  if (jobsState.jobsLoading && !shared.allJobs.length) { show($('jobs-empty'), false); showLoading(); return; }  // still loading, not empty
  show($('jobs-empty'), rows.length === 0 && !document.body.dataset.findCard?.match(/^(empty|searching|failed)$/));   // the Find jobs card on top says it
  const emptyFor = {open: t('pagesAuditSecond.a111'), saved: t('pagesAuditPunct.a35'),
    applied: t('pagesAuditPunct.a36'),
    dismissed: t('pagesAuditSecond.a112'), inbound: t('pagesAuditPunct.a37')};
  $('jobs-empty').innerHTML = !shared.allJobs.length ? ($('refresh').disabled ? t('pagesAuditSecond.a113')
      : (t('pagesAuditPunct.a38') + t('pagesCommon.findJobs') + "</b></button>."))
    : anyStatus ? t('pagesAuditSecond.a114')
    : !text && !jobsState.statFilter && emptyFor[filter] ? emptyFor[filter]
    : text || jobsState.statFilter || filter !== 'all' ? t('pagesAuditSecond.a115') : t('pagesAuditSecond.a116');
  // The board shows applications only (rows with a Stage); the stage filters ticked, a counter and the words narrow it.
  const onBoard = boardIds(filters);   // the ticked filters that name a stage; none: every application
  paintViews((counted || shared.allJobs).filter(job => columnOf(job) && (counted || !onBoard.length || inFilters(job, onBoard, now)) && matches(job, text)));   // a job the board has a column for (jobs-board-rules.js)
  restoreMenu();
}

// "Refresh jobs" in the empty list is the same trigger as the header button (a disabled one, while a refresh runs, ignores it).
document.addEventListener('click', event => { if (event.target.closest?.('[data-refresh-jobs]')) $('refresh')?.click(); });

// While the list loads from Notion (a few seconds): a spinner in the empty list the first time; afterwards the
// list stays and the subtitle says it's refreshing.
export function showLoading() {
  if (shared.allJobs.length) { $('jobs-stats').textContent = byStore(t('pagesJobsFinal.refreshNotion'), t('pagesCommon.refreshing')); return; }
  const box = el('div', 'list-loading');
  box.append(el('span', 'spinner'), el('div', '', byStore(t('pagesJobsFinal.loadingJobsNotion'), t('pagesJobsFinal.loadingJobs'))),
    el('div', 'muted small', t('pagesJobsFinal.loadingJobsDetail')));
  $('jobs-body').replaceChildren(box);
  $('jobs-stats').textContent = byStore(t('pagesFocusReports.loadingNotion'), t('pagesCommon.loading'));
}
