// One match of a check's required form questions against Your details and the standard answers (L2b of #3519): which "Simple form" can apply automatically and which needs the person's details first.
// Why (7 Nov 2026, owner: "Simple form, but can or not be applied automatically", then "B: match once per check"): the questions of every simple form in a check go to the AI's question judgment in ONE small call
// (lib/question-verdicts.js ensure, kept per question, so a question is never judged twice); the code then only compares the verdicts with what is saved. The AI decides what a question means; this file decides nothing about words.
import * as verdicts from './question-verdicts.js';
import * as questions from './questions.js';
import {claudeAi} from './question-ai.js';
import {factsOf} from './base-facts.js';
import {keyOf, looksLikeFieldId} from '../renderer/question-filter.js';
import {log as appLog} from './log.js';

/**
 * What stops a form from being applied automatically, from its required questions' verdicts. Pure.
 * A question never blocks when it is a consent or belongs to this one job (why this company, a cover letter: the apply step writes those), or when a saved answer covers it, or its Your details fact has a value.
 * A question of Your details with no value blocks as {kind: 'detail', label: <the fact>}; a reusable question nothing saved covers blocks as {kind: 'answer', label: <the question>}; one asking a private trait
 * (sensitive) only the person answers, so it blocks as {kind: 'answer'}. A question with no verdict (the AI is busy or off) is counted in `unjudged`, never guessed; a required box with no question text (only a field id) is counted in `unnamed`.
 * @param {string[]} labels the form's required questions
 * @param {Record<string, object>} judged verdicts by keyOf(label) (lib/question-verdicts.js)
 * @param {{label: string, value: string}[]} facts Your details (lib/base-facts.js)
 * @returns {{missing: {kind: 'detail'|'answer', label: string}[], unjudged: number, unnamed: number}}
 */
export function missingOf(labels, judged, facts) {
  const has = new Set(facts.filter(fact => String(fact.value ?? '').trim()).map(fact => fact.label));
  const missing = [];
  let unjudged = 0, unnamed = 0;
  const add = item => { if (!missing.some(each => each.kind === item.kind && each.label === item.label)) missing.push(item); };
  for (const label of labels) {
    if (looksLikeFieldId(label)) { unnamed += 1; continue; }   // a required box the page gave no question text (only its field id): it is never judged, so it has its own lasting state, not "busy AI"
    const verdict = judged[keyOf(label)];
    if (!verdict || !verdict.reuse) { unjudged += 1; continue; }
    if (verdict.sensitive === true) { add({kind: 'answer', label}); continue; }
    if (verdict.reuse === 'consent' || verdict.reuse === 'one_job' || verdict.covered_by) continue;
    if (verdict.reuse === 'details') { if (!has.has(verdict.fact)) add({kind: 'detail', label: verdict.fact || label}); continue; }
    add({kind: 'answer', label});
  }
  return {missing, unjudged, unnamed};
}

/**
 * The match of a whole check: `reads` = [{url, questions: string[]}] of its simple forms; returns {[url]: {missing, unjudged}}. One AI call for every question not judged before (nothing when the AI is off:
 * every question is then unjudged). Reads Your details and the standard answers once. Never throws: a failed read of either leaves that part empty, and a failed judgment is logged and leaves every question unjudged (the chip then says "answers not checked", never "can apply automatically").
 * `parts` = {ai, facts, answered, log} in a test.
 */
export async function matchReads(storage, reads, parts = {}) {
  const asked = reads.filter(read => Array.isArray(read.questions) && read.questions.length);
  if (!asked.length) return {};
  const ai = parts.ai || claudeAi(storage);
  const facts = parts.facts || await factsOf(storage).catch(() => []);
  const answered = parts.answered || await verdicts.answeredOf(storage, await questions.standardAnswers(storage).catch(() => [])).catch(() => []);
  const labels = [...new Set(asked.flatMap(read => read.questions))];
  const {verdicts: judged} = await verdicts.ensure(storage, labels, {answered, facts, ai}).catch(error => {   // a failed judgment leaves every question unjudged, which the chip says ("answers not checked"); the cause goes to app.log
    (parts.log || appLog)('apply', 'triage: the question judgment failed', {error: String(error?.message || error).slice(0, 300)});
    return {verdicts: {}};
  });
  return Object.fromEntries(asked.map(read => [read.url, missingOf(read.questions, judged, facts)]));
}
