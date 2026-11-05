// Which model tier the AI user agent acts on, and the nightly token cap that drops it back to small when a night on the large tier has used its share of the Codex week.
// Job: report health
// Why (5 Nov 2026, owner via mac-32: "Large, with a cost cap (Recommended)"; "capped at 2% of the Codex week a night. Over the cap, the run falls back to small and says so in the night report"): the one large Board run found the planted bug the small actor never reached, at 43,675 tokens; a whole night on Opus can cost far more, so the money has a ceiling the run keeps by itself.
// 1% of the Codex week is about 720k tokens (measured 3 Nov 2026 from the small runs: 1.3-1.9M tokens = about 2%). A call that crosses the cap is allowed to finish, so a night can pass it by one call; the next call already runs on small.
export const CODEX_WEEK_PCT_TOKENS = 720_000;
export const NIGHT_CAP_PCT = 2;
export const NIGHT_CAP_TOKENS = CODEX_WEEK_PCT_TOKENS * NIGHT_CAP_PCT;

/** The acting tier of a run: what the dispatch asked for, else large for a night (kind 'night', set by the workflow) and small for anything else, so a run with no kind (a local one) never spends the large tier by default. */
export const actorTierOf = ({requested = '', kind = ''} = {}) => requested || (kind === 'night' ? 'large' : 'small');

// Why (5 Nov 2026, code review): the broker client reads a missing token count as 0 (broker-client.mjs), and a cap that counts 0 never trips; an answer with no count is charged an estimate of its request (4 characters a token) plus its text.
const estimate = (args, answer) => Math.ceil((JSON.stringify(args?.messages ?? '').length + String(args?.system ?? '').length + String(answer?.text ?? '').length) / 4);
const tokensOf = (answer, args) => ((answer?.usage?.input_tokens || 0) + (answer?.usage?.output_tokens || 0)) || estimate(args, answer);

/**
 * The acting `ask` with the cap. `primary` and `fallback` are `ask({system, messages, schema})` functions (lib/agent-ask.mjs brokerAsk on two tiers); `tier` is the primary's tier name.
 * Only a large primary is capped (small and mid cost little). -> {ask, state}: `state` {tier, capTokens, used, calls, fellBackAtCall} is read after the session for the report; `fellBackAtCall` is the call number that first ran on the fallback, or null.
 */
export function cappedAsk({primary, fallback, tier, capTokens = NIGHT_CAP_TOKENS}) {
  const state = {tier, capTokens: tier === 'large' ? capTokens : null, used: 0, calls: 0, fellBackAtCall: null};
  const ask = async args => {
    state.calls++;
    if (state.capTokens !== null && state.used >= state.capTokens) { state.fellBackAtCall ??= state.calls; return fallback(args); }
    const answer = await primary(args);
    state.used += tokensOf(answer, args);
    return answer;
  };
  return {ask, state};
}

const k = tokens => `${Math.round(tokens / 1000).toLocaleString('en-US')}k`;

/** The tier line of the night report: what the actor ran on and, on the large tier, how much of the cap it used or when it fell back to small. */
export function tierLine(state) {
  if (state.capTokens === null) return `Actor tier: ${state.tier}.`;
  const cap = `${k(state.capTokens)} tokens, ${NIGHT_CAP_PCT}% of the Codex week`;   // the same cap for a night and for a hand run
  if (state.fellBackAtCall) return `Actor tier: large until the large-tier cap (${cap}) was reached; from the actor's call ${state.fellBackAtCall} the rest of the night ran on small (large used ${k(state.used)} tokens).`;
  return `Actor tier: large, ${k(state.used)} of ${k(state.capTokens)} tokens (the large-tier cap, ${NIGHT_CAP_PCT}% of the Codex week).`;
}
