// The AI's word on each saved answer (owner, 18 Oct 2026: "an automatic/intelligent way to put them on the queue"): clear, guess, vague or off_topic, a fixed
// answer of the move's judge call (lib/profile-move.js judge). Kept per line in settings.answerClarity as {[label\nvalue]: verdict}, so a line is judged once
// and judged again only when its value changes; "kept" = the person said "Keep as is" (never asked again for that value). A line with no verdict (the AI
// skipped it) is retried after a day. lib/details-review.js turns guess / vague / off_topic into queue items. Guarded by test/unit/main/details-review-unclear.test.js.
import {parseLine} from './profile-sections.js';

export const CLARITY = ['clear', 'guess', 'vague', 'off_topic', 'prose'];   // prose: running text (a letter's line), no answer to ask, no fact to move (3 Nov 2026)
export const UNCLEAR = {guess: 'Looks like a guess', vague: 'Too vague to use', off_topic: 'Does not answer the question'};
export const KEPT = 'kept';
const RETRY_MS = 24 * 3600 * 1000;
// Why (3 Nov 2026, a Windows tester: a pasted letter judged 82 lines, 81 unclear): the judge's rubric gained "prose". An install whose verdicts were written under an older rubric
// asks again, once, for the lines it called unclear (a clear line stays clear); settings.answerClarityRubric says which rubric wrote them. Raise it when the judge's words change.
export const RUBRIC = 2;
const same = text => String(text || '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

// A line's identity: its label and value without the kind mark and note (the same on the Profile, the answers page and in a section after a move).
export function sigOf(item) {
  const parsed = parseLine(item.label ? `${item.label}: ${item.value}` : `: ${item.value}`);
  return `${same(item.label)}\n${same(parsed.value || item.value)}`;
}
const map = storage => storage.settings().answerClarity || {};
export const verdictOf = (storage, item) => map(storage)[sigOf(item)] || '';

// The lines with no verdict yet (or a skipped one a day old).
export function unjudged(storage, items, now = new Date()) {
  const known = map(storage), older = storage.settings().answerClarityRubric !== RUBRIC;
  return items.filter(item => {
    const verdict = known[sigOf(item)];
    return !verdict || (verdict.startsWith('?') && now - new Date(verdict.slice(1)) > RETRY_MS) || (older && Boolean(UNCLEAR[verdict]));
  });
}

// The judge's verdicts kept (judged: Map(id -> {clarity})); a "Keep as is" is never overwritten. Lines gone from the pages are forgotten (pass all of today's lines).
// A line the judge did not answer keeps an earlier unclear verdict (a failed call never empties the queue); `rubric: true` (the pass that judges every unclear line again,
// lib/profile-routing.js) stamps settings.answerClarityRubric only when each of them got its new word, else the next pass asks again (3 Nov 2026).
export function record(storage, items, judged, {now = new Date(), present = null, rubric = false} = {}) {
  const known = {...map(storage)};
  let unanswered = 0;
  for (const item of items) {
    const sig = sigOf(item), clarity = judged.get(item.id)?.clarity;
    if (known[sig] === KEPT) continue;
    if (CLARITY.includes(clarity)) known[sig] = clarity;
    else if (UNCLEAR[known[sig]]) unanswered++;
    else known[sig] = `?${now.toISOString()}`;
  }
  if (present) { const live = new Set(present.map(sigOf)); for (const sig of Object.keys(known)) if (!live.has(sig)) delete known[sig]; }
  storage.saveSettings({answerClarity: known, ...(rubric && items.length && !unanswered ? {answerClarityRubric: RUBRIC} : {})});
}

export function keepAsIs(storage, item) {
  storage.saveSettings({answerClarity: {...map(storage), [sigOf(item)]: KEPT}});
}
