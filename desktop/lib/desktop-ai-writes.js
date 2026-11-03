// What the desktop AI may change, and how: answer a What we learned question, dismiss a question, undo one of its own changes. Spec: docs/superpowers/specs/2026-11-03-desktop-ai-mcp-design.md ("Trust").
// Invariants: the AI answers only questions in the list the app itself loaded (renderer `questions` registry entry), never one the person confirmed; the same pure rules as the drawer
// (renderer/question-sense.js, question-values.js) refuse a label saved as a value, an empty answer or a value its field cannot read; the save is lib/question-answer.js (the drawer's) with no AI call;
// every accepted change is recorded (lib/desktop-ai-changes.js) with what was there before; Undo never overwrites what the person changed since.
// Why (3 Nov 2026, mac-07): the AI client is already the AI, so it may pick where a free answer lives (`home`), validated against the places the app itself chooses from.
import {hasLabel, labelAsValue} from '../renderer/question-sense.js';
import {needsCheck} from '../renderer/question-values.js';
import {withState} from '../renderer/answers-model.js';
import * as sections from './profile-sections.js';
import {answerKey} from './question-answer.js';
import {isDetailsKey} from './details-review.js';
import * as questions from './questions.js';
import * as dismissed from './question-dismissed.js';
import * as changes from './desktop-ai-changes.js';

const MAX_ANSWER = 1900;   // the answers page's cell limit (lib/questions.js answer)
const OPEN_REVIEW = 'The app has not read the questions yet. Open the Profile once so it loads them, then ask again.';
const refuse = error => ({error});
const same = text => String(text ?? '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const STALE = 'That question changed since the app listed it. Read the open questions again.';
// Why (3 Nov 2026): a refusal the AI cannot act on makes it retry; these are the forms renderer/question-values.js canonical() reads (guarded by test/desktop-ai-writes.test.js).
const EXAMPLES = {salary: '120000 CHF/year gross', duration: '3 months', range: '40–60 %', language: 'B2', link: 'https://example.com/me'};

/** Why `value` may not be the answer to `item` (a registry `questions` row), or '' when it may. Pure; the same rules the drawer shows the person. */
export function checkAnswer(item, value) {
  const text = String(value ?? '').trim();
  if (!text) return 'Give an answer. To leave a question unanswered, dismiss it instead.';
  if (text.length > MAX_ANSWER) return `That answer is longer than ${MAX_ANSWER} characters.`;
  if (!hasLabel(item.question)) return 'That line names no question, so there is nothing to answer.';
  if (labelAsValue(item.question, text)) return 'That is the field\'s own label, not an answer. Give the actual answer.';
  if (item.options?.length && !item.options.some(option => option.toLowerCase() === text.toLowerCase())) return `Pick one of: ${item.options.join(' | ')}.`;
  if (needsCheck(item.kind, text)) return `That does not read as ${item.kind}${EXAMPLES[item.kind] ? `. Write it like: ${EXAMPLES[item.kind]}` : '. Write it the way the question asks'}.`;
  return '';
}

// A learning the person confirmed is theirs (spec "Trust" 4, decision D3); a "two answers" line, or an item that is a decision about an existing line (a review kind), waits for their pick.
const confirmedOrContested = item => Boolean(item.review) || item.state === 'conflict' || Boolean(item.value && !item.state);

// Why (3 Nov 2026, review of 3/6): on this Mac a key is a line number, so any write that removes a line moves every later key; the window's list can be 10 minutes old. The key must still be
// that very question in the store, else a write would answer or hide its neighbour. The window cuts a question at 200 characters, hence the prefix match.
async function stillThere(deps, item) {
  if (isDetailsKey(item.key)) return true;
  const now = (await questions.list(deps.storage)).find(each => each.key === item.key), a = same(now?.question), b = same(item.question);
  return Boolean(now && a && b && (a.startsWith(b) || b.startsWith(a)));
}

async function find(deps, key, list) {
  const read = await deps.queue();
  if (!read) return {refusal: OPEN_REVIEW};
  const item = read.questions.find(each => each.key === key);
  if (!item) return {refusal: 'That question is no longer open. Read the open questions again.'};
  if (item.list !== list) return {refusal: list === 'learned' ? 'That is a Your details item; this tool answers What we learned questions.' : 'That is a What we learned question, not a Your details item.'};
  return {item};
}

const isText = value => typeof value === 'string';

/**
 * answer_question {key, value, home?}: saves `value` as the answer to a What we learned question. The saved line is marked New (the person confirms or changes it); with `home`, a Your details section the
 * AI chose, it is written there like any answer the app routes. -> {data} | {error}.
 */
export async function answerQuestion(deps, {key, value, home = ''} = {}) {
  const capped = changes.allowWrite(deps.calls, deps.now?.());
  if (!capped.ok) return refuse(capped.error);
  if (!isText(key) || !isText(value) || !isText(home)) return refuse('key, value and home must each be text.');
  const {item, refusal} = await find(deps, key, 'learned');
  if (refusal) return refuse(refusal);
  if (confirmedOrContested(item)) return refuse('The person already confirmed this answer (or it has two answers waiting for them). Ask them; do not change it.');
  const why = checkAnswer(item, value);
  if (why) return refuse(why);
  if (home && !Object.hasOwn(sections.SECTIONS, home)) return refuse(`Unknown place "${home}". Use one of: ${Object.keys(sections.SECTIONS).join(', ')}, or leave it out.`);
  if (!await stillThere(deps, item)) return refuse(STALE);
  const text = value.trim();
  // Why (3 Nov 2026, review of 3/6): a line of Your details with this label is the person's (or confirmed); the drawer's own save replaces it because "you just typed it", which is not true of the AI.
  if (home && ((await sections.read(deps.storage))[home] || []).some(line => same(line.label) === same(item.question))) return refuse(`Your details already has "${item.question}". Ask the person; do not change it.`);
  const before = home ? '' : await questions.rawOf(deps.storage, item.key);
  // Why (3 Nov 2026, review of 3/6): no mark of its own: the cut-down row the window sends lacks the list and constraints the drawer's mark keeps, and the mark is stored for good (Undo does not remove it).
  const saved = await answerKey(deps.storage, item.key, home ? text : withState(text, 'new'), {home, ai: {}, mark: null});
  if (!saved.ok) return refuse(saved.error || 'It did not save; nothing changed.');
  const after = home ? text : await questions.rawOf(deps.storage, item.key);
  const entry = changes.record(deps.storage, {tool: 'answer_question', target: item.key, question: item.question, before, after,
    undo: home ? 'It moved to Your details; change it there.' : ''}, new Date(deps.now?.() ?? Date.now()));
  return {data: {saved: true, changeId: entry.id, where: saved.homeName || 'What we learned',
    note: home ? 'Saved into Your details. The person can review it there.' : 'Saved as New. The person confirms or changes it in Jobadabra.'}};
}

/** dismiss_question {key}: hides a question ("not for me"). Nothing is deleted; the person can bring it back. -> {data} | {error}. */
export async function dismissQuestion(deps, {key} = {}) {
  const capped = changes.allowWrite(deps.calls, deps.now?.());
  if (!capped.ok) return refuse(capped.error);
  const read = await deps.queue();
  if (!read) return refuse(OPEN_REVIEW);
  if (!isText(key)) return refuse('key must be text.');
  const item = read.questions.find(each => each.key === key);
  if (!item) return refuse('That question is no longer open. Read the open questions again.');
  if (!await stillThere(deps, item)) return refuse(STALE);
  dismissed.dismiss(deps.storage, item.key, item.question);
  const entry = changes.record(deps.storage, {tool: 'dismiss_question', target: item.key, question: item.question, before: '', after: 'dismissed'}, new Date(deps.now?.() ?? Date.now()));
  return {data: {dismissed: true, changeId: entry.id, note: 'Hidden. The person can bring it back in Jobadabra.'}};
}

/** Undoes one recorded change by its id (the person's button, 4/6). Refuses when the person changed the value since. -> {ok: true} | {ok: false, error}. */
export async function undoChange(deps, id) {
  const entry = changes.find(deps.storage, id);
  if (!entry) return {ok: false, error: 'That change is not in the list.'};
  if (entry.undoneAt) return {ok: false, error: 'That change was already undone.'};
  if (entry.undo) return {ok: false, error: entry.undo};
  if (entry.tool === 'dismiss_question' && !dismissed.isDismissedAs(deps.storage, entry.target, entry.question)) return {ok: false, error: 'You changed this since, so nothing was undone.'};
  const done = entry.tool === 'dismiss_question' ? dismissed.bringBack(deps.storage, entry.target) : await questions.restore(deps.storage, entry.target, {was: entry.before, now: entry.after, question: entry.question});
  if (done.ok) changes.markUndone(deps.storage, id, new Date(deps.now?.() ?? Date.now()));
  return done;
}
