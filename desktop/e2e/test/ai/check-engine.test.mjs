// Guard: release — the Search check's numbers are finished on another AI when its engine runs out (8 Nov 2026: a whole night on Free AI), so they stop being comparable.
// The relay (tools/persona-search/codex.mjs) pins every call of a run to JOBADABRA_CHECK_ENGINE with the broker's `only`: that engine alone, or a refusal; no other caller is pinned.
import test from 'node:test';
import assert from 'node:assert/strict';
import {checkEngine, timedRelay} from '../../../../tools/persona-search/codex.mjs';
import {toBrokerCall} from '../../lib/broker-client.mjs';

const ASK = {model: 'claude-haiku-5-5', max_tokens: 16, messages: [{role: 'user', content: 'Is this job in Lyon?'}]};
const answered = {ok: true, tier: 'small', model: 'gpt-6-luna', engine: 'codex', message: {content: [{type: 'text', text: 'yes'}], stop_reason: 'end_turn', usage: {input_tokens: 5, output_tokens: 1}}, ms: 10};

/** The broker body each call of a relay sends, with the given environment. */
async function sent(env) {
  const wires = [];
  const relay = timedRelay({env, ask: async wire => { wires.push(toBrokerCall(wire)); return answered; }, log: () => {}});
  await relay(ASK, 'place_triage');
  await relay({...ASK, system: 'Judge the job blind.'}, 'judge');
  return wires;
}

test('a pinned check asks its one engine alone on every call (the press and the judge alike)', async () => {
  const wires = await sent({JOBADABRA_CHECK_ENGINE: 'codex'});
  assert.equal(wires.length, 2);
  for (const wire of wires) assert.deepEqual([wire.engine, wire.only], ['codex', true], 'never the broker chain: Codex alone, or its refusal');
});

test('a caller that names no engine keeps the broker chain, as before', async () => {
  for (const wire of await sent({})) assert.deepEqual([wire.engine, wire.only], [undefined, undefined]);
});

test('an engine the broker does not know stops the run before any call, never a guess', () => {
  assert.throws(() => checkEngine({JOBADABRA_CHECK_ENGINE: 'gpt'}), /not an engine the broker knows/);
  assert.equal(checkEngine({JOBADABRA_CHECK_ENGINE: ' claude '}), 'claude');
});

test('search-personas.yml pins the whole check to Codex (one setting, read by every relay step)', async () => {
  const {readFile} = await import('node:fs/promises');
  const workflow = await readFile(new URL('../../../../.github/workflows/search-personas.yml', import.meta.url), 'utf8');
  assert.match(workflow, /^env:\n(?:  .*\n)*?  JOBADABRA_CHECK_ENGINE: codex\b/m, 'set once at the workflow level, so the press, the judge and the reference count all inherit it');
});
