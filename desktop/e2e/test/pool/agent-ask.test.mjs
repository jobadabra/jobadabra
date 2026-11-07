// The AI user agent's broker asks: the acting call goes down the broker's normal chain, the second opinion asks for Claude alone, and a refused Claude-only call is a judge that is unavailable, not a spent budget that greys the step.
import test from 'node:test';
import assert from 'node:assert/strict';
import {brokerAsk} from '../../lib/agent-ask.mjs';
import {toBrokerCall} from '../../lib/broker-client.mjs';
import {takeCapped} from '../../lib/ai-cap.mjs';

const input = {system: 'sys', messages: [{role: 'user', content: 'hi'}], schema: {type: 'object'}};
const answered = {ok: true, message: {content: [{text: '{"verdict":"agrees","reason":"ok"}'}], usage: {}}, ms: 5, tier: 'mid', engine: 'claude'};

test('the acting call names no engine; the second opinion names Claude and only Claude, and the broker body keeps both fields', async () => {
  const sent = [];
  const ask = async body => { sent.push(body); return answered; };
  await brokerAsk('small', {ask})(input);
  await brokerAsk('mid', {only: 'claude', ask})(input);
  assert.equal(sent[0].engine, undefined);
  assert.equal(sent[0].only, undefined);
  assert.deepEqual([sent[1].engine, sent[1].only, sent[1].model], ['claude', true, 'claude-sonnet-5-5']);
  assert.deepEqual([toBrokerCall(sent[1]).engine, toBrokerCall(sent[1]).only], ['claude', true]);
  assert.deepEqual([toBrokerCall(sent[0]).engine, toBrokerCall(sent[0]).only], [undefined, undefined]);
  assert.equal(toBrokerCall({...sent[1], only: undefined}).only, undefined, 'only without a flag is not sent');
});

test('a Claude-only call the broker refuses throws without greying the step; a refused acting call still greys it', async () => {
  takeCapped();
  const refused = async () => ({ok: false, status: 'capped', detail: 'broker: only-claude: ran-out'});
  await assert.rejects(brokerAsk('mid', {only: 'claude', ask: refused})(input), /capped broker: only-claude: ran-out/);
  assert.equal(takeCapped(), null, 'the judge being unavailable does not mark the night as capped');
  await assert.rejects(brokerAsk('small', {ask: refused})(input), /capped/);
  assert.ok(takeCapped(), 'an acting call the broker refuses still ends the night with the alert');
});

// Why (7 Nov 2026, pz): the persona night lost goals to "502 broker: codex-failed … killed after 100 s" and "unreachable …" (12 of 122 goals, 31 runs); the failed call is asked again on Claude and the night stays there.
test('a broker failure of the acting call goes to Claude at once and stays there; a decision of the broker does not', async () => {
  const {withFailover, isBrokerFailure} = await import('../../lib/agent-ask.mjs');
  for (const message of ['502 broker: codex-failed:1 killed after 100 s', 'unreachable no answer from the broker: fetch failed after 180 s', '500 broker: x']) assert.ok(isBrokerFailure(new Error(message)), message);
  for (const message of ['capped broker: budget: day', '401 broker: login-lost', '429 broker: slow down', 'api: the run token cap was reached']) assert.ok(!isBrokerFailure(new Error(message)), message);
  const calls = [], codex = async args => { calls.push(['codex', args]); throw new Error('502 broker: codex-failed:1 killed after 100 s'); };
  const claude = async args => { calls.push(['claude', args]); return answered; };
  const ask = withFailover(codex, claude);
  assert.equal(ask.failover(), '');
  assert.equal(await ask({...input, session: 's', delta: 'd', endSession: true}), answered);
  assert.match(ask.failover(), /codex-failed/);
  assert.deepEqual(calls.map(call => call[0]), ['codex', 'claude']);
  assert.deepEqual(Object.keys(calls[1][1]).sort(), ['messages', 'schema', 'system'], 'Claude gets the whole prompt and no Codex conversation fields');
  await ask(input);
  assert.deepEqual(calls.map(call => call[0]), ['codex', 'claude', 'claude'], 'a Codex that failed once is not asked again tonight');
  const refused = withFailover(async () => { throw new Error('capped broker: budget: day'); }, claude);
  await assert.rejects(refused(input), /capped/);
  assert.equal(refused.failover(), '', 'a budget refusal is not a failover');
  const both = withFailover(codex, async () => { throw new Error('502 broker: claude down'); });
  await assert.rejects(both(input), /claude down/);
});

test('an acting call pinned to Claude still raises the capped alert (a night that moved to Claude); the judge\'s does not', async () => {
  takeCapped();
  const refused = async () => ({ok: false, status: 'capped', detail: 'broker: only-claude: ran-out'});
  await assert.rejects(brokerAsk('mid', {only: 'claude', acting: true, ask: refused})(input), /capped/);
  assert.ok(takeCapped(), 'the actor on Claude alone ends the night with the alert');
  const {actorAskOf} = await import('../../lib/agent-ask.mjs');
  assert.equal(typeof actorAskOf('small', 'claude'), 'function');
});
