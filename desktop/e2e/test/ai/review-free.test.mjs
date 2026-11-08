// The screenshot eval's same-problem judge (lib/review-free.mjs) moved off Qwen3-30B (stops 20 Nov 2026) onto Gemma 4. One test per rule.
// Why (8 Nov 2026, fr; mac-9d): Gemma 4 answers in OpenAI choices over REST, while Llama answers in the response field, and Gemma thinks unless told not to; reading only the response field made every judge answer empty.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {askFree, judgeVerdict, toWorkersAi} from '../../lib/review-free.mjs';
import {SMALL} from '../../../lib/free-ai-models.js';

const request = {system: [{type: 'text', text: 'Judge.'}], messages: [{role: 'user', content: [{type: 'text', text: 'EARLIER vs NEW'}]}]};
const open = {capped: false};
const reply = result => async () => new Response(JSON.stringify({success: true, result}), {status: 200});
const ask = (model, result) => askFree(request, {token: 't', account: 'a', model, cap: async () => open, fetchImpl: reply(result)});

test('rule 1, a Gemma 4 judge is asked with thinking off; a vision model is asked as before', () => {
  assert.deepEqual(toWorkersAi(request, SMALL).chat_template_kwargs, {enable_thinking: false});
  assert.equal(toWorkersAi(request).chat_template_kwargs, undefined, 'the default (Llama vision) request has no template flag');
  assert.equal(toWorkersAi(request, SMALL).temperature, 0);
});

test('rule 2, the answer is read from OpenAI choices (Gemma 4, Qwen3) or from result.response (Llama), and a "same" verdict survives both', async () => {
  const gemma = await ask(SMALL, {choices: [{message: {content: '{"same": true}'}}], usage: {prompt_tokens: 57, completion_tokens: 6}});
  assert.equal(gemma.message.content[0].text, '{"same": true}');
  assert.equal(judgeVerdict(gemma).same, true);
  assert.equal(judgeVerdict(await ask(SMALL, {choices: [{message: {content: '```json\n{"same": false}\n```'}}]})).same, false, 'a fenced answer is read, not failed');
  assert.equal(judgeVerdict(await ask('@cf/meta/llama-4-scout-17b-16e-instruct', {response: '{"same": true}'})).same, true);
});

test('rule 3, Gemma 4 is priced at Cloudflare\'s list price, so a judged run shows its cost', async () => {
  const answer = await ask(SMALL, {choices: [{message: {content: '{"same": true}'}}], usage: {prompt_tokens: 1e6, completion_tokens: 1e6}});
  assert.equal(answer.usd, 0.4);
});
