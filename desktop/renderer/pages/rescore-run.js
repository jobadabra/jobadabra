// The one owner of "a re-score is running" and of the last known count of scores from the previous strategy (owner, 2 Nov 2026: Jobs and Strategy say the same
// thing from one counter; Re-scoring has its own card on Jobs, not the Find jobs card). Both screens READ the state here and never keep their own: Strategy's notice,
// Jobs' call to action and card, and the "Score first" gate on every Find jobs press. Changed only by runRescore (start and end of the re-score) and by noteOutdated
// (a fresh read from the engine: the Jobs list or Strategy). <body data-rescoring> is the one attribute style.css turns into "the re-scoring card shows, the Find jobs
// card does not", so no draw order matters. Guarded by test/rescore-call.test.js.
import {refusal} from '../refusal.js';
import {$} from './core.js';
import {dialogLead, jobs} from '../rescore-words.js';

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

/**
 * Re-score every outdated job once: queue them (engine), then a search scores up to 60 now and the rest in the next ones (the existing mechanism: its row says "Re-scoring N older scores").
 * @param {number} count how many the person saw
 * @param {{search: Function, reload: Function, toast: Function}} how search: pages/jobs.js startSearch and toast: pages/startup.js toastMessage (passed in: those modules import this one, and this one stays light for its test); reload: what to read again at the end
 */
export async function runRescore(count, {search: startSearch, reload, toast}) {
  if (running) return;
  running = {count};
  document.body.dataset.rescoring = '1';
  changed();
  try {
    const result = await window.pilot.rescoreOutdated().catch(error => ({ok: false, error: error.message}));
    if (!result.ok) { toast('Not re-scored', result.error, {view: 'strategy'}, 'bad'); return; }
    const searching = startSearch({reason: 'rescore', count: result.queued});   // resolves when the search ends
    // A refusal answers at once and startSearch says it (renderer/refusal.js): "Re-scoring now" only when it was not refused.
    if (refusal(await Promise.race([searching, new Promise(resolve => setTimeout(resolve, 1500))]))) return;
    toast({title: 'Re-scoring now', body: `${jobs(result.queued)} get a new score${result.queued > 60 ? ' (60 now, the rest in the next searches)' : ''}. ` +
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
  const dialog = $('rescore-dialog');
  $('rescore-title').textContent = `Re-score ${jobs(count)}?`;
  $('rescore-lead').textContent = dialogLead(count);
  $('rescore-go').textContent = `Re-score ${count}`;
  dialog.returnValue = '';
  dialog.onclose = () => { if (dialog.returnValue === 'go') runRescore(count, how); };
  dialog.showModal();
}
