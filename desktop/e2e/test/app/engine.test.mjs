// Guard: money — a run on a Mac loads an Anthropic key and spends on it instead of the plan or the broker.
// Which AI engine the app under test uses. THE RULE (owner, 5 Oct 2026): the e2e key is for CI only. A Mac runs the app, the judges and the explorer on its own Claude Code (the
// plan's fixed price); no suite loads, reads or spends an Anthropic key there. A step the AI proxy answers runs on the API engine with a placeholder key.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {appKey, appModelEnv, DUMMY_KEY, isCi, pickEngine, testKey} from '../../lib/engine.mjs';

const yes = () => true, no = () => false;

test('CI uses the API key; a Mac uses Claude Code', () => {
  assert.equal(pickEngine({env: {CI: 'true'}, installed: yes}), 'api');
  assert.equal(pickEngine({env: {}, installed: yes}), 'cli');
});

test('a Mac without Claude Code stops with a clear message instead of falling back to a key', () => {
  assert.throws(() => pickEngine({env: {}, installed: no}), /Claude Code is not installed/);
});

test('a suite that pins the API keeps it (its steps are answered by the proxy); E2E_AI_ENGINE=api is refused on a Mac', () => {
  assert.equal(pickEngine({env: {}, suiteEngine: 'api', installed: yes}), 'api');
  assert.throws(() => pickEngine({env: {E2E_AI_ENGINE: 'api'}, installed: yes}), /CI only/);
  assert.equal(pickEngine({env: {E2E_AI_ENGINE: 'cli', CI: 'true'}, installed: yes}), 'cli');
  assert.throws(() => pickEngine({env: {E2E_AI_ENGINE: 'gpt'}, installed: yes}), /E2E_AI_ENGINE/);
});

test('the test key is empty on a Mac whatever the environment holds; in CI it is the placeholder under Codex and never an Anthropic key', () => {
  assert.equal(testKey({E2E_ANTHROPIC_KEY: 'sk-ant-real'}), '');
  assert.equal(testKey({CI: 'true', CI_AI_PROVIDER: 'codex', E2E_ANTHROPIC_KEY: 'sk-ant-real'}), DUMMY_KEY, 'Codex: the broker relay answers, the app holds the placeholder');
  assert.equal(testKey({CI: 'true', E2E_ANTHROPIC_KEY: 'sk-ant-real', ANTHROPIC_API_KEY: 'sk-ant-real'}), '', 'CI reads no Anthropic key, even one left in the environment');
  assert.equal(isCi({}), false);
});

test('the key an app holds on a Mac is the placeholder; in CI the real one', () => {
  assert.equal(appKey('', {}), DUMMY_KEY);
  assert.equal(appKey('sk-ant-real', {CI: 'true'}), 'sk-ant-real');
});

test('the placeholder key is shaped like a key and is never a real one', () => {
  assert.match(DUMMY_KEY, /^sk-ant-/);
  assert.match(DUMMY_KEY, /not-a-real-key/);
});

test('CI forces the cheap model; a Mac lets the app use its own production models', () => {
  assert.deepEqual(appModelEnv({CI: 'true'}), {JOBADABRA_MODEL_OVERRIDE: 'claude-haiku-5-5'});
  assert.deepEqual(appModelEnv({}), {});
});

test('the AI family alternates per CI run (odd: OpenAI, even: Claude), never without the OpenAI key; the judges stay on Claude', async () => {
  const {pickEngine, pickFamily, familySecret, testKey} = await import('../../lib/engine.mjs');
  const ci = (run, extra = {}) => ({CI: 'true', GITHUB_RUN_NUMBER: String(run), E2E_OPENAI_KEY: 'sk-test', E2E_ANTHROPIC_KEY: 'sk-ant-test', ...extra});
  assert.equal(pickFamily(ci(7)), 'openai');
  assert.equal(pickFamily(ci(8)), 'claude');
  assert.equal(pickFamily(ci(7, {E2E_OPENAI_KEY: ''})), 'claude', 'no OpenAI key: Claude');
  assert.equal(pickFamily(ci(8, {E2E_AI_FAMILY: 'openai'})), 'openai', 'pinned');
  assert.equal(pickEngine({env: ci(7)}), 'openai');
  assert.equal(pickEngine({env: ci(8)}), 'api');
  assert.equal(pickEngine({env: ci(7), family: 'claude'}), 'api', 'the judges (lib/model.mjs) stay on Claude');
  assert.equal(pickEngine({env: ci(7), suiteEngine: 'api'}), 'openai', 'CI: a proxy suite still runs the family (the proxy is per step: ctx.withApi)');
  assert.equal(testKey(ci(7), 'openai'), 'sk-test');
  assert.equal(testKey(ci(7), 'api'), '', 'no Anthropic key is read (3 Nov 2026)');
  assert.equal(familySecret('openai', 'codex'), 'E2E_OPENAI_KEY');
  assert.equal(familySecret('claude', 'api'), 'CI_AI_PROVIDER=codex', 'a Claude suite with no key says what it needs: the broker');
  // A Mac: Claude unless pinned; pinned OpenAI runs the user's own Codex, never an API key.
  assert.equal(pickFamily({}), 'claude');
  assert.equal(pickEngine({env: {E2E_AI_FAMILY: 'openai'}, installed: () => true}), 'codex');
  assert.throws(() => pickEngine({env: {E2E_AI_ENGINE: 'openai'}}), /CI only/);
  assert.throws(() => pickFamily({E2E_AI_FAMILY: 'gpt'}), /claude, openai, free or rotate/);
});

// Owner, 3 Nov 2026: "We should not use API Keys at all anymore. Everything should be around the ai-broker." A recording run by hand used to ask on LIVE_POOL_ANTHROPIC_KEY (its cost apart); it asks the broker now.
test('a live run on CI has no key of its own: neither the Tests key nor the pool key becomes its key', async () => {
  const {testKey} = await import('../../lib/engine.mjs');
  const env = {CI: 'true', E2E_ANTHROPIC_KEY: 'tests', LIVE_POOL_ANTHROPIC_KEY: 'pool', JOBADABRA_VISIT_KIND: 'hand'};
  assert.equal(testKey(env), '');
  assert.equal(testKey({...env, CI_AI_PROVIDER: 'codex'}), DUMMY_KEY, 'under Codex the row asks through the broker relay (lib/live-row.mjs)');
  assert.equal(testKey({...env, CI: ''}), '', 'never on a Mac');
});

// Owner, 26 Oct 2026 (CI's Anthropic credit ran out): "Let's just switch to Free AI (CloudFlare workers AI). I don't want to top up anymore". With the relay up on the
// runner (.github/actions/free-ai-relay), every CI suite's app runs on Free AI and the judges ask it too; the Claude smoke is parked until he funds Claude.
test('CI on Free AI: with the relay up the app and the judges run on Free AI, its throwaway key, never the Claude key', async () => {
  const {pickEngine, pickFamily, judgeFamily, familySecret, testKey, freeAi, freeAiPlanned} = await import('../../lib/engine.mjs');
  const relay = {E2E_FREE_AI_URL: 'http://127.0.0.1:8787/api/ai', E2E_FREE_AI_KEY: 'JPF1.ci-e2e-x.t'};
  const ci = (run, extra = {}) => ({CI: 'true', GITHUB_RUN_NUMBER: String(run), E2E_OPENAI_KEY: 'sk-test', E2E_ANTHROPIC_KEY: 'sk-ant-test', ...extra});
  for (const run of [7, 8]) assert.equal(pickFamily(ci(run, relay)), 'free', `run ${run}: Free AI on every run`);
  assert.equal(pickEngine({env: ci(8, relay), family: 'free'}), 'api', 'Free AI IS the API engine with a JPF1 key (desktop/lib/ai-free.js)');
  assert.equal(testKey(ci(8, relay), 'api', 'free'), relay.E2E_FREE_AI_KEY);
  assert.equal(familySecret('free'), 'E2E_FREE_AI_KEY');
  assert.equal(judgeFamily(ci(8, relay)), 'free');
  assert.throws(() => judgeFamily(ci(8, {...relay, E2E_JUDGE_FAMILY: 'claude'})), /no Anthropic API key/, 'no switch puts CI\'s judges back on a paid key');
  assert.equal(judgeFamily({E2E_JUDGE_FAMILY: 'claude'}), 'claude', 'a Mac\'s judges are its own Claude Code');
  assert.equal(pickFamily(ci(8, {...relay, E2E_AI_FAMILY: 'openai'})), 'openai', 'a pin still wins');
  // No relay (a fork, or the token unset): today's rotation, unchanged.
  assert.equal(pickFamily(ci(7)), 'openai');
  assert.equal(judgeFamily(ci(7)), 'claude');
  assert.equal(freeAi(ci(7, {E2E_FREE_AI_URL: relay.E2E_FREE_AI_URL})), false, 'a URL without its key is not a relay');
  assert.equal(freeAi({...relay}), false, 'never on a Mac');
  assert.equal(freeAiPlanned(ci(7, {CI_FREE_AI_CF_TOKEN: 'cf'})), true, 'the token set: the relay will start (the preflight checks the token)');
  assert.throws(() => pickFamily({...relay, E2E_AI_FAMILY: 'free'}), /CI only/);
});
