// The second opinion on an AI user agent's note: a different call (the mid tier) reads the note and the screenshot COLD, without the agent's reasoning, and says whether the argument holds.
// Job: report health
// Why (3 Nov 2026, AI user agents 5/11; spec "Findings"): the note is filed whether the judge agrees or not, because every issue is a way to see and improve the judge; a disagreement is labelled (judge:disagrees, needs-human)
// and is the data for improving it. A judge that answers in the wrong shape is "unknown", never a guess in either direction.
// Why-changed (3 Nov 2026, coordinator, bk's broker change): the judge asks for Claude alone, and a busy Claude makes the call wait instead of falling to Free AI; a judge that gets no answer at all (refused, ran out, timed out) is "unavailable" and its note is held, not filed: an unjudged note is what the judge exists to stop.
export const VERDICTS = ['agrees', 'disagrees'];
// Why-changed (5 Nov 2026, exam run 41975171012: 4 of 7 real kept, and 3 of the misses said the picture "does not show" the quoted words): a picture that neither shows nor contradicts the quote now counts for nothing and the quote is taken as accurate.
// Why-changed (5 Nov 2026, owner via mac-32: "Judge first"; tour run 41952722418, 11 notes: 7 real, 4 not): the judge kept 2 of 7 real notes and dropped 1 of 4 false ones, and it dropped the planted jobs-3 bug. Its own reasons name two causes: it was given no rules (jobs-3 says an applied job is never "Not checked" on the Inbound list, so "Not checked" read as a different thing), and it took words missing from the picture as proof the report was wrong (a panel covered the screen in one note, the "Saved" moment had passed in another), when the report quotes the page's text and the picture is taken later. It now gets the area's rules and is told how to read the picture.
export const SYSTEM = `You are a careful reviewer of bug reports about a desktop job-search app. You see ONE report, what is known about how the app should behave (its rules by area, and what earlier sessions learned), and, when given, a screenshot of the screen. You did not write the report and you do not know how its author reached it.
Decide whether the report's argument holds, in this order:
1. The rules. When a rule says the state the report observed is how the app should behave (by design), or the report cites a rule and the observed state agrees with it, disagree and name the rule. When a rule forbids the observed state, agree and name the rule.
2. The picture. The report quotes the page's text. The picture is taken a moment later and may be covered by a panel, scrolled, or past a short-lived state, so words of the report that are missing from the picture are NOT proof that the report is wrong. Disagree on the picture only when it shows the opposite (the same words with another value) or plainly shows the quoted state is normal. A picture that neither shows nor contradicts the quoted words proves nothing: take the quote as accurate (the author read the page's text) and decide by the rules and by step 3.
3. Otherwise: is what it says was OBSERVED plausible, and does it differ from what is EXPECTED in a way that matters for the person using the app? Taste or wording that is fine does not hold.
Answer with the JSON asked for: "verdict" is "agrees" or "disagrees"; "reason" is one sentence that names the rule or the picture detail you relied on.`;

/** The strict answer: a verdict and one sentence. */
export const judgeSchema = () => ({type: 'object', additionalProperties: false, required: ['verdict', 'reason'], properties: {verdict: {enum: VERDICTS}, reason: {type: 'string'}}});

/** The report as the judge reads it: the area's rules, then only the argument, never the agent's steps or its own opinion of itself. */
export const judgePrompt = (note, knowledge = '') => `What is known about the app:\n${knowledge || '(nothing recorded for this area)'}\n\nReport: ${note.title}\nScreen: ${note.view}\nType: ${note.type}; severity claimed: ${note.severity}\nExpected: ${note.expected}\nObserved: ${note.observed}\nWhy it matters: ${note.why}`;

/**
 * Asks the second opinion. `knowledge`: the area's rules (and field notes) as the actor got them. `ask({system, messages, schema})` is the broker call (the explorer's ask on the mid tier: it returns {text, usage, ms, tier, engine}); `image` is an optional base64 PNG of the screen.
 * -> {verdict: 'agrees' | 'disagrees' | 'unknown' | 'unavailable', reason, ms, usage, tier, engine}: a call that gets no answer is 'unavailable' (the note is held, never filed unjudged), an answer in the wrong shape is 'unknown', so a note is never flipped by a judge that did not answer.
 */
export async function judgeNote({ask, note, image = '', knowledge = '', now = Date.now}) {
  const started = now();
  let answer;
  try {
    answer = await ask({system: SYSTEM, messages: [{role: 'user', content: image ? [{type: 'image', source: {type: 'base64', media_type: 'image/png', data: image}}, {type: 'text', text: judgePrompt(note, knowledge)}] : judgePrompt(note, knowledge)}], schema: judgeSchema()});
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
