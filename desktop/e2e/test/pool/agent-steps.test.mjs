// The steps of an AI user agent session come from its token meter: on Claude (8k a step) a 250k cap funds two goals and the rest are not started instead of being refused; on a resumed Codex conversation (1k a step) every goal gets its full steps.
// Guard: money — a night that plans past its token cap wastes the whole run's AI spend (run 42163935942: 208k spent, 0 goals worked).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {goalCountFor, goalSteps, MAX_GOALS, MIN_STEPS, STEP_TOKENS, stepCost} from '../../lib/agent-steps.mjs';
import {runSession} from '../../lib/agent-run.mjs';
import {planSession} from '../../lib/agent-plan.mjs';
import {runRecord} from '../../lib/agent-run-record.mjs';
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
  assert.equal(result.stopped, 'budget', 'unfunded goals are an incomplete night, even without a refused call');
  assert.equal(budget.state.stoppedAtCap, false);
  assert.deepEqual(result.played, [1, 2]);
  assert.deepEqual(result.unfunded, [3, 4, 5, 6]);
  assert.deepEqual(result.completed, [], 'spending a goal allowance does not prove its outcome');
  assert.deepEqual(result.summary.goals.map(goal => goal.verdict), ['could-not-finish', 'could-not-finish', 'not-started', 'not-started', 'not-started', 'not-started']);
  assert.equal(result.summary.counts['not-started'], 4);
  assert.equal(Object.values(result.observations).flat().length, 2, 'unvisited pages are not observations about the app');
  assert.ok(budget.state.total <= 250_000 - 40_000);
});

test('on a resumed Codex conversation (1k a step) every goal gets its steps', async () => {
  const budget = runBudget();
  const result = await session(budget.actor(endless(1_000)), {usable: budget.usable, actorUsed: () => budget.state.used.actor, stepTokens: STEP_TOKENS.resumed});
  assert.deepEqual(result.played, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(result.unfunded, []);
  assert.equal(result.trace.length, 6 * 16);
  assert.equal(result.stopped, 'steps', 'trying every goal is different from completing it');
});

test('the run preserves the actual shared call limit and never calls the next goal', async () => {
  let calls = 0;
  const result = await runSession({act: act(), ask: async () => { calls++; return {text: JSON.stringify({...BLANK, action: 'done', verdict: 'worked', summary: 'Verified saved value'}), usage: {input_tokens: 1, output_tokens: 1}}; }, judgeAsk: async () => { throw new Error('no notes to judge'); }, views: ['profile'], plan: {goals, persona: {name: 'Alex'}}, caps: {maxCalls: 1}});
  assert.equal(calls, 1);
  assert.equal(result.stopped, 'calls 1');
  assert.deepEqual(result.completed, [1]);
  assert.equal(result.summary.goals[1].verdict, 'not-started');
});

test('the plan is as long as the budget pays for: every planned goal is started, none is left "not started"', async () => {
  const usable = runBudget().usable();
  assert.equal(goalCountFor({usable, cost: STEP_TOKENS.stateless}), 2, 'Claude at 9k a step pays for 2 goals of 10 steps');
  assert.equal(goalCountFor({usable, cost: STEP_TOKENS.resumed}), MAX_GOALS, 'a resumed Codex conversation is capped at MAX_GOALS, not 19');
  assert.equal(goalCountFor({usable: 0, cost: 1000}), 1, 'never an empty plan');
  // The planner takes it as a ceiling, and goalSteps funds exactly that many goals for the first goal: the two agree, so the loop never reaches an unfunded goal on defaults.
  const moves = ['Jobs', 'Profile', 'Strategy', 'Settings', 'Focus'].flatMap(group => [1, 2].map(i => ({group, label: `${group} ${i}`})));
  for (const cost of [STEP_TOKENS.stateless, STEP_TOKENS.resumed]) for (const seed of [20261105, 20261106, 20261107]) {
    const max = goalCountFor({usable, cost}), plan = planSession({seed, moves, changed: ['Jobs', 'Profile', 'Strategy', 'Settings', 'Focus'], max});
    assert.ok(plan.goals.length <= max, `seed ${seed} at ${cost}: ${plan.goals.length} goals for ${max}`);
    assert.equal(goalSteps({left: usable, cost, goalsLeft: plan.goals.length, maxPerGoal: 25}).funded, plan.goals.length, `seed ${seed} at ${cost}: a planned goal must be a funded goal`);
  }
});

test('changed areas past the budget are deferred to the next night, not planned and not lost', () => {
  const groups = ['Jobs', 'Profile', 'Strategy', 'Settings', 'Focus'], moves = groups.flatMap(group => [1, 2].map(i => ({group, label: `${group} ${i}`})));
  const plan = planSession({seed: 7, moves, changed: groups, max: 2});
  assert.equal(plan.goals.length, 2);
  assert.deepEqual([...new Set([...plan.goals.map(goal => goal.group), ...plan.deferred.map(goal => goal.group)])].sort(), [...groups].sort(), 'every changed area is a goal tonight or in the queue');
  assert.equal(plan.deferred.length, 3);
  assert.deepEqual(planSession({seed: 7, moves, changed: groups}).deferred, [], 'no ceiling given: the old behaviour, nothing deferred');
});

test('pending goals and changed areas together at a small ceiling: pending first, the rest of the changed areas queued, none planned past it', () => {
  const groups = ['Jobs', 'Profile', 'Strategy', 'Settings', 'Focus'], moves = groups.flatMap(group => [1, 2, 3].map(i => ({group, label: `${group} ${i}`})));
  const pending = [moves[1], moves[10]];   // Jobs 2, Settings 2
  const plan = planSession({seed: 11, moves, pending, changed: groups, max: 2});
  assert.deepEqual(new Set(plan.goals.map(goal => goal.label)), new Set(['Jobs 2', 'Settings 2']));
  assert.deepEqual(plan.deferred.map(goal => goal.group).sort(), ['Focus', 'Profile', 'Strategy']);
});

test('a goal whose call fails on Codex finishes on Claude, the night goes on there, and the record says why', async () => {
  const {withFailover} = await import('../../lib/agent-ask.mjs');
  const verdict = async () => ({text: JSON.stringify({...BLANK, action: 'done', verdict: 'worked', summary: 'it held'}), usage: {input_tokens: 5, output_tokens: 1}, ms: 1, tier: 'mid', engine: 'claude'});
  let codexCalls = 0;
  const codex = async () => { codexCalls++; throw new Error('502 broker: codex-failed:1 killed after 100 s'); };
  const ask = withFailover(codex, verdict);
  const result = await runSession({act: act(), ask, failover: ask.failover, judgeAsk: async () => { throw new Error('no notes'); }, views: ['profile'], plan: {seed: 1, persona: {name: 'Alex'}, goals: goals.slice(0, 3)}, caps: {maxSteps: 60}});
  assert.deepEqual(result.summary.goals.map(goal => goal.verdict), ['worked', 'worked', 'worked'], 'no goal is lost to the broker');
  assert.equal(codexCalls, 1, 'Codex is asked once');
  assert.match(result.summary.goals[0].failover, /502 broker: codex-failed/);
  assert.equal(result.summary.goals[1].failover, undefined, 'the reason is named once');
  assert.equal(result.summary.goals[0].summary, 'it held', 'the reason is not in the summary: it is cut at 240 and read into the field notes');
  assert.deepEqual(result.observations, {}, 'a failover leaves nothing in the field notes');
  assert.equal(runRecord(result, {run: '1', at: 'x', kind: 'night'}).goals[0].failover.slice(0, 3), '502', 'the Admin record carries it');
  const down = withFailover(codex, async () => { throw new Error('502 broker: claude down'); });
  const both = await runSession({act: act(), ask: down, failover: down.failover, judgeAsk: async () => { throw new Error('no notes'); }, views: ['profile'], plan: {seed: 1, persona: {name: 'Alex'}, goals: goals.slice(0, 2)}, caps: {maxSteps: 60}});
  assert.ok(both.stopped.startsWith('api: 502'), 'both engines failed: the night ends');
  assert.equal(both.summary.goals[0].failover, undefined, 'no claim that Claude took over when it did not');
  assert.equal(result.stopped, 'goals');
  const plain = await runSession({act: act(), ask: codex, judgeAsk: async () => { throw new Error('no notes'); }, views: ['profile'], plan: {seed: 1, persona: {name: 'Alex'}, goals: goals.slice(0, 3)}, caps: {maxSteps: 60}});
  assert.match(plain.stopped, /^api: 502/, 'without a fallback the first failure still ends the night, as before');
});
