// The one owner of "a re-score is running" and of the last known count of scores from the previous strategy (owner, 2 Nov 2026: Jobs and Strategy say the same
// thing from one counter; Re-scoring has its own card on Jobs, not the Find jobs card). Both screens READ the state here and never keep their own: Strategy's notice,
// Jobs' call to action and card, and the "Score first" gate on every Find jobs press. Changed only by runRescore (start and end of the re-score) and by noteOutdated
// (a fresh read from the engine: the Jobs list or Strategy). <body data-rescoring> is the one attribute style.css turns into "the re-scoring card shows, the Find jobs
// card does not", so no draw order matters. Guarded by test/unit/renderer/rescore-call.test.js.
import '../../i18n/screens-pages.js';
import {t} from '../../i18n/index.js';
import {refusal} from '../refusal.js';
import {$} from './core.js';
import {dialogLead, jobs, pressLabel} from '../rescore-words.js';

let outdated = {count: 0, method: 0, places: 0};
let running = null;   // {count} from the dialog's Re-score until its search has ended: one start at a time
const changed = () => document.dispatchEvent(new Event('rescore-state'));

/** The engine's own summary ({count, method, places}, src/desktop_strategy.py outdated) from the last read of Jobs or Strategy; null (a read without it) changes nothing. */
export function noteOutdated(summary) {
  if (!summary) return;
  const next = {count: summary.count || 0, method: summary.method || 0, places: summary.places || 0};
  if (JSON.stringify(next) === JSON.stringify(outdated)) return;   // a screen drawing from this state must not wake itself
  outdated = next;
  changed();
}
/** The last count of scores from the previous strategy, as the latest Jobs or Strategy read said it -> {count, method, places} (zeros before any read). */
export const knownOutdated = () => outdated;
/** The re-score running now -> {count}, or null when none runs (the one state; <body data-rescoring> mirrors it). */
export const rescoring = () => running;

/** Whether a Find jobs search runs now (the one <body data-find-card> state, pages/jobs-find.js searchingNow, read here so this module stays light). */
const searching = () => document.body.dataset.findCard === 'searching';
const WAIT = ['Re-score waits', 'Jobs are being found right now: one run at a time. Press Re-score again when it ends.', {view: 'jobs'}, 'warn'];

/**
 * Re-score every outdated job once: queue them (engine), then a re-score run (engine mode rescore, never a Find jobs search) scores up to 60 now; the rest stay marked Old score for the next press (its row says "Re-scoring N older scores").
 * @param {number} count how many the person saw
 * @param {{search: Function, reload: Function, toast: Function}} how search: pages/jobs.js startSearch and toast: pages/startup.js toastMessage (passed in: those modules import this one, and this one stays light for its test); reload: what to read again at the end
 */
export async function runRescore(count, {search: startSearch, reload, toast}) {
  if (running) return;
  // Why (5 Nov 2026, code review): the yellow bar's Re-score was greyed while a plain search ran; the Jobs row, ⌘K and Strategy have no such state, and a press queued the jobs
  // (rescoreOutdated) before the search refused to start. One check here covers every surface that starts a re-score.
  if (searching()) { toast(...WAIT); return; }
  running = {count};
  document.body.dataset.rescoring = '1';
  changed();
  try {
    const result = await window.pilot.rescoreOutdated().catch(error => ({ok: false, error: error.message}));
    if (!result.ok) { toast('Not re-scored', result.error, {view: 'strategy'}, 'bad'); return; }
    const searching = startSearch({reason: 'rescore', count: result.queued});   // resolves when the search ends
    // A refusal answers at once and startSearch says it (renderer/refusal.js): "Re-scoring now" only when it was not refused.
    if (refusal(await Promise.race([searching, new Promise(resolve => setTimeout(resolve, 1500))]))) return;
    toast({title: t('pagesFocusReports.rescoring'), body: `${jobs(result.queued)} get a new score${result.queued > 60 ? ' (60 now, press Re-score again for the rest)' : ''}. ` +
      'It shows in Recent activity as "Re-scoring".', target: null, tone: 'info'});
    await searching;
  } finally {
    running = null;
    delete document.body.dataset.rescoring;
    changed();
    await reload?.();
  }
}

/** The Re-score dialog ("Re-score N jobs?", its cost line): the start only ever comes from its own button (or the Score-first dialog's), never from a save or a plain press. */
export function confirmRescore(count, how) {
  if (running) return;
  if (searching()) { how.toast(...WAIT); return; }   // asked before the dialog: nobody confirms a start that would be refused
  const dialog = $('rescore-dialog');
  $('rescore-title').textContent = `Re-score ${jobs(count)}?`;
  $('rescore-lead').textContent = dialogLead(count);
  $('rescore-go').textContent = pressLabel(count);
  dialog.returnValue = '';
  dialog.onclose = () => { if (dialog.returnValue === 'go') runRescore(count, how); };
  dialog.showModal();
}
