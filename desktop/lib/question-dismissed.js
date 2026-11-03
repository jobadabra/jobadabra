// The questions the person dismissed from a drawer (owner, 2 Nov 2026: "we don't have an option to dismiss a question"): ONE state, settings.dismissedQuestions
// {[question key]: {question, at}}, read by the one list builder (lib/question-lists.js openShown), so a dismissed question leaves both drawers, their counts and
// Focus together, and comes back with "Bring back" from the drawer's Dismissed group. Dismissing changes nothing in the store: no line is removed or blanked.
// Why (2 Nov 2026, owner): this replaces "Don't keep an answer for this", which blanked the line, saved an empty answer or filled a per-kind "never" list.
// Guarded by test/question-dismissed.test.js.
import {keyOf} from '../renderer/question-filter.js';

const SETTING = 'dismissedQuestions';
const all = storage => storage.settings()[SETTING] || {};

/** Whether this question key is dismissed (settings.dismissedQuestions, own keys only). */
export const isDismissed = (storage, key) => Object.hasOwn(all(storage), key);

/** Dismisses the question with this key (its words kept for the list). */
export function dismiss(storage, key, question, now = new Date()) {
  if (!key) return {ok: false, error: 'That question is no longer open'};
  storage.saveSettings({[SETTING]: {...all(storage), [key]: {question: String(question || '').slice(0, 200), at: now.toISOString()}}});
  return {ok: true};
}

/** Brings a dismissed question back. */
export function bringBack(storage, key) {
  const {[key]: gone, ...rest} = all(storage);
  if (gone) storage.saveSettings({[SETTING]: rest});
  return {ok: true};
}

/** items -> {shown, dismissed}: the dismissed ones marked `dismissed: true` for the drawer's Dismissed group. */
export function split(storage, items) {
  const known = all(storage);
  const gone = item => Object.hasOwn(known, item.key);
  return {shown: items.filter(item => !gone(item)), dismissed: items.filter(gone).map(item => ({...item, dismissed: true}))};
}

/** The dismissed questions' words as lib key forms, for a list that has no item keys (a session's "what it needs" list). */
export const wordsKeys = storage => new Set(Object.values(all(storage)).map(entry => keyOf(entry.question)));
