// The AI user agent's acting tier and the hard token cap of one run: a night acts on the mid tier (the large tier stalls, 5 Nov 2026), a replay on small, and every call of a run counts against 250,000 tokens and is refused before it is made when it could pass the cap.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {actorEngineOf, actorTierOf, engineLine, CAP_REACHED, harnessTokens, HARNESS_MAX_TOKENS, isCapStop, RUN_CAP_TOKENS, runBudget, stoppedLabel, tokensLine} from '../../lib/agent-tier.mjs';

const answer = (tokens, tier = 'large') => ({text: '{}', usage: {input_tokens: tokens - 100, output_tokens: 100}, tier});
const asks = (tokens, tier) => { const calls = []; const ask = async args => { calls.push(args); return answer(tokens, tier); }; ask.calls = calls; return ask; };
const small = {system: 's', messages: [{role: 'user', content: 'hello'}]};
// A request as big as the input the fake answer reports (4 characters a token), so the pre-call worst case and the real usage agree as they do in life.
const sized = tokens => ({system: 's', messages: [{role: 'user', content: 'y'.repeat((tokens - 100) * 4)}]});

// Guard: money — cached context still appears in the owner's gross-token cost; cheap incremental turns cannot bypass the gross ceiling.
test('gross usage caps cached conversations as well as incremental tokens, across actor reader and judge', async () => {
  let calls = 0;
  const ask = async () => { calls++; return {text: '{}', usage: {input_tokens: 90_000, output_tokens: 1000}, tokens: {counted: 1000}}; };
  const budget = runBudget();
  await budget.actor(ask)(small);
  await budget.reader(ask)(small);
  await assert.rejects(budget.judge(ask)(small), /run token cap was reached/);
  assert.equal(calls, 2);
  assert.equal(budget.state.total, 2000);
  assert.equal(budget.state.gross, 182_000);
});

test('a night acts on the mid tier, a replay or a run with no kind on small, and what a dispatch asked for wins', () => {
  assert.deepEqual([actorTierOf({kind: 'night'}), actorTierOf({kind: 'replay'}), actorTierOf({requested: 'mid', kind: 'night'}), actorTierOf({requested: 'large', kind: 'replay'}), actorTierOf(), actorTierOf({kind: 'lane'})], ['mid', 'small', 'mid', 'large', 'small', 'mid']);   // a lane files like a night, so it acts on mid (pz, 7 Nov 2026)
});

// Guard: money. One run never spends more than 250,000 tokens (owner, 5 Nov 2026: "we can start with 250k tokens then. Assuming the initial context/harness would be max 20k"): every call of the run (actor, reader, judge, input plus output) counts, and a call whose worst case would pass the cap is refused before it is made.
test('the run is one meter: the actor stops first, the reader with it, the judge may use the reserve, and the total never passes the cap', async () => {
  const actor = asks(15_000), reading = asks(20_000, 'mid'), judging = asks(4_000, 'mid');
  const budget = runBudget();
  const act = budget.actor(actor), read = budget.reader(reading), judge = budget.judge(judging);
  assert.equal(RUN_CAP_TOKENS, 250_000);
  let acted = 0;
  for (;;) { try { await act(sized(15_000)); acted++; } catch (error) { assert.match(error.message, new RegExp(CAP_REACHED)); break; } }
  assert.equal(acted, 13, '13 x 15k = 195k; a 14th could pass the 210k the actor may use (250k less the judge reserve) with its worst case');
  await assert.rejects(read(sized(20_000)), /run token cap was reached/);
  assert.equal(reading.calls.length, 0, 'the reader was not asked after the cap');
  let judged = 0;
  for (;;) { try { await judge(sized(4_000)); judged++; } catch (error) { assert.match(error.message, new RegExp(CAP_REACHED)); break; } }
  assert.equal(judged, 13, 'the judge used the reserve (195k + 13 x 4k = 247k)');
  assert.ok(budget.state.total <= RUN_CAP_TOKENS, `the total ${budget.state.total} never passes the cap`);
  assert.equal(budget.state.stoppedAtCap, true);
  assert.equal(actor.calls.length, 13);
});

test('a screenshot is a flat price, not its bytes: a request with a big picture is not refused for its base64', async () => {
  const budget = runBudget(), ask = asks(5_000);
  const picture = {system: 's', messages: [{role: 'user', content: [{type: 'image', source: {type: 'base64', media_type: 'image/png', data: 'A'.repeat(900_000)}}, {type: 'text', text: 'the screen'}]}]};
  await budget.judge(ask)(picture);
  assert.equal(ask.calls.length, 1);
});

test('under the cap the report shows tokens against it with each part; at the cap it says the run stopped there', async () => {
  const under = runBudget();
  await under.actor(asks(60_000))(sized(60_000)); await under.reader(asks(18_000, 'mid'))(sized(18_000)); await under.judge(asks(6_000, 'mid'))(sized(6_000));
  assert.equal(tokensLine(under.state, 'large'), 'Tokens counted toward the run cap: 84k / 250k (actor 60k, screen reader 18k, second opinion 6k). Gross: 84k / 250k cap, including cached input. Actor tier: large.');
  const capped = runBudget({capTokens: 50_000, reserve: 5_000});
  await capped.actor(asks(30_000))(sized(30_000));
  await assert.rejects(capped.actor(asks(30_000))(sized(30_000)), /cap was reached/);
  assert.equal(tokensLine(capped.state, 'small'), 'Stopped at the 50k cap: 30k / 50k counted tokens; the notes made so far are kept (actor 30k, screen reader 0k, second opinion 0k). Gross: 30k / 50k cap, including cached input. Actor tier: small.');
});

test('a refused broker call is not counted and its error reaches the loop, which stops the night as before', async () => {
  const budget = runBudget();
  await assert.rejects(budget.actor(async () => { throw new Error('capped broker: budget'); })(small), /capped broker/);
  assert.equal(budget.state.total, 0);
});

// Guard: money. An answer with no token count must not make the cap blind: it is charged its request plus its text (4 characters a token).
test('an answer with no usage is charged an estimate, so the cap still trips', async () => {
  const blind = async () => ({text: 'x'.repeat(400_000), tier: 'large'});
  const budget = runBudget({capTokens: 100_000, reserve: 0});
  await budget.actor(blind)({system: 's', messages: [{role: 'user', content: 'y'.repeat(4_000)}]});
  assert.ok(budget.state.total >= 100_000, `charged ${budget.state.total}`);
  await assert.rejects(budget.actor(asks(1))(small), /cap was reached/);
});

// Guard: money. The words every actor call carries before the page are measured at the start and a run whose harness alone is over 20k tokens fails before any call (owner, 5 Nov 2026).
test('the fixed part of a call is measured by its largest goal intro and a harness over 20k fails the run at start', () => {
  const schema = {type: 'object'}, system = 'x'.repeat(4_000);
  assert.equal(harnessTokens({system, schema, intros: ['a'.repeat(400), 'b'.repeat(8_000)]}), 1_005 + 2_000, 'system and schema 1005 + the larger intro 2000');
  assert.throws(() => harnessTokens({system, schema, intros: ['c'.repeat(4 * HARNESS_MAX_TOKENS)]}), /harness alone is \d+ tokens, over the 20000/);
  assert.equal(HARNESS_MAX_TOKENS, 20_000);
  assert.equal(harnessTokens({system, schema, intros: []}), 1_005, 'a plan with no goal still measures the instructions');
});

// Guard: money. The broker does not forward max_tokens and the Claude engine counts its thinking as output, and its input count includes a wrapper: after a call that reported more than the estimate, the next worst case is raised by that gap, so a run that sees big answers stops earlier instead of passing the cap.
test('a big answer and a larger input count than the estimate raise the next worst case', async () => {
  const budget = runBudget({capTokens: 70_000, reserve: 0});
  const heavy = async () => ({text: '{}', usage: {input_tokens: 2_000, output_tokens: 30_000}, tier: 'large'});
  await budget.actor(heavy)(small);   // judged on the flat 1,024 headroom: the first call of a run
  await budget.actor(heavy)(small);   // 32k + the 2k gap + a 30k answer = 64k, under 70k
  assert.equal(budget.state.total, 64_000);
  await assert.rejects(budget.actor(heavy)(small), /cap was reached/, 'a third 32k call would end at 96k; the flat 1,024 headroom would have let it through at 65k');
});

test('a refusal by the reader or judge earlier does not relabel a real broker failure as the cap', async () => {
  const state = {capTokens: 250_000, stoppedAtCap: true};
  assert.equal(stoppedLabel(`api: ${CAP_REACHED}`, state), 'stopped at the 250k token cap');
  assert.equal(stoppedLabel('api: 502 broker: unreachable', state), 'api: 502 broker: unreachable');
  assert.equal(stoppedLabel('goals', state), 'goals');
  assert.equal(isCapStop(stoppedLabel(`api: ${CAP_REACHED}`, state)), true);
  assert.equal(isCapStop('api: 502 broker: unreachable'), false);
});

test('a night is on Claude only when a dispatch asks, or when the one-night variable names today; anything else fails the run', () => {
  assert.equal(actorEngineOf({today: '2026-11-06'}), '');
  assert.equal(actorEngineOf({claudeOn: '2026-11-06', today: '2026-11-06'}), 'claude');
  assert.equal(actorEngineOf({claudeOn: '2026-11-06', today: '2026-11-07'}), '', 'the night after goes back to the broker\'s order with nothing to switch off');
  assert.equal(actorEngineOf({requested: 'claude', today: '2026-11-07'}), 'claude');
  assert.throws(() => actorEngineOf({requested: 'Codex'}), /AGENT_ENGINE must be empty or claude, got "Codex"/);
});

test('the report line says the engine, that it is not comparable, steps and tokens per call; a Codex night has none', () => {
  assert.equal(engineLine({engine: 'claude', steps: 40, actorTokens: 224000}), 'Engine: claude, not comparable with Codex nights: 40 steps, 5.6k tokens per actor call.');
  assert.equal(engineLine({engine: '', steps: 14, actorTokens: 224000}), '');
  assert.match(engineLine({engine: 'claude', steps: 0, actorTokens: 0}), /0 steps, 0k tokens/);
});
