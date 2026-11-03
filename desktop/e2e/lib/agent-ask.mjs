// The AI user agent's two ways to think: the acting call (small tier by default) and the second opinion (mid tier), both through the AI broker (Codex, then Claude, then Free AI). No API key, no other path.
// Job: report health
// Why (3 Nov 2026, AI user agents 6/12): the manual explorer suite builds this inline; the agent needs it twice with two tiers, so it is a function. A broker that says no (budget, login) greys the step with an alert
// (lib/ai-cap.mjs), as in the explorer, and the session keeps what it found.
import {askBroker} from './broker-client.mjs';
import {noteBrokerCapped} from './ai-cap.mjs';

export const MODELS = {small: 'claude-haiku-5-5', mid: 'claude-sonnet-5-5'};

// Why (3 Nov 2026, coordinator, the broker pane's change): the second opinion asks for one engine alone (`only`), so a busy Claude makes it wait and never answers it from Free AI; a refusal of such a call means the judge is unavailable (its note is held, lib/agent-judge.mjs),
// not that the budget is spent, so it does not grey the step.
/**
 * `ask({system, messages, schema})` on one tier -> {text, usage, ms, tier, engine}; throws `status detail` when the broker refuses (the loop then stops with "api: …"). `only`: an engine name that alone may answer ('claude'), else the broker's chain;
 * `ask` is the broker call (tests).
 */
export const brokerAsk = (tier = 'small', {only = '', ask: call = askBroker} = {}) => async ({system, messages, schema}) => {
  const answer = await call({model: MODELS[tier] || MODELS.small, max_tokens: 1024, system, messages, output_config: {format: {type: 'json_schema', schema}}, ...(only ? {engine: only, only: true} : {})});
  if (!answer.ok) { if (answer.status === 'capped' && !only) noteBrokerCapped(answer.detail); throw new Error(`${answer.status} ${answer.detail}`); }
  return {text: answer.message.content[0].text, usage: answer.message.usage, ms: answer.ms, tier: answer.tier, engine: answer.engine};
};
