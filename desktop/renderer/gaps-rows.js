// The Profile's Possible CV gaps as a review list (owner review fix 6, mockup 06, 18 Oct 2026), in Profile → Experience: each skill to verify is a row with
// Confirm skill (the CV and the fill read it as a skill) and Dismiss (kept, so it is not asked again); reviewed ones fold under "Reviewed · N", each with Undo.
// The card's own words (GAPS_LEAD, in its header) say what the list is; the Profile's other lines under the heading are shown as notes, apart from the decisions. No reason or source
// column: the store keeps only the skill and its state (owner, 18 Oct 2026: no invented evidence). Lines of the part are the model's (gaps-model.js).
// Guarded by test/unit/renderer/gaps-rows.test.js.
import '../i18n/screens-helpers.js';
import {t} from '../i18n/index.js';
import {el, pill} from './components.js';
import {icon} from './icons.js';
import {readLines} from './gaps-model.js';

const button = (label, className, aria, onClick) => {
  const node = Object.assign(el('button', className, label), {type: 'button'});
  node.setAttribute('aria-label', aria);
  node.addEventListener('click', event => { event.preventDefault(); onClick(); });
  return node;
};
export const pendingCount = part => readLines(part?.lines || []).items.filter(item => item.state === 'check').length;
const WORD = {skill: t('helperProfile.confirmed'), dropped: t('helperProfile.dismissed')};
// What the list is, in the card's own words: the card's header line (pages/experience-profile.js), never a lone line above the rows.
export const GAPS_LEAD = t('helperProfile.gapsLead');
// A fold under the rows: "Reviewed · N" and "Notes in your Profile · N" share it (chevron, bold title, a muted line of what it holds).
function foldOf(title, line, body) {
  const fold = el('details', 'gap-fold'), head = el('summary');
  head.append(icon('chevron', 'icon gap-chevron'), el('b', '', title), ...(line ? [el('span', 'muted small', line)] : []));
  fold.append(head, body);
  return fold;
}

// part: {lines}; onPress(item, state): Confirm skill (skill), Dismiss (dropped) or Undo (check).
export function gapsBody(part, onPress, {tidied = null, onUndo = null} = {}) {
  const box = el('div', 'exp-part-body gap-rows'), read = readLines(part?.lines || []);
  if (!read.items.length && !read.other.length) { box.append(el('p', 'muted', t('helperProfile.notSetYet'))); return box; }
  const pending = read.items.filter(item => item.state === 'check'), reviewed = read.items.filter(item => item.state !== 'check');
  if (pending.length) {
    const list = el('div', 'gap-list');
    list.append(...pending.map(item => {
      const row = el('div', 'gap-row');
      row.dataset.gap = item.item;
      const name = el('div', 'gap-name');
      name.append(el('b', '', item.item), pill(t('helperProfile.toCheck'), 'warn'));
      row.append(name, button(t('helperProfile.confirmSkill'), 'secondary small-btn', t('helperProfile.confirmSkillLabel', {skill: item.item}), () => onPress(item, 'skill')),
        button(t('helperState.dismiss'), 'link', t('helperProfile.dismissLabel', {skill: item.item}), () => onPress(item, 'dropped')));
      return row;
    }));
    box.append(list);
  } else if (read.items.length) box.append(el('p', 'muted small', t('helperProfile.allReviewed')));
  if (reviewed.length) {
    const list = el('div', 'gap-list');
    list.append(...reviewed.map(item => {
      const row = el('div', 'gap-row');
      row.dataset.gap = item.item;
      const name = el('div', 'gap-name');
      name.append(el('b', '', item.item), pill(item.state === 'skill' ? t('helperProfile.confirmedSkill') : t('helpers.stageDismissed'), item.state === 'skill' ? 'good' : 'neutral'));
      row.append(name, button(t('helpers.undo'), 'link', t('helperProfile.putBack', {skill: item.item}), () => onPress(item, 'check')));
      return row;
    }));
    box.append(foldOf(t('helperProfile.reviewedCount', {count: reviewed.length}), reviewed.map(item => `${item.item} ${WORD[item.state]}`).join(' · '), list));
  }
  if (read.other.length) {   // the Profile's own lines under this heading: shown as notes, never as a decision
    const notes = el('div', 'gap-notes');
    notes.append(...read.other.map(other => el('p', 'muted small', other.text)));
    box.append(foldOf(t('helperProfile.profileNotes', {count: read.other.length}), '', notes));
  }
  if (tidied && onUndo) {   // the one-time split of the paragraph: said once, with its Undo (the pages before it are backed up)
    const line = el('p', 'muted small', t('helperProfile.splitParagraph', {count: tidied.changed}));
    line.append(button(t('helpers.undo'), 'link', t('helperProfile.putGapsBack'), onUndo));
    box.append(line);
  }
  return box;
}
