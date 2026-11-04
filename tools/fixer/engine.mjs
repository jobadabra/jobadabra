// The loop's model: the AI broker at the mid tier (Sonnet) and nothing below it (4 Nov 2026, [hm] 3/6). No API key, no other path; the broker's Codex engine (gpt-6.1-sol) is the Sonnet-level alternative.
// Why (4 Nov 2026, owner: "Sonnet level of intelligence (or ChatGPT alternative to Sonnet)"; spec Amendment "Engine"): the broker may fall back to Free AI (Qwen), which is not Sonnet level; an answer from it, or from an
// engine that names none (an older broker), ends the run instead of fixing code with it. Wraps desktop/e2e/lib/agent-ask.mjs without changing it.
import {brokerAsk} from '../../desktop/e2e/lib/agent-ask.mjs';

/** The engines of the broker's answers that are Sonnet level: Claude itself and Codex's gpt-6.1-sol. */
export const SONNET_ENGINES = ['claude', 'codex'];

/** `ask({system, messages, schema})` for the loop: tier mid; throws `no Sonnet-level engine …` when another engine answered. `call` is the tier's ask (tests). */
export const sonnetAsk = (call = brokerAsk('mid')) => async request => {
  const answer = await call(request);
  if (!SONNET_ENGINES.includes(answer.engine)) throw new Error(`no Sonnet-level engine answered (it was ${answer.engine || 'not named'}); the run stops rather than fix code with a smaller model`);
  return answer;
};
