// Draws the scoring queue on the Jobs list (state: pages/score-queue.js): the bar above the list, and an unscored row's circle as Queued (its place in line),
// Scoring, or, when no queue runs, a "Score" press that starts one. Styles: score-queue.css. Guarded by test/unit/renderer/score-queue.test.js.
import '../../i18n/screens-pages.js';
import {t} from '../../i18n/index.js';
import {el} from '../components.js';
import {$, show} from './core.js';
import {checkQueue, queuePlace, queueRuns, scoreQueue} from './score-queue.js';

/**
 * One unscored candidate's circle while no search runs. -> true when it drew a state (the caller then leaves the circle alone).
 * @param {HTMLElement} fit the row's fit cell; @param {HTMLElement} ring its ring; @param {{code: string}} job; @param {Function|null} score starts the queue (null: no press offered)
 */
export function drawQueueRing(fit, ring, job, score) {
  const place = queuePlace(job.code);
  if (place?.state === 'scoring') {
    fit.classList.add('is-scoring');
    ring.replaceChildren(el('span', '', ''));
    fit.append(el('span', 'fit-label', t('pagesJobsHelp.queueScoring')));
    fit.title = t('pagesJobsHelp.scoring');
    return true;
  }
  if (place) {
    fit.classList.add('is-queued');
    ring.replaceChildren(el('span', '', String(place.place)));
    fit.append(el('span', 'fit-label', t('pagesJobsHelp.queueQueued')));
    fit.title = t('pagesJobsHelp.queuedTip', {place: place.place});
    return true;
  }
  if (queueRuns() || !score) return false;   // a queue runs and this job is past it (or its score is on its way in): the plain unscored circle
  fit.classList.add('can-score');
  const press = Object.assign(el('button', 'fit-label', t('pagesJobsHelp.queueScore')), {type: 'button', title: t('pagesJobsHelp.scoreTip')});
  press.addEventListener('click', event => { event.stopPropagation(); score(); });
  fit.append(press);
  return true;
}
/** The bar above the list: shown only while a queue runs. One bar, its words say the step: first the jobs the search had no time to check (a count), then the scores. */
export function paintQueueBar() {
  const queue = scoreQueue(), checking = checkQueue(), bar = $('score-queue-bar');
  if (!bar) return;
  show(bar, !!(queue || checking));
  if (checking) {
    $('score-queue-text').textContent = t('pagesJobsHelp.checkBar', {done: checking.done, total: checking.waiting});
    $('score-queue-fill').style.width = `${Math.round(checking.done / checking.waiting * 100)}%`;
    $('score-queue-note').textContent = t('pagesJobsHelp.checkNote');
    return;
  }
  if (!queue) return;
  $('score-queue-text').textContent = t('pagesJobsHelp.queueBar', {done: queue.done, total: queue.total});
  $('score-queue-fill').style.width = `${Math.round(queue.done / queue.total * 100)}%`;
  $('score-queue-note').textContent = queue.left ? t('pagesJobsHelp.queueLeft', {left: queue.left}) : t('pagesJobsHelp.queueNote');
}
