// Jobs → Board: the applications in columns by Stage (the 🎯 Pipeline page's board in Notion), a card per job like the "In conversation"
// rows. Dragging a card to another column, or its ⋯ "Move to", asks the app for that stage (setStatus / setStage, jobs-board-rules.js
// dropFor), so the store's rules decide; the card stays where the store left it. Guarded by: test/unit/renderer/jobs-board-page.test.js.
import '../../i18n/screens-pages.js';
import {stageName} from './page-labels.js';
import {t} from '../../i18n/index.js';
import {el, moreButton, pill} from '../components.js';
import {boardColumns, columnOf, dropFor, nextStepOf, STAGES, takesDrop, stageLabel} from '../jobs-board-rules.js';
import {matchLabel} from '../jobs-view.js';
import {rowModel} from '../job-row-model.js';
import {$} from './core.js';
import {openJobPanel} from './job-panel.js';
import {toastMessage} from './startup.js';
import {jobsChanged} from './jobs.js';
import {readOf, triageChip} from './jobs-triage.js';
import {accountChip} from '../account-chip.js';
import {openFromBoard} from './jobs-views.js';
import {jobPlace} from '../targets.js';

let dragged = null;   // the job being dragged (dataTransfer is unreadable during dragover)

export async function moveJob(job, stage) {
  const move = dropFor(job, stage);
  if (move.none) return;
  if (move.refused) { toastMessage(t('pagesJobs.notMoved'), move.refused, jobPlace(job), 'warn'); return; }
  const before = job.stage;
  const result = await window.pilot[move.call](job.url, move.arg).catch(error => ({ok: false, error: error.message}));
  if (!result?.ok) { toastMessage(t('pagesJobs.notMoved'), result?.error || t('pagesCommon.tryAgain'), jobPlace(job), 'bad'); return; }
  // The store's answer is the truth: Saved or Dismissed never replace a real stage (rules.mark), so the card may stay.
  const landed = result.stage || (move.call === 'setStage' ? stage : before);
  jobsChanged(job, {stage: landed});
  if (landed === before) toastMessage(t('pagesJobs.kept'), t('pagesDynamicJobs.m216', {"value1": job.title || t('pagesJobs.thisJob'), "stageLabel": stageName(stageLabel(before)), "stageLabel3": stageName(stageLabel(stage))}), jobPlace(job), 'info');
  else toastMessage(t('pagesJobs.moved'), `${job.title || t('pagesJobs.thisJob')}: ${stageName(stageLabel(landed))}.`, jobPlace(job), 'good');
  document.dispatchEvent(new CustomEvent('jobs-rerender'));
}

function card(job) {
  const item = Object.assign(el('li', 'focus-item board-card'), {tabIndex: 0, draggable: true, title: t('pagesJobsHelp.dragStage')});
  Object.assign(item.dataset, {code: job.code || '', url: job.url || ''});   // a pop-up's click finds it (pages/open-target.js focusJob)
  const body = el('div', 'focus-body'), parts = rowModel(job);
  body.append(el('span', 'focus-headline', job.title || t('pagesJobs.role')), el('div', `focus-meta muted small${parts.who.blank ? ' is-na' : ''}`, parts.who.name));
  if (job.fit != null) body.append(el('div', 'muted small', `${job.fit} · ${matchLabel(job.fit)}`));   // a narrow column: one fact a line
  if (nextStepOf(job)) body.append(el('div', 'muted small', t('pagesShortJobs.m172', {"nextStepOf": nextStepOf(job)})));
  // Why (2026-10-30, owner; 2 Nov 2026 only a job still waiting for you: an applied or inbound card has no apply read): the mode of the job's last read, or "Not checked" (spec 2026-10-30-apply-triage).
  // Why (13 Nov 2026, owner: "Still bad UI. Lack of spacing/margin/padding", then picked "B: short chip"): the check chip and "Account needed" sit in one chip row with their own spacing,
  // not in the card's 2 px text column, and the narrow card shows the check's value only ("Needs you"); its reason stays in the tooltip, the list and the job's page.
  if (parts.triage) {
    const chips = el('div', 'board-card-chips');
    chips.append(triageChip(job, {detail: false}));
    const account = accountChip(readOf(job.url));
    if (account) chips.append(account);
    body.append(chips);
  }
  const moves = STAGES.filter(stage => stage !== columnOf(job) && takesDrop(stage))
    .map(stage => ({label: stageName(stageLabel(stage)), run: () => moveJob(job, stage)}));
  item.append(body, moreButton([{label: t('pagesJobs.moveTo'), disabled: true}, ...moves], t('pagesJobs.moveStage')));
  item.addEventListener('dragstart', event => { dragged = job; event.dataTransfer.setData('text/plain', job.url || ''); item.classList.add('is-dragging'); });
  item.addEventListener('dragend', () => { dragged = null; item.classList.remove('is-dragging'); });
  const open = event => { if (!event.target.closest('button, .ui-menu')) openFromBoard(() => openJobPanel(job)); };
  item.addEventListener('click', open);
  item.addEventListener('keydown', event => { if (event.key === 'Enter') open(event); });
  return item;
}

export function renderBoard(jobs) {
  const board = $('jobs-board');
  const columns = boardColumns(jobs);
  board.replaceChildren(...columns.map(column => {
    const box = el('section', `board-column${column.jobs.length ? '' : ' is-empty'}`);
    box.dataset.stage = column.stage;
    const head = el('header', 'board-column-head');
    head.append(pill(stageName(stageLabel(column.stage)), column.tone, {dot: true}), el('span', 'muted small', String(column.jobs.length)));
    const list = el('ol', 'focus-list board-cards');
    list.append(...column.jobs.map(card));
    box.append(head, list);
    if (takesDrop(column.stage)) {
      box.addEventListener('dragover', event => { if (dragged && columnOf(dragged) !== column.stage) { event.preventDefault(); box.classList.add('is-over'); } });
      box.addEventListener('dragleave', () => box.classList.remove('is-over'));
      box.addEventListener('drop', event => { event.preventDefault(); box.classList.remove('is-over'); if (dragged) moveJob(dragged, column.stage); });
    } else box.title = t('pagesDynamicJobs.m218', {"stageLabel": stageName(stageLabel(column.stage))});
    return box;
  }));
  if (!jobs.length) board.prepend(el('p', 'empty board-empty', t('pagesJobsHelp.noBoard')));
}
