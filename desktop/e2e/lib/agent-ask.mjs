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
 * True for the broker's answer to a Codex turn that did not finish: HTTP 502 whose reason starts `codex-failed:` (a crash `codex-failed:1 ...`, a stall `codex-failed:null ... [killed after 100 s`). A budget refusal (429/503 `budget:`) or Codex out of allowance is not one: asking again would not help.
 * Why (5 Nov 2026, a8 via mac-32): TREATS A SYMPTOM. Why Codex stalls (3 in ~14 calls) is open with a8; this is the recovery the broker contract plans, so one stall is a `restarted` row and not a dead chain.
 */
export const turnFailed = answer => !answer.ok && answer.status === 502 && /^broker: codex-failed:/.test(String(answer.detail));

/**
 * `ask({system, messages, schema})` on one tier -> {text, usage, ms, tier, engine}; throws `status detail` when the broker refuses (the loop then stops with "api: …"). `only`: an engine name that alone may answer ('claude'), else the broker's chain;
 * `ask` is the broker call (tests).
 */
export const brokerAsk = (tier = 'small', {only = '', ask: call = askBroker} = {}) => async ({system, messages, schema, session, delta, endSession}) => {
  const kept = session && !only ? {session, ...(delta ? {delta} : {}), ...(endSession ? {endSession: true} : {})} : {};   // Why (5 Nov 2026, broker contract #409): a call that asks for one engine alone (Claude) keeps no Codex conversation
  const body = {model: MODELS[tier] || MODELS.small, max_tokens: 1024, system, messages, output_config: {format: {type: 'json_schema', schema}}, ...(only ? {engine: only, only: true} : {}), ...kept};
  let answer = await call(body);
  if (turnFailed(answer)) answer = await call(body);   // Why (5 Nov 2026, a8 via mac-32): a Codex turn that failed or stalled (the broker kills it at 100 s) answers 502 `codex-failed:` and the next call restarts the conversation from the full prompt, which this body carries; once, then the failure is the goal's as before
  if (!answer.ok) { if (answer.status === 'capped' && !only) noteBrokerCapped(answer.detail); throw new Error(`${answer.status} ${answer.detail}`); }
  return {text: answer.message.content[0].text, usage: answer.message.usage, ms: answer.ms, tier: answer.tier, engine: answer.engine, tokens: answer.tokens, session: answer.session};
};
