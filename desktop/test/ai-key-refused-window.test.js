// What the window says when the provider refused the saved AI key (Windows tester on 0.9.2, 3 Nov 2026: Connections said "Connected · Anthropic API key" while every AI step
// failed with 401, and the portrait sat on "Updating soon"). state().settings.aiKeyBad comes from lib/ai-key-health.js; Connections and the portrait read the same flag.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

install();
globalThis.window.pilot = new Proxy({state: async () => ({settings: {}, secrets: {}})}, {get: (all, key) => all[key] || (() => null)});
const {aiService, keyRow} = await import('../renderer/service-status.js');
const {portraitView} = await import('../renderer/pages/portrait.js');
const fs = await import('node:fs');

test('Connections: a saved key the provider refused is not "Connected"; it says so and what to do', () => {
  assert.deepEqual(aiService(true, false), {on: true, words: ''});
  assert.deepEqual(aiService(true, true), {on: false, words: 'Key refused · paste a new one'});
  assert.deepEqual(aiService(false, true), {on: false, words: ''}, 'no key at all stays "Not connected"');
  const page = fs.readFileSync(new URL('../renderer/pages/settings.js', import.meta.url), 'utf8');
  assert.match(page, /aiService\(aiReady\(\), shared\.state\.settings\.aiKeyBad\)/, 'the card reads the one flag');
  assert.match(page, /ai: ai\.words/);
  const keyRowSource = fs.readFileSync(new URL('../renderer/pages/profile.js', import.meta.url), 'utf8');
  assert.match(keyRowSource, /keyRow\(line\.dataset\.secret, set, shared\.state\.settings\.aiKeyBad\)/, 'the key rows read the one flag');
});

test('Portrait: an outdated text with a note says it is not updated and why, instead of "Updating soon"', () => {
  const status = {state: 'outdated', sections: [{title: 'Who you are', statements: [{text: 'A careful accountant.', evidence: []}]}], evidence: {}, letter: [], updated: '3 Nov'};
  const plain = portraitView(status, {}).textContent;
  assert.match(plain, /Updating soon/);
  const refused = portraitView(status, {note: 'Your AI key was refused. Paste a working key in Settings → Connections → AI.'});
  assert.match(refused.textContent, /Not updated/);
  assert.doesNotMatch(refused.textContent, /Updating soon/);
});

test('Connections → AI key rows: only the refused key says "Key refused"; the other set key stays Connected (Gitar, #3035)', () => {
  assert.deepEqual(keyRow('OPENAI_API_KEY', true, 'OPENAI_API_KEY'), {text: 'Key refused · paste a new one', on: false});
  assert.deepEqual(keyRow('ANTHROPIC_API_KEY', true, 'OPENAI_API_KEY'), {text: '✓ Connected', on: true}, 'an OpenAI refusal leaves the Anthropic row alone');
  assert.deepEqual(keyRow('ANTHROPIC_API_KEY', true, ''), {text: '✓ Connected', on: true});
  assert.deepEqual(keyRow('OPENAI_API_KEY', false, 'OPENAI_API_KEY'), {text: 'Not set', on: false});
});
