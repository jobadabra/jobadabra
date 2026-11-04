// The live re-ask of a prompt's case set (tools/prompt-cases-live.mjs, .github/workflows/prompt-cases.yml): main's prompts vs the PR's on the same cases, on the owner's
// Codex plan through the AI broker (no API key, owner 3 Nov 2026). The verdict logic and the workflow's wiring, with no AI call.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {caseArgs, compare, pool, toRetry} from '../../../../tools/prompt-cases-live.mjs';

const root = new URL('../../../../', import.meta.url);
const rows = map => Object.entries(map).map(([id, right]) => ({id, right}));

test('a case right on main and wrong on the PR is a regression only when its re-ask is wrong too (Haiku answers vary)', () => {
  const base = rows({a: true, b: true, c: false}), head = rows({a: true, b: false, c: false});
  assert.deepEqual(toRetry(base, head, ['a', 'b', 'c']), ['b'], 'a case wrong on both sides is not re-asked');
  assert.deepEqual(compare(base, head, ['a', 'b', 'c'], rows({b: false})).regressions, ['b']);
  assert.deepEqual(compare(base, head, ['a', 'b', 'c'], rows({b: true})).regressions, []);
});

test('a case the PR adds must be right on the PR\'s prompt; its answer on main does not matter', () => {
  const base = rows({a: true, n: false}), head = rows({a: true, n: false});
  assert.deepEqual(toRetry(base, head, ['a']), ['n']);
  assert.deepEqual(compare(base, head, ['a'], rows({n: false})).newWrong, ['n']);
  assert.deepEqual(compare(base, rows({a: true, n: true}), ['a']).newWrong, []);
});

// Why (#2223 review): a comment put mid-list swallowed --profile and --answers, so every case build threw before Haiku was asked; the unit tests never built a case.
test('the case build passes every option tools/free-ai-form-cases.mjs requires, each pointing at a file that exists', () => {
  const tree = fileURLToPath(root);
  const args = caseArgs(tree, '/x/cases.json');
  const required = [...fs.readFileSync(new URL('tools/free-ai-form-cases.mjs', root), 'utf8').matchAll(/need\('([a-z-]+)'\)/g)].map(found => found[1]);
  assert.ok(required.length >= 3, 'the builder still names its required options with need()');
  for (const name of required) {
    const at = args.indexOf(`--${name}`);
    assert.ok(at > 0 && args[at + 1], `--${name} is passed with a value`);
    if (name !== 'out') assert.ok(fs.existsSync(args[at + 1]), `--${name} ${args[at + 1]} exists`);
  }
});

test('the counts say how many cases each side gets right', () => {
  assert.deepEqual(compare(rows({a: true, b: false}), rows({a: true, b: false}), ['a', 'b'], rows({})).counts, {cases: 2, base: 1, head: 1});
});

test('the pool runs every item, at most `jobs` at once, in order', async () => {
  let running = 0, most = 0;
  const out = await pool([1, 2, 3, 4, 5], 2, async n => { running++; most = Math.max(most, running); await new Promise(r => setTimeout(r, 5)); running--; return n * 2; });
  assert.deepEqual(out, [2, 4, 6, 8, 10]); assert.equal(most, 2);
});

test('it asks through the AI broker on the run\'s OIDC token, never an API key, the subscription token or the production Workers AI token (owner, 3 Nov 2026)', () => {
  const flow = fs.readFileSync(new URL('.github/workflows/prompt-cases.yml', root), 'utf8');
  const code = flow.split('\n').filter(line => !/^\s*#/.test(line)).join('\n');
  assert.match(code, /id-token: write/);
  assert.doesNotMatch(code, /ANTHROPIC|CLAUDE_CODE_OAUTH_TOKEN|claude-code|workers_ai|CF_API_TOKEN/i);
  const runner = fs.readFileSync(new URL('tools/prompt-cases-live.mjs', root), 'utf8').split('\n').filter(line => !/^\s*\/\//.test(line)).join('\n');
  assert.match(runner, /codexRun/);
  assert.doesNotMatch(runner, /ANTHROPIC|claudeRun|apiKey/);
});

test('a refused broker call stops the run with the reason, never a silent pass', () => {
  const runner = fs.readFileSync(new URL('tools/prompt-cases-live.mjs', root), 'utf8');
  assert.match(runner, /the broker did not answer/);
  assert.match(runner, /over the cap of/);
});

test('the by-hand workflow is manually dispatchable and never runs automatically on pull requests', () => {
  const flow = fs.readFileSync(new URL('.github/workflows/prompt-cases.yml', root), 'utf8');
  const triggers = flow.split('\njobs:')[0];
  assert.match(triggers, /^  workflow_dispatch:/m);
  assert.doesNotMatch(triggers, /^  pull_request:/m);
  assert.match(flow, /github\.event\.pull_request\.head\.sha \|\| github\.sha/);
});
