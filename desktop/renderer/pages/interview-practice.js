// Interviews page, small parts: the supporting-moments dialog, the practice session, the loading skeleton rows and
// the "3 min ago" text. Moved out of interviews.js, which passes in the insight view and the row opener.
// Guarded by test/unit/renderer/interview-insight.test.js, test/unit/renderer/interview-library.test.js and test/unit/renderer/review-again.test.js.
import '../../i18n/screens-pages.js';
import {t} from '../../i18n/index.js';
import * as practice from '../practice-session.js';
import {el} from '../components.js';
import {$, show} from './core.js';

export function skeletonRows(n = 3) {
  return Array.from({length: n}, () => {
    const tr = document.createElement('tr');
    tr.className = 'iv-skeleton';
    for (const cls of ['w-60', 'w-80', 'w-80', 'w-40', 'w-40', 'button small']) {
      const td = document.createElement('td');
      td.append(el('span', `skeleton ${cls}`));
      if (cls === 'w-80') td.append(el('span', 'skeleton w-40'));
      tr.append(td);
    }
    return tr;
  });
}
export function agoText(at) {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(at)) / 60000));
  return minutes < 1 ? t('pagesControlStatus.justNow') : minutes < 60 ? `${minutes} min ago` : `${Math.round(minutes / 60)} h ago`;
}
// View supporting moments: the quotes behind each pattern; a name opens that interview in the library.
export function showMoments(view, showRow, title = '') {
  if (!view?.moments?.length) return;
  $('moments-body').replaceChildren(...view.moments.map(group => {
    const box = el('div', 'iv-moments-group');
    box.dataset.title = group.title;
    box.append(el('h3', '', group.title));
    for (const item of group.quotes) {
      const line = el('div', 'iv-moment');
      line.append(el('span', '', `“${item.quote}”`));
      const who = Object.assign(el('button', 'link small', item.where || item.name), {type: 'button', title: t('pagesInterviews.showLibrary')});
      who.addEventListener('click', () => { $('moments-dialog').close(); showRow(item.id); });
      line.append(who);
      box.append(line);
    }
    return box;
  }));
  show($('moments-notion'), !!view.supporting?.url);
  $('moments-notion').onclick = () => window.pilot.openNotion(view.supporting.url);
  $('moments-dialog').showModal();
  // opened from a pattern's "N quotes": scrolled to that pattern
  if (typeof title === 'string' && title) [...$('moments-body').children].find(box => box.dataset.title === title)?.scrollIntoView({block: 'start'});
}
// Start practice session: the steps still to do, one at a time, each with a countdown; "Done" ticks it (saved in Notion).
let session = null, sessionTimer = null, onTick = () => {};  // onTick: interviews.js tickStep, saves a ticked step
export function startPractice(steps, tickStep) {
  onTick = tickStep;
  const state = practice.begin(steps);
  if (state.finished) return;
  session = state;
  drawPractice();
  $('practice-dialog').showModal();
  clearInterval(sessionTimer);
  sessionTimer = setInterval(() => { session = practice.tick(session); drawPractice(); }, 1000);
}
export function endPractice() { clearInterval(sessionTimer); sessionTimer = null; session = null; }
function drawPractice() {
  if (!session) return;
  const button = (label, cls, run) => { const b = Object.assign(el('button', cls, label), {type: 'button'}); b.addEventListener('click', run); return b; };
  const body = $('practice-body'), foot = $('practice-foot');
  const step = practice.current(session);
  if (!step) {
    const {done, skipped, total} = practice.summary(session);
    body.replaceChildren(el('h3', '', done === total ? t('pagesJobs.allDone') : `${done} of ${total} practised`),
      el('p', 'muted', skipped ? `${skipped} skipped: they stay in Practice next.` : t('pagesInterviews.practiceTicked')));
    foot.replaceChildren(button(t('pagesCommon.close'), 'primary', () => $('practice-dialog').close()));
    return;
  }
  const time = el('div', `iv-practice-clock${session.remaining === 0 ? ' is-over' : ''}`, session.remaining === 0 ? t('pagesJobs.timeUp') : practice.clock(session.remaining));
  body.replaceChildren(el('p', 'muted small', `Step ${session.index + 1} of ${session.steps.length}`), el('h3', '', step.title),
    ...(step.detail ? [el('p', 'muted', step.detail)] : []), el('p', '', t('pagesInterviews.answerAloud')), time);
  const go = button(session.running ? t('pagesSession.pause') : session.remaining === practice.STEP_SECONDS ? t('pagesJobs.startClock') : t('pagesJobs.resume'), 'secondary', () => { session = practice.toggle(session); drawPractice(); });
  foot.replaceChildren(go, button(t('pagesCommon.skip'), 'ghost', () => { session = practice.finishStep(session, 'skipped'); drawPractice(); }),
    button(t('pagesJobs.doneNext'), 'primary', () => {
      const text = step.text;
      session = practice.finishStep(session, 'done');
      onTick({text}, true);
      drawPractice();
    }));
}
