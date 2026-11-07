// The steps of an AI user agent session come from its token meter: on Claude (8k a step) a 250k cap funds two goals and the rest are not started instead of being refused; on a resumed Codex conversation (1k a step) every goal gets its full steps.
// Guard: money — a night that plans past its token cap wastes the whole run's AI spend (run 42163935942: 208k spent, 0 goals worked).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {goalSteps, MIN_STEPS, STEP_TOKENS, stepCost} from '../../lib/agent-steps.mjs';
import {runSession} from '../../lib/agent-run.mjs';
import {CAP_REACHED, runBudget} from '../../lib/agent-tier.mjs';

test('a goal is funded from what is left: the 6 Nov numbers on Claude give 2 goals of about 10 steps, not 6 goals of 16', () => {
  assert.deepEqual(goalSteps({left: 210_000, cost: STEP_TOKENS.stateless, goalsLeft: 6, maxPerGoal: 16}), {steps: 10, funded: 2});
  assert.deepEqual(goalSteps({left: 210_000, cost: STEP_TOKENS.resumed, goalsLeft: 6, maxPerGoal: 16}), {steps: 16, funded: 6}, 'a resumed Codex conversation keeps the full plan');
  assert.deepEqual(goalSteps({left: 130_000, cost: 8_000, goalsLeft: 4, maxPerGoal: 16}), {steps: 15, funded: 1});
  assert.equal(goalSteps({left: 10_000, cost: 8_000, goalsLeft: 4, maxPerGoal: 16}).steps, 0, 'less than a goal of MIN_STEPS is no goal');
  assert.equal(goalSteps({left: 0, cost: 8_000, goalsLeft: 4, maxPerGoal: 16}).steps, 0);
  assert.equal(goalSteps({left: 500_000, cost: 8_000, goalsLeft: 0, maxPerGoal: 16}).steps, 0);
  assert.ok(MIN_STEPS >= 6);
});

test('the cost of a step is the default until three calls were measured, then the measured average', () => {
  assert.equal(stepCost({used: 20_000, calls: 2, fallback: 9_000}), 9_000);
  assert.equal(stepCost({used: 24_000, calls: 3, fallback: 9_000}), 8_000);
  assert.equal(stepCost({used: 0, calls: 5, fallback: 1_000}), 1_000);
});

const BLANK = {control: -1, text: '', key: '', view: '', title: '', kind: '', severity: '', what: '', check_type: '', check_text: '', check_control: '', summary: '', type: '', expected: '', observed: '', why: '', verdict: ''};
let page = 0;
const act = () => ({observe: async () => ({view: 'profile', text: `Profile page ${page++}`, overlays: [], controls: [{i: 0, kind: 'button', label: 'Save', disabled: false, cls: '', href: '', type: ''}]}), click: async () => {}, type: async () => {}, press: async () => {}, go: async () => {}});
// An actor that never ends its goal: every call is a click on a page that changed, costing `tokens`.
const endless = tokens => async () => ({text: JSON.stringify({...BLANK, action: 'click', control: 0}), usage: {input_tokens: tokens, output_tokens: 0}, ms: 1, tier: 'mid', engine: 'claude'});
const goals = Array.from({length: 6}, (_, i) => ({n: i + 1, group: 'Profile', label: `goal ${i + 1}`, pair: `p${i}`}));
const session = (ask, meter) => runSession({act: act(), ask, judgeAsk: async () => ({text: '{"verdict":"agrees","reason":"x"}', usage: {input_tokens: 1, output_tokens: 1}}), views: ['profile'], plan: {seed: 1, persona: {name: 'Alex'}, goals}, caps: {maxSteps: 100}, meter});

test('on Claude (8k a step) a 250k cap funds the goals it can and does not start the rest; before, the cap refused goal 3 with 0 worked', async () => {
  const before = runBudget();
  const old = await session(before.actor(endless(8_000)), null);
  assert.ok(old.stopped.includes(CAP_REACHED), `without the meter the cap ends the night: ${old.stopped}`);
  assert.ok(before.state.stoppedAtCap);
  const budget = runBudget();
  const meter = {usable: budget.usable, actorUsed: () => budget.state.used.actor, stepTokens: STEP_TOKENS.stateless};
  const result = await session(budget.actor(endless(8_000)), meter);
  assert.equal(result.stopped, 'goals', 'a plan that fits is not a refused call');
  assert.equal(budget.state.stoppedAtCap, false);
  assert.deepEqual(result.played, [1, 2]);
  assert.deepEqual(result.unfunded, [3, 4, 5, 6]);
  assert.ok(budget.state.total <= 250_000 - 40_000);
});

test('on a resumed Codex conversation (1k a step) every goal gets its steps', async () => {
  const budget = runBudget();
  const result = await session(budget.actor(endless(1_000)), {usable: budget.usable, actorUsed: () => budget.state.used.actor, stepTokens: STEP_TOKENS.resumed});
  assert.deepEqual(result.played, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(result.unfunded, []);
  assert.equal(result.trace.length, 6 * 16);
});
