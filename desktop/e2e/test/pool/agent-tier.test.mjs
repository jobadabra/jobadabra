// The AI user agent's acting tier and its nightly cap: a night acts on the large tier, a replay on small, and a large night that used its share of the Codex week finishes on small and says so.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {actorTierOf, cappedAsk, NIGHT_CAP_TOKENS, tierLine} from '../../lib/agent-tier.mjs';

const answer = (tokens, tier) => ({text: '{}', usage: {input_tokens: tokens - 100, output_tokens: 100}, tier});
const asks = (tokens, tier) => { const calls = []; const ask = async args => { calls.push(args); return answer(tokens, tier); }; ask.calls = calls; return ask; };

test('a night acts on the large tier, a replay or a run with no kind on small, and what a dispatch asked for wins', () => {
  assert.deepEqual([actorTierOf({kind: 'night'}), actorTierOf({kind: 'replay'}), actorTierOf({requested: 'mid', kind: 'night'}), actorTierOf({requested: 'large', kind: 'replay'}), actorTierOf()], ['large', 'small', 'mid', 'large', 'small']);
});

// Guard: money. The nightly large tier has a ceiling the run keeps by itself: 2% of the Codex week is about 1.44M tokens (owner, 5 Nov 2026: "Large, with a cost cap"); past it every call goes to the fallback tier.
test('the large tier runs until the cap, the call that crosses it finishes, and every call after it runs on small', async () => {
  const primary = asks(500_000, 'large'), fallback = asks(10_000, 'small');
  const {ask, state} = cappedAsk({primary, fallback, tier: 'large'});
  assert.equal(NIGHT_CAP_TOKENS, 1_440_000);
  for (let i = 0; i < 5; i++) await ask({n: i});
  assert.equal(primary.calls.length, 3, '500k x 3 = 1.5M crosses 1.44M on the third call, which finishes');
  assert.equal(fallback.calls.length, 2);
  assert.deepEqual([state.used, state.calls, state.fellBackAtCall], [1_500_000, 5, 4]);
  assert.match(tierLine(state), /until the large-tier cap \(1,440k tokens, 2% of the Codex week\) was reached; from the actor's call 4 the rest of the night ran on small \(large used 1,500k tokens\)/);
});

test('a night under the cap never touches the fallback and reports its share; small and mid are not capped', async () => {
  const primary = asks(40_000, 'large'), fallback = asks(1, 'small');
  const under = cappedAsk({primary, fallback, tier: 'large'});
  for (let i = 0; i < 3; i++) await under.ask({});
  assert.equal(fallback.calls.length, 0);
  assert.equal(tierLine(under.state), 'Actor tier: large, 120k of 1,440k tokens (the large-tier cap, 2% of the Codex week).');
  const small = cappedAsk({primary: asks(5_000_000, 'small'), fallback, tier: 'small'});
  for (let i = 0; i < 3; i++) await small.ask({});
  assert.equal(fallback.calls.length, 0);
  assert.equal(tierLine(small.state), 'Actor tier: small.');
});

test('a refused call is not counted and its error reaches the loop, which stops the night as before', async () => {
  const {ask, state} = cappedAsk({primary: async () => { throw new Error('capped broker: budget'); }, fallback: asks(1, 'small'), tier: 'large'});
  await assert.rejects(ask({}), /capped broker/);
  assert.equal(state.used, 0);
});

// Guard: money. An answer with no token count must not make the cap blind: it is charged an estimate (4 characters a token).
test('an answer with no usage is charged an estimate, so the cap still trips', async () => {
  const blind = async () => ({text: 'x'.repeat(400_000), tier: 'large'}), fallback = asks(1, 'small');
  const {ask, state} = cappedAsk({primary: blind, fallback, tier: 'large', capTokens: 100_000});
  await ask({system: 's', messages: [{role: 'user', content: 'y'.repeat(4_000)}]});
  assert.ok(state.used >= 100_000, `charged ${state.used}`);
  await ask({});
  assert.equal(fallback.calls.length, 1);
});
