// The AI user agent's acting tier and its nightly cap: a night acts on the large tier, a replay on small, and a large night that used its share of the Codex week finishes on small and says so.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {actorTierOf, nightBudget, NIGHT_CAP_TOKENS, tierLine} from '../../lib/agent-tier.mjs';

const answer = (tokens, tier) => ({text: '{}', usage: {input_tokens: tokens - 100, output_tokens: 100}, tier});
const asks = (tokens, tier) => { const calls = []; const ask = async args => { calls.push(args); return answer(tokens, tier); }; ask.calls = calls; return ask; };

test('a night acts on the large tier, a replay or a run with no kind on small, and what a dispatch asked for wins', () => {
  assert.deepEqual([actorTierOf({kind: 'night'}), actorTierOf({kind: 'replay'}), actorTierOf({requested: 'mid', kind: 'night'}), actorTierOf({requested: 'large', kind: 'replay'}), actorTierOf()], ['large', 'small', 'mid', 'large', 'small']);
});

// Guard: money. The nightly large tier has a ceiling of 2% of the Codex week (about 1.44M tokens) for the WHOLE night: the actor, the screen reader and the second opinion are counted together (owner, 5 Nov 2026: "Large, with a cost cap"; coordinator: "the reader's mid-tier calls included").
test('the whole night is one meter: at the cap the actor falls to small and the reader stops, and the report shows each part', async () => {
  const primary = asks(500_000, 'large'), fallback = asks(10_000, 'small'), reading = asks(100_000, 'mid'), judging = asks(20_000, 'mid');
  const budget = nightBudget({tier: 'large'});
  const actor = budget.actor(primary, fallback), reader = budget.reader(reading), judge = budget.judge(judging);
  assert.equal(NIGHT_CAP_TOKENS, 1_440_000);
  await actor({}); await reader({}); await actor({});   // 500k + 100k + 500k = 1.1M
  await actor({});                                       // 1.6M: this call crosses the cap and finishes
  await assert.rejects(reader({}), /night token cap was reached/);
  await actor({});                                       // on small now
  await judge({});                                       // the second opinion still answers
  assert.equal(primary.calls.length, 3);
  assert.equal(fallback.calls.length, 1);
  assert.equal(reading.calls.length, 1, 'the reader was not asked after the cap');
  assert.equal(judging.calls.length, 1);
  const {state} = budget;
  assert.deepEqual([state.used.actor, state.used.reader, state.used.judge, state.total, state.fellBackAtCall, state.readerStopped], [1_510_000, 100_000, 20_000, 1_630_000, 4, 1]);
  assert.equal(tierLine(state), 'Night tokens: the cap (1,440k tokens, 2% of the Codex week) was reached; from the actor\'s call 4 the actor ran on small and the screen reader stopped (1 read skipped). Total 1,630k (actor 1,510k, screen reader 100k, second opinion 20k).');
});

test('the reader\'s tokens count against the actor: a night whose reader spends the cap sends the actor to small', async () => {
  const primary = asks(1_000, 'large'), fallback = asks(1_000, 'small');
  const budget = nightBudget({tier: 'large'});
  await budget.reader(asks(1_440_000, 'mid'))({});
  await budget.actor(primary, fallback)({});
  assert.deepEqual([primary.calls.length, fallback.calls.length], [0, 1]);
});

test('a night under the cap never touches the fallback and reports its parts; small and mid are not capped', async () => {
  const primary = asks(40_000, 'large'), fallback = asks(1, 'small');
  const under = nightBudget({tier: 'large'});
  const actor = under.actor(primary, fallback);
  for (let i = 0; i < 3; i++) await actor({});
  await under.reader(asks(30_000, 'mid'))({});
  await under.judge(asks(10_000, 'mid'))({});
  assert.equal(fallback.calls.length, 0);
  assert.equal(tierLine(under.state), 'Night tokens: 160k of 1,440k (actor 120k, screen reader 30k, second opinion 10k); the actor ran on large; cap = 1,440k tokens, 2% of the Codex week.');
  const small = nightBudget({tier: 'small'}), spendy = small.actor(asks(5_000_000, 'small'), fallback);
  for (let i = 0; i < 3; i++) await spendy({});
  await small.reader(asks(5_000_000, 'mid'))({});
  assert.equal(fallback.calls.length, 0);
  assert.equal(tierLine(small.state), 'Actor tier: small.');
});

test('a refused call is not counted and its error reaches the loop, which stops the night as before', async () => {
  const budget = nightBudget({tier: 'large'});
  await assert.rejects(budget.actor(async () => { throw new Error('capped broker: budget'); }, asks(1, 'small'))({}), /capped broker/);
  assert.equal(budget.state.total, 0);
});

// Guard: money. An answer with no token count must not make the cap blind: it is charged an estimate (4 characters a token).
test('an answer with no usage is charged an estimate, so the cap still trips', async () => {
  const blind = async () => ({text: 'x'.repeat(400_000), tier: 'large'}), fallback = asks(1, 'small');
  const budget = nightBudget({tier: 'large', capTokens: 100_000});
  const actor = budget.actor(blind, fallback);
  await actor({system: 's', messages: [{role: 'user', content: 'y'.repeat(4_000)}]});
  assert.ok(budget.state.total >= 100_000, `charged ${budget.state.total}`);
  await actor({});
  assert.equal(fallback.calls.length, 1);
});
