// The editors of Profile → Experience's cards (owner review fix 6 and decisions 3, 18 Oct 2026; mockup 09), drawn in place by pages/experience-profile.js
// and saved by the Profile's one save bar (no Save/Cancel here). Each returns {node, changes()}: changes() are the block edits for the card's part
// (experience-profile-model.js changesFor), none when nothing changed. Professional summary: a box that grows per paragraph. Strengths: a group per
// "Label:" line with its values as chips (× and "Add, then Enter"), a line with no label as its words, + Add a group (strengths-model.js). Education:
// Degree / qualification · School · Years per entry, + Add education and Remove entry; a line not in that shape stays as written until the person
// chooses Organize into fields (education-model.js); a table's rows stay cells; notes in brackets are kept and shown. Any other section: a field per
// line and per cell, + Add a line. Guarded by test/unit/renderer/experience-editors.test.js.
import '../i18n/screens-helpers.js';
import {t} from '../i18n/index.js';
import {el} from './components.js';
import {editRows} from './card-shell.js';
import {chipsInput, longText} from './edit-controls.js';
import {changesFor, isNote, shownText, unset} from './experience-profile-model.js';
import * as education from './education-model.js';
import * as strengths from './strengths-model.js';

const field = (value, label, placeholder = '', onChange = () => {}) => {
  const input = Object.assign(el('input', ''), {type: 'text', value, placeholder});
  input.setAttribute('aria-label', label);
  input.addEventListener('input', () => onChange());
  return input;
};
const quiet = (label, className, onClick) => {
  const button = Object.assign(el('button', className, label), {type: 'button'});
  button.addEventListener('click', event => { event?.preventDefault?.(); onClick(); });
  return button;
};
// A table's rows (Education as School | Degree | Discipline): one field per cell, an unset cell left as it was when still empty.
function cellRows(part, title, onChange) {
  const rows = (part?.rows || []).map(row => {
    const cells = el('div', 'exp-part-row');
    cells.append(...row.cells.map((cell, index) => field(unset(cell) ? '' : cell, `${title} ${index + 1}`, '', onChange)));
    return cells;
  });
  const read = () => rows.map((row, i) => [...row.querySelectorAll('input')].map((input, index) => (input.value.trim() === '' && unset(part.rows[i].cells[index]) ? part.rows[i].cells[index] : input.value)));
  return {rows, read};
}
const notesOf = part => (part?.lines || []).filter(line => isNote(line.text)).map(line => el('p', 'muted small', shownText(line.text).replace(/^\(|\)$/g, '')));

export function summaryEditor(part, {onChange}) {
  const node = el('div', 'exp-part-lines'), lines = part?.lines.length ? part.lines : [{text: ''}];
  const boxes = lines.map(line => longText(shownText(line.text), t('helperMore.professionalSummary'), t('helperMore.summaryHint'), onChange, {least: 2}));
  node.append(...boxes);
  const texts = () => boxes.map((box, i) => (part?.lines[i] && box.value.trim() === shownText(part.lines[i].text) ? part.lines[i].text : box.value));
  return {node, changes: () => changesFor('summary', part, texts())};
}

export function strengthsEditor(part, {onChange}) {
  const node = el('div', 'exp-part-lines strengths-edit'), list = el('div', 'strength-groups');
  const drafts = strengths.draftsOf(part);
  const group = draft => {
    const row = el('div', 'strength-group');
    if (draft.plain !== undefined) {
      row.classList.add('is-plain');
      row.append(field(draft.plain, t('helperMore.strength'), '', () => { draft.plain = row.querySelector('input').value; onChange(); }));
      return row;
    }
    const name = field(draft.label, t('helperMore.groupName'), t('helperMore.groupExample'), () => { draft.label = name.value; onChange(); });
    const chips = chipsInput(draft.items, {placeholder: t('helpers.addEnter'), ariaLabel: t('helperMore.groupAddValue', {name: draft.label || t('helperMore.newGroup')}), split: strengths.typedItems,
      onChange: values => { draft.items = values; onChange(); }});
    row.append(name, chips.node);
    return row;
  };
  list.append(...drafts.map(group));
  const add = quiet(t('helperMore.addGroup'), 'link', () => { const draft = {index: null, label: '', items: []}; drafts.push(draft); list.append(group(draft)); });
  node.append(list, add);
  return {node, changes: () => changesFor('strengths', part, strengths.textsOf(part, drafts))};
}

export function educationEditor(part, {onChange}) {
  const node = el('div', 'exp-part-lines education-edit'), list = el('div', 'edu-entries');
  const drafts = education.entriesOf(part).map(entry => ({index: entry.index, text: entry.text, fields: entry.fields && {...entry.fields}}));
  const cells = cellRows(part, t('helperMore.educationLabel'), onChange);
  const entry = draft => {
    const box = el('div', 'edu-entry');
    const remove = quiet(t('helperMore.removeEntry'), 'link', () => { draft.removed = true; box.remove(); onChange(); });
    const draw = () => {
      if (!draft.fields) {   // a line not in Degree · School · Years: its words, never split by the app
        const words = field(shownText(draft.text || ''), t('helperMore.educationEntry'), '', () => { draft.text = words.value; onChange(); });
        const organize = quiet(t('helperMore.organizeFields'), 'secondary small-btn', () => { draft.fields = {degree: '', school: '', years: ''}; draw(); onChange(); });
        box.replaceChildren(editRows([{label: t('helperMore.asWritten'), control: words, hint: t('helperMore.asWrittenHint')}]), actions(organize, remove));
        return;
      }
      const input = (key, label, hint) => { const each = field(draft.fields[key], label, hint, () => { draft.fields[key] = each.value; onChange(); }); return each; };
      const rows = [{label: t('helperMore.degreeLabel'), control: input('degree', t('helperMore.degreeLabel'), t('helperMore.degreeExample'))},
        {label: t('helperMore.schoolLabel'), control: input('school', t('helperMore.schoolLabel'), t('helperMore.schoolExample'))},
        {label: t('helperMore.yearsLabel'), control: input('years', t('helperMore.yearsLabel'), t('helperMore.yearsExample'))}];
      const was = draft.index != null && !education.fieldsOf(draft.text || '') ? [el('p', 'muted small', t('helperMore.wasText', {text: shownText(draft.text)}))] : [];
      box.replaceChildren(...was, editRows(rows), actions(remove));
    };
    draw();
    return box;
  };
  const actions = (...buttons) => { const row = el('div', 'inline edu-actions'); row.append(...buttons); return row; };
  list.append(...cells.rows, ...drafts.map(entry));
  const add = quiet(t('helperMore.addEducation'), 'link', () => { const draft = {index: null, fields: {degree: '', school: '', years: ''}}; drafts.push(draft); list.append(entry(draft)); });
  node.append(list, ...notesOf(part), add);
  return {node, changes: () => changesFor('education', part, education.textsOf(part, drafts), cells.read())};
}

// Any section the app does not know: one field per line (a paragraph or a bullet), one per table cell, + Add a line.
export function linesEditor(key, title, part, {onChange}) {
  const node = el('div', 'exp-part-lines'), list = el('div', 'exp-part-lines');
  const line = text => { const input = field(text.replace(/\*\*/g, ''), title, '', onChange); input.dataset.partLine = key; return input; };
  const cells = cellRows(part, title, onChange);
  list.append(...cells.rows, ...(part?.lines.length ? part.lines.map(each => line(each.text)) : cells.rows.length ? [] : [line('')]));
  node.append(list, quiet(t('helperMore.addLine'), 'link', () => list.append(line(''))));
  // A line whose words did not change keeps its own text (its bold, its list mark): only an edited line is rewritten.
  const texts = () => [...list.querySelectorAll('input[data-part-line]')].map((input, i) => {
    const was = part?.lines[i]?.text;
    return was !== undefined && input.value.trim() === was.replace(/\*\*/g, '').trim() ? was : input.value;
  });
  return {node, changes: () => changesFor(key, part, texts(), cells.read())};
}
