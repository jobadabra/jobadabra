// The AI user agent's two ways to think: the acting call (small tier by default) and the second opinion (mid tier), both through the AI broker (Codex, then Claude, then Free AI). No API key, no other path.
// Job: report health
// Why (3 Nov 2026, AI user agents 6/12): the manual explorer suite builds this inline; the agent needs it twice with two tiers, so it is a function. A broker that says no on its BUDGET greys the step with an alert
// (lib/ai-cap.mjs), as in the explorer, and the session keeps what it found; a lost login or any other refusal fails the step (4 Nov 2026, owner via mac-32).
import {askBroker} from './broker-client.mjs';
import {noteBrokerCapped} from './ai-cap.mjs';

export const MODELS = {small: 'claude-haiku-5-5', mid: 'claude-sonnet-5-5', large: 'claude-opus-5-5'};   // large: the broker maps an Opus id to its large tier (broker-client.mjs tierOf); no run asked for it before, so it was missing

// Why (3 Nov 2026, coordinator, the broker pane's change): the second opinion asks for one engine alone (`only`), so a busy Claude makes it wait and never answers it from Free AI; a refusal of such a call means the judge is unavailable (its note is held, lib/agent-judge.mjs),
// not that the budget is spent, so it does not grey the step.
/**
 * `acting` (default: no engine named): the call is the actor's, so a budget refusal of it raises the capped alert; the second opinion and the reader name Claude alone and are not acting (pz 2/5, Gitar on #3453: a night that moved to Claude must still alert).
 * `ask({system, messages, schema})` on one tier -> {text, usage, ms, tier, engine}; throws `status detail` when the broker refuses (the loop then stops with "api: …"). `only`: an engine name that alone may answer ('claude'), else the broker's chain;
 * `ask` is the broker call (tests).
 */
export const brokerAsk = (tier = 'small', {only = '', acting = !only, ask: call = askBroker} = {}) => async ({system, messages, schema, session, delta, endSession}) => {
  const kept = session && !only ? {session, ...(delta ? {delta} : {}), ...(endSession ? {endSession: true} : {})} : {};   // Why (5 Nov 2026, broker contract #409): a call that asks for one engine alone (Claude) keeps no Codex conversation
  const answer = await call({model: MODELS[tier] || MODELS.small, max_tokens: 1024, system, messages, output_config: {format: {type: 'json_schema', schema}}, ...(only ? {engine: only, only: true} : {}), ...kept});
  if (!answer.ok) { if (answer.status === 'capped' && acting) noteBrokerCapped(answer.detail); throw new Error(`${answer.status} ${answer.detail}`); }
  return {text: answer.message.content[0].text, usage: answer.message.usage, ms: answer.ms, tier: answer.tier, engine: answer.engine, tokens: answer.tokens, session: answer.session};
};

/** Whether a refusal says the broker or Codex failed (a 5xx such as "502 broker: codex-failed … killed after 100 s", or "unreachable no answer from the broker"), the only kind another engine can answer. A budget refusal (`capped`), a lost login or any 4xx is not: those are decisions, never asked again elsewhere. */
export const isBrokerFailure = error => /^(unreachable|5\d\d)\b/.test(String(error?.message ?? error));

/**
 * The acting call with one more engine behind it. `primary` and `fallback` are asks (brokerAsk); a failure of `primary` (isBrokerFailure) is asked again at once on `fallback`, without the Codex conversation fields (the body carries the whole prompt),
 * and every later call goes to `fallback` too: a Codex that stalled once stalls again, 100 s at a time. A failure of `fallback` is the caller's, as before. -> an ask with `.failover()`: the first failure's reason, or '' while the primary answers.
 * Why (7 Nov 2026, pz, owner: "retry on Claude when Codex fails"; 31 runs: 12 goals lost to "502 broker: codex-failed … killed after 100 s" or "unreachable"): the loop ended the goal and the whole night on the first refusal, so the goals after it were never started.
 */
export function withFailover(primary, fallback) {
  let reason = '';
  const ask = async args => {
    if (reason) return fallback(stripConversation(args));
    try { return await primary(args); } catch (error) {
      if (!isBrokerFailure(error)) throw error;
      reason = String(error.message).slice(0, 160);
      return fallback(stripConversation(args));
    }
  };
  ask.failover = () => reason;
  return ask;
}
const stripConversation = ({session, delta, endSession, ...args}) => args;   // a Claude call keeps no Codex conversation (brokerAsk drops these for `only` anyway; the loop's own calls must not depend on that)

/** The actor's ask for a night: on one engine alone (`engine` set) the plain call; otherwise Codex first with Claude behind it (withFailover). */
export const actorAskOf = (tier, engine) => (engine ? brokerAsk(tier, {only: engine, acting: true}) : withFailover(brokerAsk(tier), brokerAsk(tier, {only: 'claude', acting: true})));
