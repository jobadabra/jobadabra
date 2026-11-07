// Reports → Form fills (mounted by pages/reports.js: renderFormFills(container), called each time the tab opens): past extension fills
// and Claude sessions from the active store (lib/form-fills-handlers.js). A list (search, outcome filter); a row opens its
// detail in place: the field-by-field table (answer source, result, note, low confidence), Left for you, learnings, step timings or the
// session's timeline and numbers. Drawn inside the Reports card, so tables are .data-table (no box in a box); shared components only.
// Logic without a window: renderer/form-fills-view.js. Guarded by test/unit/renderer/form-fills-view.test.js, test/unit/main/form-fills-handlers.test.js.
import '../../i18n/screens-pages.js';
import {t} from '../../i18n/index.js';
import {plainError} from '../run-warnings.js';
import {cardHead, el, numberStrip, pill} from '../components.js';
import {icon} from '../icons.js';
import {byStore, storeName} from '../store-words.js';
import {runWhen} from './core.js';
import {attachments, fieldRows, filterRuns, isSession, learnings, leftForYou, listLine, sessionNumbers, steps, summary, timeline, withTimeout} from '../form-fills-view.js';

const state = {runs: null, open: null, text: '', outcome: ''};
const READ_TIMEOUT_MS = 20000;
let host = null;

const table = (heads, rows) => {
  const t = el('table', 'data-table');
  const head = el('tr', '');
  head.append(...heads.map(text => el('th', '', text)));
  const thead = el('thead', ''); thead.append(head);
  const tbody = el('tbody', '');
  tbody.append(...rows);
  t.append(thead, tbody);
  return t;
};
const tr = (...cells) => { const row = el('tr', ''); row.append(...cells.map(c => { const td = el('td', ''); td.append(c); return td; })); return row; };
// A section of the detail: the insight card's (heading over a bullet list or a table), so it reads like the other result cards.
const section = (title, ...children) => { const box = el('section', 'insight-section'); box.append(el('h4', '', title), ...children); return box; };
const list = items => { const ul = el('ul', 'insight-evidence'); ul.append(...items.map(text => el('li', '', text))); return ul; };
const numbers = pairs => numberStrip(pairs.map(([label, value]) => ({label, value})));

function listView() {
  const box = el('div', 'ff-list');
  const bar = el('div', 'toolbar');
  const search = el('label', 'search-box');
  const input = Object.assign(document.createElement('input'), {type: 'search', placeholder: t('pagesFocusReports.searchFills'), value: state.text});
  input.setAttribute('aria-label', t('pagesFocusReports.searchFills'));
  search.append(icon('search'), input);
  const outcomes = [...new Set((state.runs || []).map(run => summary(run).outcome))].sort();
  const select = document.createElement('select');
  select.setAttribute('aria-label', t('pagesFocusReports.outcome'));
  select.append(Object.assign(el('option', '', t('pagesFocusReports.allOutcomes')), {value: ''}), ...outcomes.map(o => Object.assign(el('option', '', o), {value: o})));
  select.value = state.outcome;
  bar.append(search, select);
  const shown = filterRuns(state.runs, state);
  const rows = shown.map(run => {
    const s = summary(run);
    const name = el('div', '');
    const open = Object.assign(el('button', 'link', s.title), {type: 'button', title: t('pagesFocusReports.openFill')});
    open.addEventListener('click', () => { state.open = run.id; draw(); });
    name.append(open);
    if (s.company) name.append(el('div', 'muted small', s.company));
    const row = tr(el('span', 'muted', s.at ? runWhen(s.at) : ''), name, el('span', '', s.agent), pill(s.outcome, s.tone, {dot: true}),
      el('span', '', s.fields === null ? '–' : `${s.fields}${s.left ? ` · ${s.left} left` : ''}`), el('span', 'muted', s.minutes === null ? '–' : `${s.minutes} min`));
    row.dataset.id = run.id;
    return row;
  });
  const keep = () => { const at = input.selectionStart; draw(); const again = host.querySelector('input[type=search]'); again?.focus(); again?.setSelectionRange(at, at); };
  input.addEventListener('input', () => { state.text = input.value; keep(); });
  select.addEventListener('change', () => { state.outcome = select.value; draw(); });
  box.append(el('p', 'muted small', listLine(state.runs, shown)), bar);   // the tab's meta line, as Weekly's
  if (rows.length) box.append(table([t('pagesFieldsStatus.when'), t('pagesFieldsStatus.job'), t('pagesFieldsStatus.by'), t('pagesFocusReports.outcome'), t('pagesFieldsStatus.fields'), t('pagesFieldsStatus.time')], rows));
  else box.append(el('p', 'empty', state.runs.length ? t('pagesFocusReports.noFillFilter')
    : t('pagesReadyReports.noFills')));
  return box;
}

function detailView(run) {
  const s = summary(run), box = el('div', 'insight-card is-flat');
  box.dataset.id = run.id;
  const back = Object.assign(el('button', 'link', t('pagesFocusReports.allFills')), {type: 'button'});
  back.addEventListener('click', () => { state.open = null; draw(); });
  const head = cardHead(`${s.agent}${s.at ? ` · ${runWhen(s.at)}` : ''}`, `${s.title}${s.company ? ` · ${s.company}` : ''}`,
    {badges: [pill(s.outcome, s.tone, {dot: true})], subtitles: [[run.fields?.billed_to, run.fields?.reason].filter(Boolean).join(' · ')]});
  if (run.url) {
    const open = Object.assign(el('button', 'link small', t('pagesSession.openForm')), {type: 'button', title: run.url});
    open.addEventListener('click', () => window.pilot.openExternal(run.url));
    const line = el('div', ''); line.append(open);
    head.append(line);
  }
  const backLine = el('div', ''); backLine.append(back);   // a line of its own: a grid cell would stretch the button
  box.append(backLine, head);
  const figures = [s.minutes !== null && [t('pagesFieldsStatus.time'), `${s.minutes} min`], s.fields !== null && [t('pagesFieldsStatus.fields'), String(s.fields)],
    s.fields !== null && [t('pagesFieldsStatus.requiredLeft'), String(s.left || 0)], ...sessionNumbers(run)].filter(Boolean);
  if (figures.length) box.append(numbers(figures));
  const fields = fieldRows(run);
  if (fields.length) {
    box.append(section(t('pagesFieldsStatus.fieldByField'), table([t('pagesFieldsStatus.field'), t('pagesFieldsStatus.required'), t('pagesFieldsStatus.answerFrom'), t('pagesFieldsStatus.result'), t('pagesCommon.note')], fields.map(row => {
      const note = el('span', 'muted', row.note);
      return tr(el('b', '', row.label), el('span', '', row.required), el('span', '', row.source),
        pill(row.result === 'filled' ? t('pagesFocusReports.filled') : t('pagesFocusReports.left'), row.result === 'filled' ? 'good' : 'warn'),
        row.low ? (() => { const cell = el('span', ''); cell.append(pill(t('pagesCommon.check'), 'warn'), ' ', note); return cell; })() : note);
    }))));
  }
  if (leftForYou(run).length) box.append(section(t('pagesFieldsStatus.leftYou'), list(leftForYou(run))));
  if (attachments(run).length) box.append(section(t('pagesFieldsStatus.attached'), list(attachments(run))));
  if (learnings(run).length) box.append(section(t('pagesFieldsStatus.learnings'), list(learnings(run))));
  if (steps(run).length) box.append(section(t('pagesFieldsStatus.steps'), table([t('pagesFieldsStatus.step'), t('pagesFieldsStatus.took')], steps(run).map(step => tr(el('span', '', step.step), el('span', 'muted', `${step.seconds} s`))))));
  if (timeline(run).length) box.append(section(t('pagesFieldsStatus.sessionTimeline'), el('p', 'insight-source', timeline(run).join(' → '))));
  if (!fields.length && !isSession(run)) box.append(el('p', 'insight-source', t('pagesReadyReports.noFieldRecord')));
  return box;
}

function draw() {
  if (!host) return;
  if (!state.runs) {
    host.replaceChildren(el('p', 'muted', `Loading your form fills from ${storeName()}…`));
    return;
  }
  const run = state.open && state.runs.find(item => item.id === state.open);
  host.replaceChildren(run ? detailView(run) : listView());
}

/** Opens one fill's detail on the next draw of the tab (What we learned's evidence chips: pages/form-fill-link.js). */
export function openFill(id) { state.open = id || null; }

// Mount point for the Reports page: draws into `container` (a plain div in its card) and refreshes; safe to call again.
export async function renderFormFills(container) {
  host = container;
  draw();
  const answer = await withTimeout(window.pilot.formFills(), READ_TIMEOUT_MS);
  if (host !== container) return;
  if (answer?.error) {
    const retry = Object.assign(el('button', 'link', t('pagesCommon.retry')), {type: 'button'});
    retry.addEventListener('click', () => renderFormFills(container));
    host.replaceChildren(el('p', 'message error', `Could not read your form fills from ${storeName()}: ${plainError(answer.error)}`),
      el('p', 'muted small', byStore(t('pagesReadyReports.fillsNotion'), t('pagesReadyReports.fillsLocal'))), retry);
    return;
  }
  state.runs = answer?.runs || [];
  if (state.open && !state.runs.some(run => run.id === state.open)) state.open = null;
  draw();
}
