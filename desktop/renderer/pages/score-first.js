// "Score first": every Find jobs press while scores are from the previous strategy (owner, 2 Nov 2026: "Find jobs should be only for finding jobs. But pressing
// Find jobs should open a dialog saying: Score first"). Two ways on: Re-score N (or "Re-score 60 now" past 60) (the re-score's own card runs), or Find jobs without re-scoring. Cancel starts nothing.
// The words are rescore-words.js's (the Strategy notice's, the same sentence); the count is rescore-run.js's. Guarded by test/rescore-call.test.js.
import {$} from './core.js';
import {knownOutdated, rescoring, runRescore} from './rescore-run.js';
import {pressLabel, scoreFirstLead, scoreFirstSkip, scoreFirstTitle} from '../rescore-words.js';

/** -> 'rescore' | 'find' | 'cancel' once the person chose. */
export function askScoreFirst(count) {
  const dialog = $('score-first-dialog');
  $('score-first-title').textContent = scoreFirstTitle;
  $('score-first-lead').textContent = scoreFirstLead(count);
  $('score-first-go').textContent = pressLabel(count);
  $('score-first-find').textContent = scoreFirstSkip;
  dialog.returnValue = '';
  return new Promise(resolve => {
    dialog.addEventListener('close', () => resolve({go: 'rescore', find: 'find'}[dialog.returnValue] || 'cancel'), {once: true});
    dialog.showModal();
  });
}

/** The gate in front of every Find jobs press. The plain press (not a re-score, not Find employers) while N scores are from the previous strategy and no re-score runs
 * asks "Score first". -> null to go on finding; else the answer to give the caller: a re-score ran, or nothing was started (Cancel, or the dialog is already open).
 * how: {search, reload, toast} for runRescore. */
export async function scoreFirst(why, how) {
  const count = knownOutdated().count;
  if (why?.reason || why?.employers || !count || rescoring()) return null;
  if ($('score-first-dialog').open) return {ok: false, held: true};   // asked already (palette, suggestion): the dialog's own state, which flips the moment a button is pressed, never a second dialog
  const choice = await askScoreFirst(count);
  if (choice === 'find') return null;
  if (choice === 'rescore') { await runRescore(count, how); return {ok: true, rescored: true}; }
  return {ok: false, held: true};   // no error text: refusal() says nothing, the press was cancelled
}
