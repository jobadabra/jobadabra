// The rule, enforced for every suite that exists or will exist (owner, 5 Oct 2026: "no local e2e suite should ever load the Anthropic key"): test code reaches a model only through
// lib/model.mjs, and since 3 Nov 2026 (owner: "We should not use API Keys at all anymore") no harness file under lib/ or suites/ reads E2E_ANTHROPIC_KEY at all: CI holds none. CI-only tools are listed, each with its reason.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';

const E2E = path.resolve(path.resolve(import.meta.dirname, '..'), '..');
const CI_ONLY = new Set([
  'review-ui.mjs',          // the AI screenshot review: CI only (README)
  'review-eval.mjs',        // scores a screenshot reviewer on the judged issues: CI only, by hand (.github/workflows/review-eval.yml)
  'ai-cost-report.mjs',     // reads what Anthropic billed (admin key), spends nothing
  'lib/ai-proxy.mjs',       // the stand-in for the API: it forwards only when a key is behind it
  'lib/model.mjs',          // the one door: the API in CI, Claude Code on a Mac
  'lib/engine.mjs',         // the key rule: the placeholder under Codex, Free AI's relay key, empty on a Mac; reads no Anthropic key
  'lib/context.mjs',        // hands that key to a suite, empty on a Mac
]);
const files = dir => fs.readdirSync(path.join(E2E, dir), {withFileTypes: true}).flatMap(entry => entry.isDirectory() ? [] : /\.mjs$/.test(entry.name) ? [path.join(dir, entry.name)] : []);
// Code only: a comment may name the key.
const code = file => fs.readFileSync(path.join(E2E, file), 'utf8').split('\n').filter(line => !/^\s*\/\//.test(line)).join('\n');
const sources = [...files('.'), ...files('lib'), ...files('suites')].map(file => file.replace(/^\.\//, '')).filter(file => !CI_ONLY.has(file));

test('no suite or helper posts to the Anthropic API itself', () => {
  const offenders = sources.filter(file => /api\.anthropic\.com\/v1\/messages/.test(code(file)) && !/modelFetch/.test(code(file)));
  assert.deepEqual(offenders, [], `ask a model through lib/model.mjs (modelFetch / modelClient), never fetch the API directly: ${offenders.join(', ')}`);
});

test('nothing in lib/ or suites/ names E2E_ANTHROPIC_KEY or the Keychain item', () => {
  const offenders = sources.filter(file => /E2E_ANTHROPIC_KEY|e2e\.anthropic_key/.test(code(file))
    && !/^(skip\.mjs|lib\/skip\.mjs)$/.test(file));
  // Why (3 Nov 2026, owner: "We should not use API Keys at all anymore"): the allow list that held the CI tooling (plan-run, triage, the Finder's files) and the wizard's label is empty; review-ui.mjs, the one CI tool
  // left, is listed in CI_ONLY above until the review action moves (plan 4/5, docs/superpowers/specs/2026-11-03-ci-no-api-keys.md). A new name here is a key coming back.
  assert.deepEqual(offenders, [], `CI holds no Anthropic key; do not name E2E_ANTHROPIC_KEY in: ${offenders.join(', ')}`);
});

test('a suite never reads the key straight from the environment', () => {
  const offenders = files('suites').filter(file => /process\.env\.E2E_ANTHROPIC_KEY|process\.env\.ANTHROPIC/.test(code(file)));
  assert.deepEqual(offenders, []);
});
