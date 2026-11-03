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
