// How many steps the next goal of an AI user agent session may take: from the tokens the run has left and what one step costs on the engine that answers, never from a step count planned in advance.
// Job: report health
// Why (7 Nov 2026, #3378; run 42163935942): the night planned 6 goals x 16 steps (~770k tokens on Claude) against a 250k token cap, so goal 3 was refused and 0 goals were worked. A step costs 1k on a resumed Codex conversation (#3264)
// but 7-9k on Claude, which re-sends the harness, the goal and the page every call; the plan has to be sized by the meter, and the cap stays what the owner set.

/** Tokens one actor step costs, by how the engine answers: a Codex conversation adds only the newest turn (0.6-1.0k measured, #3264); any other engine sends the whole prompt (6.6-9.2k measured on Claude, run 42163935942). */
export const STEP_TOKENS = {resumed: 1_000, stateless: 9_000};
export const TARGET_STEPS = 10;   // a goal that is funded gets about this many steps before the next goal is funded; fewer funded goals with room beat many goals of one or two steps
export const MIN_STEPS = 6;       // the least a goal can show anything in (MIN_STEPS_PER_GOAL of lib/agent-run.mjs)
export const MIN_CALIBRATION_CALLS = 3;   // the measured cost per step replaces the engine's default after this many actor calls

/**
 * The cost of one step now: the measured average once `calls` actor calls have been made, else the engine's default.
 * `used`: tokens the actor has spent so far; `calls`: its calls. -> tokens
 */
export const stepCost = ({used = 0, calls = 0, fallback = STEP_TOKENS.stateless} = {}) => (calls >= MIN_CALIBRATION_CALLS && used > 0 ? Math.ceil(used / calls) : fallback);

/**
 * The next goal's step allowance. `left`: tokens the actor and the screen reader may still spend (cap less the judge's reserve less what is used); `cost`: tokens per step; `goalsLeft`: goals not yet started;
 * `maxPerGoal`: the most one goal may take. The screen reader's call after the goal is paid for as one extra step. The budget is shared out over the goals it can fund at TARGET_STEPS each (at least one).
 * -> {steps, funded} with steps 0 when not even MIN_STEPS fit; `funded` is how many of the goals left the budget pays for at this rate.
 */
export function goalSteps({left, cost, goalsLeft, maxPerGoal, target = TARGET_STEPS, min = MIN_STEPS}) {
  if (!(left > 0) || !(cost > 0) || goalsLeft < 1) return {steps: 0, funded: 0};
  const funded = Math.min(goalsLeft, Math.max(1, Math.floor(left / ((target + 1) * cost))));
  const steps = Math.min(maxPerGoal, Math.floor(left / funded / cost) - 1);
  return steps >= min ? {steps, funded} : {steps: 0, funded: 0};
}
