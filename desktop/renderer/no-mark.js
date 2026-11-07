// The one place that turns the store's "not answered yet" marker (a question-mark emoji in the Profile and answers pages) into words on screen: owner, 18 Oct 2026, never that character in the app. Guard: test/guards/rules/no-question-mark.test.js.
import '../i18n/screens-helpers.js';
import {t} from '../i18n/index.js';
import {el, pill} from './components.js';

const MARK = String.fromCodePoint(0x2753);
const ANY = new RegExp(`\\s*${MARK}\\s*`, 'g');

export const hasMark = text => String(text ?? '').includes(MARK);

// The words without the marker (Claude's messages, a line of a page).
export const withoutMark = text => String(text ?? '').replace(ANY, ' ').replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').trim();

// A value that is there but still to confirm, and one that is not given yet.
export const checkPill = () => pill(t('helpers.checkThis'), 'warn');
/** Build the neutral localized missing-answer pill; this does not create or modify an answer. */
export const notAnsweredPill = () => pill(t('helpers.notAnswered'), 'neutral');

// A line of text with each marker replaced by the "Not answered yet" pill: nodes to append.
export function withPills(text) {
  const nodes = [];
  String(text ?? '').split(new RegExp(`\\s*${MARK}\\s*`)).forEach((part, i) => {
    if (i) { nodes.push(' ', notAnsweredPill()); if (part) nodes.push(' '); }
    if (part) nodes.push(part);
  });
  return nodes.length ? nodes : [el('span', '', '')];
}
