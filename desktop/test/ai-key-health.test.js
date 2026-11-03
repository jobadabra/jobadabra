// One owner for "does the user's AI key work" (lib/ai-key-health.js; Windows tester on 0.9.2, 3 Nov 2026: Connections said "Connected · Anthropic API key" while every AI step
// failed with 401 "invalid x-api-key"). The adapters report what the provider answered; the verdict is kept per key, so a new key or another engine ends it by itself. Fake keys only.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {keyHealth, watchKeyHealth} from '../lib/ai-key-health.js';
import {AnthropicApi} from '../lib/ai/anthropic-api.js';
import {OpenAiApi} from '../lib/ai/openai-api.js';

const storage = (secrets = {}) => {
  let settings = {};
  return {settings: () => settings, saveSettings: patch => { settings = {...settings, ...patch}; }, secret: name => secrets[name] || '', setSecret: (name, value) => { secrets[name] = value; }};
};
const refuse = () => ({messages: {create: async () => { throw Object.assign(new Error('401 {"error":{"message":"invalid x-api-key"}}'), {status: 401}); }}});
const accept = () => ({messages: {create: async () => ({content: [{type: 'text', text: 'ok'}], usage: {}})}});
const ask = adapter => adapter.complete({params: {model: 'm', max_tokens: 1, messages: [{role: 'user', content: 'hi'}]}});

test('a 401 on the user\'s own Anthropic key marks it refused (once), a good answer from the same key clears it', async () => {
  const store = storage({ANTHROPIC_API_KEY: 'sk-ant-fake-one'}), told = [];
  const stop = watchKeyHealth(() => store, {onRejected: engine => told.push(engine), now: () => '2026-11-03T02:00:00.000Z'});
  assert.equal(keyHealth(store, 'api').rejected, false, 'nothing heard yet: not refused');
  await assert.rejects(ask(new AnthropicApi({apiKey: 'sk-ant-fake-one', sdk: refuse()})), /invalid x-api-key/);
  assert.deepEqual(keyHealth(store, 'api'), {rejected: true, engine: 'api', at: '2026-11-03T02:00:00.000Z'});
  await assert.rejects(ask(new AnthropicApi({apiKey: 'sk-ant-fake-one', sdk: refuse()})));
  assert.deepEqual(told, ['api'], 'the window is told once, not on every failed step');
  assert.ok(!JSON.stringify(store.settings()).includes('fake-one'), 'the key itself is never stored in settings');
  await ask(new AnthropicApi({apiKey: 'sk-ant-fake-one', sdk: accept()}));
  assert.equal(keyHealth(store, 'api').rejected, false, 'a good answer from the same key clears it');
  stop();
});

test('pasting a new key, or choosing another engine, ends the verdict with no clearing step', async () => {
  const secrets = {ANTHROPIC_API_KEY: 'sk-ant-fake-one'}, store = storage(secrets);
  const stop = watchKeyHealth(() => store);
  await assert.rejects(ask(new AnthropicApi({apiKey: 'sk-ant-fake-one', sdk: refuse()})));
  assert.equal(keyHealth(store, 'api').rejected, true);
  assert.equal(keyHealth(store, 'cli').rejected, false, 'Claude Code (your plan) is another engine');
  secrets.ANTHROPIC_API_KEY = 'sk-ant-fake-two';
  assert.equal(keyHealth(store, 'api').rejected, false, 'a different key is not the refused one');
  stop();
});

test('Free AI\'s key and a 429 are not "your key was refused"; an OpenAI 401 is', async () => {
  const store = storage({OPENAI_API_KEY: 'sk-fake-oa'}), told = [];
  const stop = watchKeyHealth(() => store, {onRejected: engine => told.push(engine)});
  await assert.rejects(ask(new AnthropicApi({apiKey: 'JPF1.inst.tok', sdk: refuse()})));
  const limited = {messages: {create: async () => { throw Object.assign(new Error('slow down'), {status: 429}); }}};
  await assert.rejects(ask(new AnthropicApi({apiKey: 'sk-ant-fake-one', sdk: limited})));
  assert.deepEqual(told, []);
  const openai = new OpenAiApi({apiKey: 'sk-fake-oa', sdk: {responses: {create: async () => { throw Object.assign(new Error('bad key'), {status: 401}); }}}});
  await assert.rejects(openai.create({model: 'm', max_tokens: 5, messages: [{role: 'user', content: 'hi'}]}), /refused the API key/);
  assert.deepEqual(told, ['openai']);
  assert.equal(keyHealth(store, 'openai').rejected, true);
  stop();
});

test('the streaming path (the strategy draft) tells the verdict too, and a second watch replaces the first', async () => {
  const store = storage({ANTHROPIC_API_KEY: 'sk-ant-fake-one'}), told = [];
  watchKeyHealth(() => store, {onRejected: () => told.push('first')});
  const stop = watchKeyHealth(() => store, {onRejected: () => told.push('second')});
  const stream = failing => ({finalMessage: () => (failing ? Promise.reject(Object.assign(new Error('401'), {status: 401})) : Promise.resolve({content: []}))});
  const adapter = failing => new AnthropicApi({apiKey: 'sk-ant-fake-one', sdk: {messages: {create: async () => ({}), stream: () => stream(failing)}}});
  const params = {model: 'm', max_tokens: 1, messages: [{role: 'user', content: 'hi'}]};
  await assert.rejects(adapter(true).messages.stream(params).finalMessage());
  assert.deepEqual(told, ['second'], 'one watcher, not two');
  assert.equal(keyHealth(store, 'api').rejected, true);
  await adapter(false).messages.stream(params).finalMessage();
  assert.equal(keyHealth(store, 'api').rejected, false);
  stop();
});
