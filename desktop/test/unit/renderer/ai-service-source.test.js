// What Settings → Connections names after "AI … Connected ·" (issue #3459: it said "Connected · Anthropic API key" while the Execution engine's API key slot said "Not set").
// Free AI keeps its own token (JPF1.…) in the Anthropic key slot (lib/secrets.js ownSecretsPresent); the slot's pill reads the person's own keys, so the row must name the
// source the same way: Free AI is "Free", never "Anthropic API key" (owner, 2 Nov 2026: "How it can show Connected on the API key if no API is set").
import '../../../i18n/screens-helpers.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {aiSource} from '../../../renderer/service-status.js';
import {ownSecretsPresent} from '../../../lib/secrets.js';

const own = {ANTHROPIC_API_KEY: true}, none = {};

test('Free AI in the key slot (no key of the person\'s own) is named Free, not Anthropic API key', () => {
  assert.equal(aiSource({settings: {aiEngine: 'api', aiFree: true}, secrets: own, ownSecrets: none}), 'free');
  assert.equal(aiSource({settings: {aiFree: true}, secrets: own, ownSecrets: none}), 'free', 'nothing chosen yet: Free is the engine in charge');
});

test('a key the person saved is named Anthropic API key; the other engines keep their own names', () => {
  assert.equal(aiSource({settings: {aiEngine: 'api'}, secrets: own, ownSecrets: own}), 'api');
  assert.equal(aiSource({settings: {}, secrets: own, ownSecrets: own}), 'api', 'an install from before the choice existed');
  assert.equal(aiSource({settings: {aiEngine: 'cli'}, secrets: own, ownSecrets: none}), 'cli', 'a Claude plan chosen later wins over the token left in the slot');
  assert.equal(aiSource({settings: {aiEngine: 'codex'}, secrets: none, ownSecrets: none}), 'codex');
  assert.equal(aiSource({settings: {aiEngine: 'openai'}, secrets: {OPENAI_API_KEY: true}, ownSecrets: {OPENAI_API_KEY: true}}), 'openai');
});

test('an old state with no ownSecrets reads the plain secrets, like every other reader (ai-engine-view.js ownKeys)', () => {
  assert.equal(aiSource({settings: {aiEngine: 'api'}, secrets: own}), 'api');
});

test('the services row uses it: no unconditional "Anthropic API key" fallback is left in settings.js', () => {
  const page = fs.readFileSync(new URL('../../../renderer/pages/settings.js', import.meta.url), 'utf8');
  assert.match(page, /aiSource\(shared\.state\)/);
  assert.doesNotMatch(page, /\|\| t\('pagesFinalLabels\.anthropicApiKey'\)/, 'the fallback named every non-plan engine "Anthropic API key", Free AI included');
});

test('the real producer: Free AI\'s JPF1/JP1 token through lib/secrets.js ownSecretsPresent is "free", a sk-ant key is "api"', () => {
  const state = (token, settings) => {
    const storage = {secretsPresent: () => ({ANTHROPIC_API_KEY: true}), secret: () => token};
    return {settings, secrets: storage.secretsPresent(), ownSecrets: ownSecretsPresent(storage)};
  };
  assert.equal(aiSource(state('JPF1.install.token', {aiEngine: 'api', aiFree: true})), 'free');
  assert.equal(aiSource(state('JP1.credit.token', {aiTrial: true})), 'free', 'the older credit key');
  assert.equal(aiSource(state('sk-ant-api03-own', {aiEngine: 'api'})), 'api');
});
