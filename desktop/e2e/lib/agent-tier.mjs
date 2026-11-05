// Which model tier the AI user agent acts on, and the nightly token cap that drops it back to small when a night on the large tier has used its share of the Codex week.
// Job: report health
// Why (5 Nov 2026, owner via mac-32: "Large, with a cost cap (Recommended)"; "capped at 2% of the Codex week a night. Over the cap, the run falls back to small and says so in the night report"): the one large Board run found the planted bug the small actor never reached, at 43,675 tokens; a whole night on Opus can cost far more, so the money has a ceiling the run keeps by itself.
// Why (5 Nov 2026, coordinator mac-32: "The 2% cap is for the whole night, the reader's mid-tier calls included, not only the actor's"): one meter counts the actor, the screen reader and the second opinion; at the cap the actor falls to small and the reader stops, the second opinion still judges the notes already made (a note is never filed unjudged), so a night can pass the cap by one actor call, one reader call, every later small actor call (bounded by the night's own call, minute and step caps) and one judge call per note made (low notes included); the report shows the total and each part.
// 1% of the Codex week is about 720k tokens (measured 3 Nov 2026 from the small runs: 1.3-1.9M tokens = about 2%). A call that crosses the cap is allowed to finish, so a night can pass it by one call; the next call already runs on small.
export const CODEX_WEEK_PCT_TOKENS = 720_000;
export const NIGHT_CAP_PCT = 2;
export const CAP_REACHED = 'the night token cap was reached';   // the reader's refusal at the cap; the session reads it as "no answer" and does not count a call that was never made
export const NIGHT_CAP_TOKENS = CODEX_WEEK_PCT_TOKENS * NIGHT_CAP_PCT;

/** The acting tier of a run: what the dispatch asked for, else large for a night (kind 'night', set by the workflow) and small for anything else, so a run with no kind (a local one) never spends the large tier by default. */
export const actorTierOf = ({requested = '', kind = ''} = {}) => requested || (kind === 'night' ? 'large' : 'small');

// Why (5 Nov 2026, code review): the broker client reads a missing token count as 0 (broker-client.mjs), and a cap that counts 0 never trips; an answer with no count is charged an estimate of its request (4 characters a token) plus its text.
const estimate = (args, answer) => Math.ceil((JSON.stringify(args?.messages ?? '').length + String(args?.system ?? '').length + String(answer?.text ?? '').length) / 4);
const tokensOf = (answer, args) => ((answer?.usage?.input_tokens || 0) + (answer?.usage?.output_tokens || 0)) || estimate(args, answer);

/**
 * The night's token meter and the three asks that spend against it. `tier` is the actor's tier; only a large night is capped (small and mid cost little), and then `capTokens` counts the actor, the screen reader and the second opinion together.
 * -> {actor(primary, fallback), reader(ask), judge(ask), state}: each returns an `ask({system, messages, schema})`. `actor` runs `primary` until the meter reaches the cap, then `fallback` (the small tier); `reader` refuses once the meter has reached the cap (the reader then notes nothing, as when it gets no answer);
 * `judge` always answers (a note is never filed unjudged) and is counted. `state` {tier, capTokens, used: {actor, reader, judge}, total, calls, fellBackAtCall, readerStopped} is read after the session for the report.
 */
export function nightBudget({tier, capTokens = NIGHT_CAP_TOKENS}) {
  const state = {tier, capTokens: tier === 'large' ? capTokens : null, used: {actor: 0, reader: 0, judge: 0}, total: 0, calls: 0, fellBackAtCall: null, readerStopped: 0};
  const over = () => state.capTokens !== null && state.total >= state.capTokens;
  const counted = (part, ask) => async args => {
    const answer = await ask(args), spent = tokensOf(answer, args);
    state.used[part] += spent; state.total += spent;
    return answer;
  };
  const actor = (primary, fallback) => {
    const first = counted('actor', primary), second = counted('actor', fallback);
    return async args => {
      state.calls++;
      if (!over()) return first(args);
      state.fellBackAtCall ??= state.calls;
      return second(args);
    };
  };
  const reader = ask => {
    const counting = counted('reader', ask);
    return async args => {
      if (over()) { state.readerStopped++; throw new Error(CAP_REACHED); }
      return counting(args);
    };
  };
  return {actor, reader, judge: ask => counted('judge', ask), state};
}

const k = tokens => `${Math.round(tokens / 1000).toLocaleString('en-US')}k`;

/** The tier line of the night report: what the actor ran on and, on the large tier, the night's tokens against the cap with the share of each part, or where the cap was reached. */
export function tierLine(state) {
  if (state.capTokens === null) return `Actor tier: ${state.tier}.`;
  const {actor, reader, judge} = state.used;
  const parts = `actor ${k(actor)}, screen reader ${k(reader)}, second opinion ${k(judge)}`;
  const cap = `${k(state.capTokens)} tokens, ${NIGHT_CAP_PCT}% of the Codex week`;
  if (state.fellBackAtCall || state.readerStopped) {
    const rest = [state.fellBackAtCall ? `from the actor's call ${state.fellBackAtCall} the actor ran on small` : '', state.readerStopped ? `the screen reader stopped (${state.readerStopped} read${state.readerStopped === 1 ? '' : 's'} skipped)` : ''].filter(Boolean).join(' and ');
    return `Night tokens: the cap (${cap}) was reached; ${rest}. Total ${k(state.total)} (${parts}).`;
  }
  return `Night tokens: ${k(state.total)} of ${k(state.capTokens)} (${parts}); the actor ran on large; cap = ${cap}.`;
}
