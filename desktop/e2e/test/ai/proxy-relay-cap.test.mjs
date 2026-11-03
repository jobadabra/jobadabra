// Guard: money — the refill's per-row cap of paid calls (lib/refill.mjs ROW_MAX_CALLS) must hold on the broker relay too, else one row can drain the Codex budget; a broker "no" is counted for the out-of-credits check.
// Why (3 Nov 2026, replay-refill moved from its API key to the AI broker): the cap was checked only on the API path, after the relay branch returned.
// Job: serve stored answers
import test from 'node:test';
import assert from 'node:assert/strict';
import {startAiProxy} from '../../lib/ai-proxy.mjs';
import {outOfCredits} from '../../lib/refill.mjs';
import {apiErrors} from '../../lib/ai-meter.mjs';

const ASK = JSON.stringify({model: 'claude-haiku-5-5', max_tokens: 20, messages: [{role: 'user', content: 'hi'}]});
const ask = proxy => fetch(`${proxy.url}/v1/messages`, {method: 'POST', headers: {'content-type': 'application/json'}, body: ASK});
const answer = text => ({status: 200, contentType: 'application/json', counted: JSON.stringify({usage: {input_tokens: 1, output_tokens: 1}}), body: Buffer.from(JSON.stringify({type: 'message', content: [{type: 'text', text}]}))});

test('a relay row stops at its cap of calls: the next one never reaches the broker', async t => {
  let reached = 0;
  const proxy = await startAiProxy({live: true, maxCalls: 2, relay: async () => { reached++; return answer('ok'); }});
  t.after(() => proxy.close());
  const statuses = [];
  for (let n = 0; n < 4; n++) statuses.push((await ask(proxy)).status);
  assert.deepEqual([statuses, reached], [[200, 200, 400, 400], 2]);
});

test('a broker "no" is counted as a refusal, and the refill reads it as out of room', async t => {
  const refusal = {status: 503, contentType: 'application/json', body: Buffer.from(JSON.stringify({type: 'error', error: {type: 'api_error', message: 'ai-capped: the AI broker said no (Codex budget)'}}))};
  const proxy = await startAiProxy({live: true, maxCalls: 5, relay: async () => refusal});
  t.after(() => proxy.close());
  assert.equal((await ask(proxy)).status, 503);
  assert.equal(outOfCredits(apiErrors()), true);
});
