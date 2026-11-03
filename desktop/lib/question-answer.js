// The one save of a question's answer: the drawer's "Save" (ipc answerQuestion, lib/apply-handlers.js) and the desktop AI's answer_question / update_detail (lib/desktop-ai-writes.js) both call it,
// so an answer goes to the same place by the same code whoever gives it. Invariant: it validates nothing (the drawer checks in the window, the desktop AI in lib/desktop-ai-writes.js checkAnswer).
// Why (3 Nov 2026, desktop AI MCP spec "Trust" 1, mac-07): one mechanism across both ways of answering; `ai` is the engine that may decide where a free answer lives (it spends credit), `home` is
// a place already decided (by the person's AI client), so no credit is spent and the answer routes the same way.
import * as questions from './questions.js';
import * as detailsReview from './details-review.js';

/**
 * Saves `value` as the answer to the queue item `key` (a Your details item's key, or an answers-page row). mark: the kind the window drew it with; also: the other wordings' keys, which get
 * the same answer; ai: {client, apiKey} for the home decision; home: a Your details section id chosen by the caller (wins over ai; What we learned items only).
 * -> {ok, homeName?} | {ok: false, error}. Throws what the store throws (the caller words it).
 */
export function answerKey(storage, key, value, {mark = null, also = [], ai = {}, home = ''} = {}) {
  if (detailsReview.isDetailsKey(key)) return detailsReview.answer(storage, String(key), String(value ?? ''), {ai});   // `home` is for What we learned only: a Your details item has its own place (update_detail waits for JOB-249)
  return questions.answerAll(storage, [key, ...also], value, undefined, mark, {ai, home});
}
