// Parse batched decide requests and validate per-item answers without guessing identity.
// Job: serve stored answers
// Invariants: keys retain exact context/text; ambiguous layouts refuse; invalid batches record nothing.
import {canonical, hash as sha, object, replyData, textOf} from './ai-answers-engine-items.mjs';

const unkeyable = reason => ({unkeyable: `decide: ${reason}`});

/** The engine's answer schema for `count` items (src/ai/decide.py answer_shape): one required property per item number, one allowed answer each. */
export const decideSchema = (allowed, count) => ({type: 'object', additionalProperties: false, required: Array.from({length: count}, (_, n) => String(n)),
  properties: Object.fromEntries(Array.from({length: count}, (_, n) => [String(n), {type: 'string', enum: [...allowed]}]))});

/** Parse only the engine's decide layout; item text and context retain their exact bytes. */
export function decideQuestion(body, persona) {
  if (!object(body)) return unkeyable('expected a request object');
  if (!textOf(body.system ?? body.instructions).startsWith('You decide what short pieces of content mean')) return unkeyable('missing recognised system prefix');
  const messages = body.messages ?? body.input;
  if (!Array.isArray(messages) || messages.length !== 1 || messages[0]?.role !== 'user') return unkeyable('expected one user message');
  const match = /^Task: ([\s\S]+)\nAllowed answers: ([^\n]+)\n\n([\s\S]+)$/.exec(textOf(messages[0].content));
  if (!match || !match[1].trim()) return unkeyable('expected Task, Allowed answers and item blocks');
  const [, task, allowedAnswers, blocks] = match, schema = body.output_config?.format?.schema ?? body.text?.format?.schema;
  const allowed = allowedAnswers.split(', '), markers = [...blocks.matchAll(/^### Item [^\n]*(?:\n|$)/gm)];
  if (!object(schema) || !allowed.every(value => value.trim()) || new Set(allowed).size !== allowed.length ||
      canonical(schema) !== canonical(decideSchema(allowed, markers.length))) return unkeyable('missing schema or inconsistent allowed answers');
  // Why (12 Nov 2026, am): the schema names one property per item, so it follows the batch size; an item's identity is its task and choices, never how many neighbours it was asked with.
  const context = {task, allowedAnswers, schema}, contextSHA = sha(canonical({task, allowedAnswers}));
  // Why (#2450 slice 3): accept only batches the engine can actually send, rather than keying malformed asks.
  if (!markers.length || markers.length > 50 || markers[0].index !== 0) return unkeyable('expected 1 to 50 item blocks');
  const items = [];
  for (const [index, marker] of markers.entries()) {
    // Why (#2450 slice 3): the engine never escapes delimiters, so malformed or embedded markers must refuse rather than guess an item boundary.
    if (marker[0] !== `### Item ${index}\n` || (index && blocks.slice(marker.index - 2, marker.index) !== '\n\n')) return unkeyable('ambiguous item delimiter or non-consecutive indexes');
    const text = blocks.slice(marker.index + marker[0].length, index + 1 < markers.length ? markers[index + 1].index - 2 : blocks.length);
    if (Array.from(text).length > 600) return unkeyable('item exceeds the engine text limit');
    // Why (#2450 slice 3): identical words can mean different things across tasks and personas; batch positions and neighbours never identify an item.
    items.push({index, text, key: `${persona || 'default'}/${contextSHA}/${sha(text)}`});
  }
  return {operation: 'app.decide', context, items};
}

/** Return every validated item candidate, or none; index order in a live reply is immaterial. */
export function decideCandidates(question, reply) {
  const data = replyData(reply);
  const allowed = question.context.allowedAnswers.split(', ');
  // Why (#2450 slice 3): a partial or out-of-contract live answer must never leave even one review candidate.
  if (!object(data) || Object.keys(data).length !== question.items.length || !question.items.every(item => allowed.includes(data[item.index]))) return [];
  return question.items.map(item => ({...item, answer: data[item.index]}));
}

/** Give each item a filesystem-safe candidate name covering persona, context and text. */
export const itemCandidateName = key => `ai-answers-item-${sha(key)}.json`;
