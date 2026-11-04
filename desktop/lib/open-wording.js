// Words the review items that were asked by their bare field label ("Workload", "Notice period": owner, 2 Nov 2026, a Windows tester's drawer: "The questions could be
// just 'Workload'… Which doesn't make any sense"). ONE AI call through the queue's one question writer (lib/queue-wording.js) writes a real question and a short hint for
// each label (kept per label in settings.questionWords, so a label is worded once). Why (2 Nov 2026, owner): a question that cannot be worded is not shown, never shown
// as its label; the code only checks the reply's shape (not empty, not the label again). Items whose question is already worded (a learning, "which is right?", the
// contact and base-fact asks) pass untouched. Guarded by test/unit/main/details-review-sense.test.js and test/unit/renderer/question-sense.test.js (prompt-case set "question-words", tools/prompt-cases.json).
import {written} from './queue-wording.js';
import {isBareLabel} from '../renderer/question-sense.js';

export const KINDS = ['open', 'unclear', 'taught', 'conflict'];   // the kinds of lib/details-review.js that ask by the field's (or the learning's) own label
export const INSTRUCTIONS = `Each line of <fields> is "id: label", the name of a field of a job seeker's profile or of an application form, in any language, sometimes followed by — and a hint of what it holds.
For each id write the one question to ask the person to fill that field in: a full sentence in the label's language, naming what is asked and, when the hint tells, the options or format
("Workload — 100% only, or a range" → "What workload do you want: 100% only, or a range like 80–100%?"). Never answer with the label alone. A label that is already a full question keeps its words.
Also write hint: a few words of help, or "". A label that is not something a person can answer (a section title, the name of a part of a document, a heading) gets question "".`;

const SETTING = 'questionWords';
const idOf = item => `${String(item.details?.fact || item.question).trim().toLowerCase()}|${String(item.hint || '').trim().toLowerCase()}`;
// A label that already asks (a question mark of any script) keeps its words: no call, no loss without an AI.
const wordable = item => KINDS.includes(item.details?.kind) && isBareLabel(item.question, item.details.fact);

/**
 * items from lib/details-review.js pending(). -> the same list with each bare-label item asked by its worded question; one that could not be worded (no AI, a failed
 * call, "" for a heading, the label again) is left out. client: the AI engine; none = no new wording, the kept ones still apply.
 */
export async function worded(storage, items, {client = null} = {}) {
  const todo = items.filter(wordable);
  if (!todo.length) return items;
  const kept = {...(storage.settings()[SETTING] || {})};
  const missing = [...new Map(todo.filter(item => !(idOf(item) in kept)).map(item => [idOf(item), item])).values()];
  if (missing.length && client) {
    const fields = missing.map((item, index) => ({key: `f${index + 1}`, label: `${item.details.fact}${item.hint ? ` — ${item.hint}` : ''}`}));
    const list = await written(storage, {cache: 'questionWordsRun', sig: fields.map(each => each.label).sort().join('~'), system: INSTRUCTIONS, tag: 'fields', fields, client, action: 'question_words'});
    if (list) {   // a failed call is tried again at the next list; an answered one is final, a label the AI left out stays unworded (never shown as its label)
      for (const item of missing) kept[idOf(item)] = {question: ''};
      for (const each of list) {
        const item = missing[Number(each.field.slice(1)) - 1];
        if (item && !isBareLabel(each.question, item.details.fact)) kept[idOf(item)] = {question: each.question, hint: each.hint};
      }
      storage.saveSettings({[SETTING]: kept});
    }
  }
  return items.flatMap(item => {
    if (!wordable(item)) return [item];
    const words = kept[idOf(item)];
    return words?.question ? [{...item, question: words.question, hint: item.hint || words.hint || ''}] : [];
  });
}
