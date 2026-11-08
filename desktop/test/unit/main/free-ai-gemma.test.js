// The app's Free AI runs every step on Gemma 4 except the rejection review (gpt-oss-120b), and asks for JSON in the prompt (desktop/lib/free-ai-models.js, free-ai-translate.js). One test per rule.
// Why (8 Nov 2026, fr; owner: "Gemma 4 for every ask", "Open it now"): Qwen3-30B and glm-5.3-flash stop on 20 Nov 2026 (HTTP 410), and Gemma 4 with a forced response_format looped on blank lines (extraction 0% valid).
// Offline: pure functions only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {OSS, QWEN3, SMALL, STRONG, STRONG_STEPS, costUsd, modelFor} from '../../../lib/free-ai-models.js';
import {MIN_JSON_TOKENS, REASONING_ROOM, fromWorkersAi, stripFence, toWorkersAi} from '../../../lib/free-ai-translate.js';

const noPdf = async () => { throw new Error('no pdf'); };
const SCHEMA = {type: 'object', required: ['score'], properties: {score: {type: 'number'}}};
const ask = {max_tokens: 300, system: [{type: 'text', text: 'Score the job.'}], messages: [{role: 'user', content: 'Job: baker.'}], output_config: {format: {type: 'json_schema', schema: SCHEMA}}};
const answer = text => ({choices: [{message: {content: text}, finish_reason: 'stop'}], usage: {prompt_tokens: 10, completion_tokens: 5}});

test('rule 1, the table: every step runs on Gemma 4, the rejection review on gpt-oss-120b', () => {
  assert.equal(SMALL, '@cf/google/gemma-4-26b-a4b-it'); assert.equal(STRONG, SMALL);
  for (const action of [...STRONG_STEPS, 'score', 'extract', '', 'other']) assert.equal(modelFor(action, {}), action === 'review' ? OSS : SMALL, action);
  assert.equal(modelFor('kit', {STRONG_ON: 'on'}), SMALL, 'the strong switch stays harmless');
  assert.equal(modelFor('review', {STEP_MODELS: 'off'}), SMALL);
});

test('rule 2, a schema ask on Gemma 4: thinking off, no response_format, the schema in the last user message, max_tokens at least MIN_JSON_TOKENS and no reasoning room on top', async () => {
  const sent = await toWorkersAi(ask, noPdf, 'score');
  assert.equal(sent.response_format, undefined);
  assert.deepEqual(sent.chat_template_kwargs, {enable_thinking: false});
  assert.equal(sent.max_tokens, MIN_JSON_TOKENS, 'a 300-token caller (format-judge, missing-facts, zone-suggest) gets the floor, not a cut JSON answer; no reasoning room on top: it does not think');
  assert.equal((await toWorkersAi({...ask, max_tokens: 4000}, noPdf, 'score')).max_tokens, 4000, 'a bigger limit stays as asked');
  assert.deepEqual(sent.messages[0], {role: 'system', content: 'Score the job.'});
  assert.equal(sent.messages.at(-1).content, `Job: baker.\n\nReply with ONE JSON object only, no other text, matching this JSON schema exactly: ${JSON.stringify(SCHEMA)}`);
  assert.equal(sent.temperature, 0, 'a reading step still answers at temperature 0');
});

test('rule 3, an ask with no schema on Gemma 4 keeps its prompt as written; one with no user message gets the schema as one', async () => {
  const plain = await toWorkersAi({messages: [{role: 'user', content: 'Write a line.'}]}, noPdf, 'kit');
  assert.equal(plain.messages.at(-1).content, 'Write a line.'); assert.equal(plain.max_tokens, 1024); assert.deepEqual(plain.chat_template_kwargs, {enable_thinking: false});
  const bare = await toWorkersAi({system: 'Be brief.', messages: [], output_config: {format: {type: 'json_schema', schema: SCHEMA}}}, noPdf, 'score');
  assert.equal(bare.messages.at(-1).role, 'user'); assert.match(bare.messages.at(-1).content, /JSON schema exactly/);
});

test('rule 4, the other models keep the forced schema and the reasoning room: gpt-oss-120b (the review) and the old Qwen3', async () => {
  for (const model of [OSS, QWEN3]) {
    const sent = await toWorkersAi(ask, noPdf, 'review', model);
    assert.equal(sent.response_format.json_schema.schema.type, 'object', model);
    assert.equal(sent.max_tokens, 300 + REASONING_ROOM, model); assert.equal(sent.chat_template_kwargs, undefined, model);
    assert.equal(sent.messages.at(-1).content, 'Job: baker.', model);
  }
  assert.equal((await toWorkersAi(ask, noPdf, 'review')).response_format.json_schema.schema.type, 'object', 'the review step defaults to its own model');
});

test('rule 5, the reply: a fence around JSON is stripped for Gemma 4 only when the ask wanted JSON, and prose is never touched', () => {
  const fenced = answer('```json\n{"score": 71}\n```');
  assert.equal(fromWorkersAi(fenced, SMALL, true).content[0].text, '{"score": 71}');
  assert.equal(fromWorkersAi(fenced, SMALL).content[0].text, '```json\n{"score": 71}\n```', 'no JSON asked: as written');
  assert.equal(fromWorkersAi(fenced, OSS, true).content[0].text, '```json\n{"score": 71}\n```', 'another model: as written');
  assert.equal(fromWorkersAi(answer('<think>hm</think>{"a":1}'), QWEN3).content[0].text, '{"a":1}', 'reasoning text still never reaches the caller');
  assert.equal(stripFence('```json\n{"a": "```"}\n```'), '{"a": "```"}'); assert.equal(stripFence('  ```\n[1]\n```  '), '[1]'); assert.equal(stripFence('{"a": 1}'), '{"a": 1}');
});

test('rule 6, a reply that loops on blank lines is stripped in linear time (a trailing-fence regex took 6.5 s on 60,000 newlines)', () => {
  const started = Date.now();
  stripFence('{"a":1}' + '\n'.repeat(200_000) + 'x'); stripFence('```json\n' + ' '.repeat(200_000) + '```');
  assert.ok(Date.now() - started < 500, `${Date.now() - started} ms`);
});

test('rule 7, the price: Gemma 4 at Cloudflare\'s list price, the old models still priced for the cost history', () => {
  assert.equal(costUsd(SMALL, {input_tokens: 1e6, output_tokens: 1e6}), 0.4);
  assert.equal(costUsd(QWEN3, {input_tokens: 1e6, output_tokens: 0}), 0.0509);
  assert.equal(costUsd('@cf/zai-org/glm-5.3-flash', {input_tokens: 1e6, output_tokens: 1e6}), 0.65);
});
