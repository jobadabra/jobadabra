// Jobs page, List | Board: the toggle between the list and the board (pages/jobs-board.js). renderJobs (jobs-render.js) calls paintViews at its end.
// The Applications database's views are options of the Show menu now (jobs-filters.js, pages/jobs-filter-menu.js).
// Guarded by: test/unit/renderer/jobs-board-rules.test.js (the rules), test/unit/renderer/jobs-board-page.test.js (this wiring).
import '../../i18n/screens-pages.js';
import {t} from '../../i18n/index.js';
import {$, show} from './core.js';
import {jobsState} from './jobs-state.js';
import {renderBoard} from './jobs-board.js';

const MODE_KEY = 'jobsMode';

// The end of every renderJobs: the toggle, and the list or the board. boardJobs = what the board shows (Applications rows,
// narrowed by the ticked filters or counter and the search words).
export function paintViews(boardJobs) {
  const board = jobsState.mode === 'board';
  document.querySelectorAll('[data-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === jobsState.mode)));
  show($('jobs-board'), board);
  show($('jobs-split'), !board);
  if (!board) return;
  $('jobs-head').hidden = true;
  show($('jobs-more'), false);
  $('jobs-count').textContent = t('pagesCounts.board', {count: boardJobs.length});
  show($('jobs-empty'), false);
  renderBoard(boardJobs);
}

// A board card's click: the job's drawer, over the board.
export function openFromBoard(open) {
  open();
}

function setMode(mode, render = true) {
  jobsState.mode = mode === 'board' ? 'board' : 'list';
  try { localStorage.setItem(MODE_KEY, jobsState.mode); } catch {}
  if (jobsState.mode !== 'board') $('jobs-head').hidden = false;
  if (render) document.dispatchEvent(new CustomEvent('jobs-rerender'));
}

export function wireViews() {
  try { jobsState.mode = localStorage.getItem(MODE_KEY) === 'board' ? 'board' : 'list'; } catch {}
  document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode)));
}
