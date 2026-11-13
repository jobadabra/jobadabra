// Guard: release — the Search check's numbers lose their meaning when a night finishes on Free AI (8 Nov 2026: 3 of 18 measured) or when its engine changes unsaid.
// The relay (tools/persona-search/codex.mjs) keeps every call of a run on JOBADABRA_CHECK_CHAIN: `codex,claude` = Codex, then Claude, never Free AI (the broker's `subs`);
// each answered call's relay line names its engine, which gate.py counts per person (tools/persona-search/engine_calls.py).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {checkChain, proofRequest, timedRelay} from '../../../../tools/persona-search/codex.mjs';
import {toBrokerCall} from '../../lib/broker-client.mjs';

const ASK = {model: 'claude-haiku-5-5', max_tokens: 16, messages: [{role: 'user', content: 'Is this job in Lyon?'}]};
const answered = engine => ({ok: true, tier: 'small', model: 'm', engine, message: {content: [{type: 'text', text: 'yes'}], stop_reason: 'end_turn', usage: {input_tokens: 5, output_tokens: 1}}, ms: 10});

/** The broker bodies a relay sends and the relay lines it logs, with the given environment; the fake broker answers with `engine`. */
async function run(env, engine = 'codex') {
  const wires = [], lines = [];
  const relay = timedRelay({env, ask: async wire => { wires.push(toBrokerCall(wire)); return answered(engine); }, log: line => lines.push(line)});
  await relay(ASK, 'place_triage');
  await relay({...ASK, system: 'Judge the job blind.'}, 'judge');
  return {wires, lines};
}

test('the check asks Codex first with Claude as its replacement, never Free AI, on every call (the press and the judge alike)', async () => {
  const {wires} = await run({JOBADABRA_CHECK_CHAIN: 'codex,claude'});
  assert.equal(wires.length, 2);
  for (const wire of wires) assert.deepEqual([wire.engine, wire.subs, wire.only], ['codex', true, undefined], 'the broker\'s subs: the two subscriptions, Codex first');
});

test('each answered call says which engine answered, so a night on Claude is counted, not hidden', async () => {
  const {lines} = await run({JOBADABRA_CHECK_CHAIN: 'codex,claude'}, 'claude');
  for (const line of lines) assert.match(line, / status 200 .* engine claude$/);
});

test('a caller that names no chain keeps the broker chain, as before; one engine is that engine alone', async () => {
  for (const wire of (await run({})).wires) assert.deepEqual([wire.engine, wire.subs, wire.only], [undefined, undefined, undefined]);
  assert.deepEqual(checkChain({JOBADABRA_CHECK_CHAIN: ' claude '}), {engine: 'claude', only: true});
  assert.deepEqual(checkChain({JOBADABRA_CHECK_CHAIN: 'claude, codex'}), {engine: 'claude', subs: true});
});

test('the --proof call rides the run\'s chain, so it proves the AI the search will use, not the broker\'s default (Gitar on #3971)', () => {
  const wire = env => toBrokerCall(proofRequest(env));
  assert.deepEqual([wire({JOBADABRA_CHECK_CHAIN: 'claude'}).engine, wire({JOBADABRA_CHECK_CHAIN: 'claude'}).only], ['claude', true], 'claude alone: only');
  assert.deepEqual([wire({JOBADABRA_CHECK_CHAIN: 'codex,claude'}).engine, wire({JOBADABRA_CHECK_CHAIN: 'codex,claude'}).subs], ['codex', true]);
  assert.equal(wire({}).engine, undefined, 'positive control: no chain, no pin, as before');
});

test('a chain the broker does not know stops the run before any call, never a guess (Free AI is never a replacement)', () => {
  for (const chain of ['gpt', 'codex,free-ai', 'codex,claude,free-ai']) assert.throws(() => checkChain({JOBADABRA_CHECK_CHAIN: chain}), /not a chain the broker knows/, chain);
});

test('search-personas.yml sets the chain once at the workflow level, so the press, the judge and the reference count all inherit it', async () => {
  const workflow = await readFile(new URL('../../../../.github/workflows/search-personas.yml', import.meta.url), 'utf8');
  assert.match(workflow, /^env:\n(?:  .*\n)*?  JOBADABRA_CHECK_CHAIN: \$\{\{ inputs\.chain \|\| 'codex,claude' \}\}/m, 'the night (no input) is codex,claude');
  // a by-hand chain other than the night's is never a night: every night-only step also asks for the default chain
  const nightOnly = workflow.split('\n').filter(line => line.includes("inputs.personas == ''"));
  assert.ok(nightOnly.length >= 4);
  for (const line of nightOnly) assert.match(line, /\(inputs\.chain \|\| 'codex,claude'\) == 'codex,claude'/, line.trim().slice(0, 80));
});
