// The second opinion on an AI user agent's note: a different call (the mid tier) reads the note and the screenshot COLD, without the agent's reasoning, and says whether the argument holds.
// Job: report health
// Why (3 Nov 2026, AI user agents 5/11; spec "Findings"): the note is filed whether the judge agrees or not, because every issue is a way to see and improve the judge; a disagreement is labelled (judge:disagrees, needs-human)
// and is the data for improving it. A judge that answers in the wrong shape is "unknown", never a guess in either direction.
// Why-changed (3 Nov 2026, coordinator, bk's broker change): the judge asks for Claude alone, and a busy Claude makes the call wait instead of falling to Free AI; a judge that gets no answer at all (refused, ran out, timed out) is "unavailable" and its note is held, not filed: an unjudged note is what the judge exists to stop.
export const VERDICTS = ['agrees', 'disagrees'];
const SYSTEM = `You are a careful reviewer of bug reports about a desktop job-search app. You see ONE report and, when given, a screenshot of the screen. You did not write the report and you do not know how its author reached it.
Decide only whether the report's argument holds: is what it says was OBSERVED plausible on this screen, and does that differ from what it says was EXPECTED in a way that matters for the person using the app? A report that complains about taste or wording that is fine does not hold.
Answer with the JSON asked for: "verdict" is "agrees" or "disagrees"; "reason" is one sentence.`;

/** The strict answer: a verdict and one sentence. */
export const judgeSchema = () => ({type: 'object', additionalProperties: false, required: ['verdict', 'reason'], properties: {verdict: {enum: VERDICTS}, reason: {type: 'string'}}});

/** The report as the judge reads it: only the argument, never the agent's steps or its own opinion of itself. */
export const judgePrompt = note => `Report: ${note.title}\nScreen: ${note.view}\nType: ${note.type}; severity claimed: ${note.severity}\nExpected: ${note.expected}\nObserved: ${note.observed}\nWhy it matters: ${note.why}`;

/**
 * Asks the second opinion. `ask({system, messages, schema})` is the broker call (the explorer's ask on the mid tier: it returns {text, usage, ms, tier, engine}); `image` is an optional base64 PNG of the screen.
 * -> {verdict: 'agrees' | 'disagrees' | 'unknown' | 'unavailable', reason, ms, usage, tier, engine}: a call that gets no answer is 'unavailable' (the note is held, never filed unjudged), an answer in the wrong shape is 'unknown', so a note is never flipped by a judge that did not answer.
 */
export async function judgeNote({ask, note, image = '', now = Date.now}) {
  const started = now();
  let answer;
  try {
    answer = await ask({system: SYSTEM, messages: [{role: 'user', content: image ? [{type: 'image', source: {type: 'base64', media_type: 'image/png', data: image}}, {type: 'text', text: judgePrompt(note)}] : judgePrompt(note)}], schema: judgeSchema()});
  } catch (error) {
    return {verdict: 'unavailable', reason: `the second opinion could not answer: ${String(error?.message || error).slice(0, 120)}`, ms: now() - started};
  }
  const text = typeof answer === 'string' ? answer : String(answer?.text ?? '');
  let data = null;
  try { data = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch (error) { data = {parseError: error.message}; }
  const spent = typeof answer === 'object' && answer ? {usage: answer.usage, tier: answer.tier, engine: answer.engine} : {};
  if (!VERDICTS.includes(data?.verdict)) return {verdict: 'unknown', reason: 'the second opinion did not answer in the asked shape', ms: now() - started, ...spent};
  return {verdict: data.verdict, reason: String(data.reason || '').slice(0, 240), ms: now() - started, ...spent};
}
