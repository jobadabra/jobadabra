// How many steps the next goal of an AI user agent session may take: from the tokens the run has left and what one step costs on the engine that answers, never from a step count planned in advance.
// Job: report health
// Why (7 Nov 2026, #3378; run 42163935942): the night planned 6 goals x 16 steps (~770k tokens on Claude) against a 250k token cap, so goal 3 was refused and 0 goals were worked. A step costs 1k on a resumed Codex conversation (#3264)
// but 7-9k on Claude, which re-sends the harness, the goal and the page every call; the plan has to be sized by the meter, and the cap stays what the owner set.
import {linksAsked} from './agent-chain.mjs';

/** Tokens one actor step costs, by how the engine answers: a Codex conversation adds only the newest turn (0.6-1.0k measured, #3264); any other engine sends the whole prompt (6.6-9.2k measured on Claude, run 42163935942). */
export const STEP_TOKENS = {resumed: 1_000, stateless: 9_000};
export const TARGET_STEPS = 10;   // a goal that is funded gets about this many steps before the next goal is funded; fewer funded goals with room beat many goals of one or two steps
export const MIN_STEPS = 6;       // the least a goal can show anything in; the one owner, lib/agent-run.mjs imports it for the floor of a goal's share and its log (Gitar on #3398)
export const MIN_GOALS = 3;       // the fewest goals a night is drawn with when its budget pays for that many (the seeded draw is MIN_GOALS to MAX_GOALS)
export const MAX_GOALS = 4;       // Why (7 Nov 2026, pz, owner: "3–4 goals per run"): 43 of 122 goals in 31 runs were never started because the plan drew 6-10 goals for a budget that pays for 2-4
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

/**
 * How many goals tonight's plan may have: the goals the budget pays for at TARGET_STEPS each, which is the number goalSteps funds for the first goal, so a planned goal is a started goal. At most MAX_GOALS, at least 1.
 * `usable`: tokens the actor and reader may spend (runBudget().usable()); `cost`: tokens per step on the engine that answers (STEP_TOKENS or the workflow's measured number).
 * Why (7 Nov 2026, pz, Design: the plan's size has one owner, this function; the planner takes it as a ceiling, the run loop's goalSteps shares what is left): before, the planner drew 6-10 goals and goalSteps then left the rest "not started" (43 of 122 goals, 31 runs).
 */
export const goalCountFor = ({usable, cost, target = TARGET_STEPS, max = MAX_GOALS}) => (usable > 0 && cost > 0 ? Math.max(1, Math.min(max, Math.floor(usable / ((target + 1) * cost)))) : 1);

/** The plan line of the run's log: how many goals, what the budget pays for (not said for a named plan, which ignores it), the share of new move pairs and the changed areas. */
export const planLine = ({plan, goalMax, usable, stepTokens, planId = '', changedAreas = []}) => `  plan: ${plan.goals.length} goals${planId ? '' : ` (the budget pays for ${goalMax}: ${Math.round(usable / 1000)}k tokens at ${stepTokens} a step)`}, ${(plan.newShare * 100).toFixed(0)}% new move pairs; changed areas: ${changedAreas.join(', ') || 'none'}`;

/**
 * What tonight's plan is sized by: `stepTokens` (the workflow's measured number, else the dearer engine's, never the cheaper; #3378) and `goalMax`, the goals the budget pays for times the links of a chain (each link has its own budget and they share one plan; code review on pz 1/5).
 * `usable`: runBudget().usable(); `env`: process.env.
 */
export function planSizing(usable, env) {
  const stepTokens = Number(env.E2E_AGENT_STEP_TOKENS) || STEP_TOKENS.stateless;
  return {stepTokens, goalMax: goalCountFor({usable, cost: stepTokens}) * linksAsked(env.AGENT_CHAIN_LINKS)};
}
