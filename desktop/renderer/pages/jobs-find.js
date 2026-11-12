// Jobs page, the "Find jobs" card on top (owner, 16 Oct 2026; centered magic card + moving searching card 24 Oct 2026): a big card on an empty first run, then the live progress of the search (steps, last
// lines, counts) with the list growing below it, then a one-line result; a failure says what to do. Built from the shared header, number strip, pills and
// rows (no new look). Data: renderer/find-card-model.js. Guarded by: test/unit/renderer/find-card.test.js.
// It is in the page's first paint (owner, 26 Oct 2026: it came 2-3 s late and pushed the list down): as last drawn (renderer/late-blocks.js), else
// index.html's skeleton in its place; activity.js draws the real state with its first runs answer, not 2 s later. Guarded by: test/unit/renderer/late-blocks.test.js.
import {number as displayNumber} from '../../i18n/format.js';
import '../../i18n/screens-pages.js';
import {t} from '../../i18n/index.js';
import {cardHead, el, liveRows, pill, tile} from '../components.js';
import {icon} from '../icons.js';
import {wand, wire} from '../magic.js';
import {jobCounts} from '../jobs-view.js';
import {findCard, keptFindCard, limitWords, readProgressModel, waitsForList} from '../find-card-model.js';
import {keepBlock, keptBlock} from '../late-blocks.js';
import {jobsState} from './jobs-state.js';
import {$, show} from './core.js';
import {showFullReport} from './full-report.js';
import {checkQueue} from './score-queue.js';
import {openSetting} from './settings.js';
import {openTopupDialog} from './topup-dialog.js';
import {refusalAction} from '../refusal.js';

let signature = '', wasSearching = false, finishedHere = false, lastRuns = null;
let start = () => {};
let refused = null;   // the last press's refusal (renderer/refusal.js), shown on the card until the next press or search
let liveOpen = true, liveFollow = true, liveShown = new Set();   // the fold: open, following its newest line, the lines drawn last time
export const wireFindCard = startSearch => { start = startSearch; };
// The press's refusal (renderer/refusal.js), or null to clear it (a new press). -> whether the card is on screen to say it (else the caller says it in a pop-up).
export function showFindRefused(why) {
  refused = why || null;
  renderFindCard();
  return !!$('find-card') && $('find-card').offsetParent !== null;
}

const button = (text, handler, className = 'primary') => Object.assign(el('button', className, text), {type: 'button', onclick: handler});

// This search's one number (find-card-model.js addedSoFar): the jobs it added to your list, a green "+9 added" beside the title (owner, 24 Oct 2026: scoring and its
// queue are internal, never shown). A search that added nothing yet shows no pill while it runs, and a quiet "No jobs added" when it is done.
// A search that ended at the 3-minute limit (model.partial, #3108) is an amber "Partial" when it added nothing: never the quiet "No jobs added" of a search that finished and found nothing.
const addedPill = (model, done) => (model.added ? pill(t('pagesShortJobs.m177', {"displayNumber": displayNumber(model.added)}), 'good') : done && model.partial ? pill(t('pagesJobs.partial'), 'warn') : done ? pill(t('pagesJobs.noAdded'), 'neutral') : null);
function findHead(title, model, lead, {done = false, spinner = false} = {}) {
  const row = el('div', 'find-head'), pillNode = addedPill(model, done);
  if (spinner) row.append(Object.assign(el('span', 'spinner'), {ariaHidden: 'true'}));
  row.append(el('h3', 'find-title', title), ...(pillNode ? [pillNode] : []), el('span', 'muted find-scope', t('pagesJobs.thisSearch')));
  const box = el('div', 'find-head-box');
  box.append(row, el('p', 'muted find-lead', lead));
  return box;
}

// The compact cards' one button, on the right (a done search and "Find more jobs"): a wand button, so it gets the cursor and the burst (magic.js).
const again = label => wand(button(label, () => start(), 'primary find-again'));

// Employers read as progress (bar + "1,953 of 2,251"); before the first count the bar slides, so the card never looks still. The raw count of
// downloaded listings is not shown: 130k+ is noise (owner, 19 Oct 2026).
function readProgress(model) {
  const box = el('div', 'find-progress'), n = value => displayNumber(value), progress = readProgressModel(model.employers);
  const head = el('div', 'progress-head'), bar = el('div', progress.kind === 'count' ? 'bar' : 'bar is-sliding'), fill = el('span');
  if (progress.kind === 'count') fill.style.width = `${progress.percent}%`;
  bar.append(fill);
  const count = progress.kind === 'count' ? `${n(progress.done)} / ${n(progress.total)}${model.employers.stopped ? t('pagesAuditSecond.a97') : ''}` : t('pagesCommon.starting');
  head.append(el('span', '', t('pagesJobs.employersChecked')), el('span', 'muted', count));
  box.append(head, bar);
  return box;
}

// The empty first run: the shared magic card (renderer/magic.css, like the Welcome card), the whole card is the Find jobs button (owner, 24 Oct 2026).
function drawEmpty(card) {
  card.className = 'card find-card is-empty magic';
  const twinkles = [0, 1, 2].map(() => Object.assign(el('span', 'magic-twinkle'), {ariaHidden: 'true'}));
  twinkles.forEach(node => node.append(icon('sparkle')));
  card.replaceChildren(...twinkles, tile('search'), el('span', 'eyebrow', t('pagesJobs.getStarted')), el('h2', 'magic-title', t('pagesCommon.findJobs')),
    el('p', 'muted subtitle magic-sub', t('pagesJobsHelp.searchHelp')),
    button(t('pagesCommon.findJobs'), () => start(), 'primary magic-go'));
  wire(card);
}

function draw(model) {
  const card = $('find-card');
  card.className = `card find-card is-${model.state}`;
  if (model.state === 'empty') {
    drawEmpty(card);
  } else if (model.state === 'searching') {
    const chips = el('div', 'chip-row find-steps');
    chips.append(...model.chips.map(chip => {
      // skipped: decided not to run (the web search rested or off), said in its label, why in its tooltip; failed: it ran and gave no answer
      const tone = {active: 'signal', done: 'good', failed: 'warn'}[chip.state] || 'neutral';
      const node = pill(chip.label, tone, {dot: chip.state === 'active', title: chip.note || ''});
      node.classList.add('find-step', `is-${chip.state}`);   // the active step pulses, a finished one shows a tick, a waiting one a clock (find-card.css)
      if (chip.state === 'pending') node.prepend(icon('clock'));
      return node;
    }));
    const lines = el('ul', 'run-card-rows');
    lines.append(...liveRows(model.lines));
    [...lines.children].forEach((row, i) => row.classList.toggle('is-new', !liveShown.has(model.lines[i])));   // only a new line rises in (find-card.css)
    liveShown = new Set(model.lines);
    lines.addEventListener('scroll', () => { liveFollow = lines.scrollHeight - lines.scrollTop - lines.clientHeight < 24; });   // scrolled up to read: stay there
    // The live updates fold (owner, 24 Oct 2026): a native <details>, open by default; the choice survives the card's redraws.
    const live = Object.assign(el('details', 'find-live'), {open: liveOpen});
    live.append(el('summary', '', t('pagesJobs.liveUpdates')), lines);
    live.addEventListener('toggle', () => { liveOpen = live.open; });
    const steps = el('div', 'find-steps-row');   // the chips, with the fold's label at the right of the same row; the lines open below it
    steps.append(chips, live);
    card.replaceChildren(findHead(t('pagesControlStatus.findingJobs'), model, model.added ? t('pagesAuditSecond.a98') : t('pagesControlStatus.firstJobs'), {spinner: true}), readProgress(model), steps);
    if (liveFollow) lines.scrollTop = lines.scrollHeight;
  } else if (model.state === 'done') {
    // Why (12 Nov 2026, owner, asked via AskUserQuestion: "Yes, one bar, a count (Recommended)"): while the queue checks the jobs this search had no time for, the card says so; the bar above the list counts them.
    const checking = checkQueue(), still = checking ? t('pagesJobsHelp.checkLead', {total: checking.waiting}) : '';
    const head = model.partial
      ? findHead(t('pagesControlStatus.searchTimeLimit'), model, still || t('pagesDynamicJobs.m223', {"value1": limitWords(model.partial).replace(/^./, c => c.toUpperCase())}), {done: true})
      : findHead(t('pagesControlStatus.searchDone'), model, still || t('pagesAuditSecond.a99'), {done: true});
    if (model.runId) head.append(wand(button(t('pagesJobs.fullReport'), () => showFullReport(model.runId), 'link small')));   // every number of this search, in Reports → Searches
    card.replaceChildren(head, again(t('pagesCommon.findAgain')));
  } else if (model.state === 'none') {   // a full list and no search finished here: the same compact card, one button (owner, 25 Oct 2026: "Find more jobs")
    const head = findHead(t('pagesControlStatus.findMore'), model, t('pagesAuditSecond.a100'));
    card.replaceChildren(head, again(t('pagesCommon.findJobs')));
  } else if (model.state === 'refused') {   // the press was refused before anything ran (no AI credit, trial over, Always on): why, and the way out
    const label = refusalAction(model);   // the compact "Find more jobs" card, its line the reason and its button the way out
    card.replaceChildren(findHead(t('pagesControlStatus.findNotStarted'), model, model.problem),
      label ? button(label, () => (refused?.credit ? openTopupDialog(refused, {action: t('pagesCommon.findJobs'), retry: () => start()}) : openSetting('plan')), 'primary find-again') : again(t('pagesCommon.tryAgainShort')));
  } else if (model.state === 'failed') {
    card.replaceChildren(cardHead(t('pagesControlStatus.searchStopped'), t('pagesControlStatus.searchNotFinished'), {subtitles: [model.problem || t('pagesAuditSecond.a101')]}),
      button(t('pagesCommon.tryAgainShort'), () => start()));
  }
  card.removeAttribute('aria-busy');
  show(card, visible(model.state));
  document.body.dataset.findCard = model.state;
}

// The first paint (pages/jobs.js init): the card as it was last drawn; with nothing kept, index.html's skeleton stays until the runs answer.
export function paintFindCardFirst() {
  const kept = keptBlock('find-card');
  if (kept?.state && $('find-card')) draw(kept);
}

// Called with the window's first runs answer and every 2 s after (pages/activity.js), and when the job list is read (pages/jobs.js: its count).
export function renderFindCard(runsNow = lastRuns) {
  if (!$('find-card') || !runsNow) return;
  lastRuns = runsNow;
  const searching = !!runsNow.running && (runsNow.running.kind || 'search') === 'search';
  if (wasSearching && !searching) finishedHere = true;
  if (searching) finishedHere = false;
  wasSearching = searching;
  const counts = jobCounts(jobsState.lastJobsData);   // the same numbers as the counters below (jobs-view.js)
  const model = findCard({running: runsNow.running, last: (runsNow.runs || []).find(run => (run.kind || 'search') === 'search') || null,
    lastSearchAt: runsNow.lastSearchAt, listed: runsNow.listed ?? counts.total, anyJob: !!(runsNow.listed ?? counts.anyJob), finishedHere});   // runsNow.listed: only the screenshots set it
  if (waitsForList(model, runsNow.listed != null || !!jobsState.lastJobsData || !!jobsState.jobsRead)) return;   // the kept paint or the skeleton stays
  if (searching) refused = null;
  const shown = refused ? {state: 'refused', problem: refused.text, credit: refused.credit, allowance: refused.allowance} : model;
  const key = JSON.stringify(shown);
  if (key === signature) return;
  signature = key;
  draw(shown);
  if (!refused) keepBlock('find-card', keptFindCard(model));   // a refusal is this launch's news, never the next start's first paint
}

// "Find more jobs" belongs to the lists that hold job matches (jobs-filters.js findsMore): under Inbound or Applied a search would add rows to
// none of them, so its idle cards step aside. A search in progress, a refusal or a failure stay: they are news about a press, wherever it was made.
let listFinds = true;
const visible = state => listFinds || !(state === 'none' || state === 'done');
/** Called by every Jobs redraw with whether the ticked filters hold job matches; shows or hides the card already drawn. Takes a boolean; returns nothing. */
export function followFilter(finds) {
  if (finds === listFinds) return;
  listFinds = finds;
  const card = $('find-card'), state = document.body.dataset.findCard;
  if (card && state) show(card, visible(state));
}

// The Find jobs card is showing its searching state: the rows without a score say Scoring… instead of Not scored.
export const searchingNow = () => document.body.dataset.findCard === 'searching';
