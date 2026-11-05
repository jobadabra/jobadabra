// A persona goal is one Codex conversation (broker contract of jobadabra-web #409, owner 5 Nov 2026 via mac-32): the loop names the goal's session and sends the newest turn as a delta, the broker call keeps those fields
// unless one engine alone is asked, the run's cap counts what the broker metered (`tokens.counted`), and the report says how many calls opened, resumed or restarted a conversation.
// Guard: money — without it every step pays Codex's ~12k own context again (~15 steps in a 250k run instead of ~50), or the cap counts the cached part and stops a warm goal at a third of its use.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {conversation, explore} from '../../lib/explore.mjs';
import {brokerAsk} from '../../lib/agent-ask.mjs';
import {toBrokerCall} from '../../lib/broker-client.mjs';
import {conversationLine, runBudget} from '../../lib/agent-tier.mjs';

const BLANK = {control: -1, text: '', key: '', view: '', title: '', kind: '', severity: '', what: '', check_type: '', check_text: '', check_control: '', summary: '', type: '', expected: '', observed: '', why: '', verdict: ''};
const answer = (action, extra = {}) => ({text: JSON.stringify({...BLANK, action, ...extra}), usage: {input_tokens: 10, output_tokens: 5}, ms: 1, tier: 'large', engine: 'codex'});
const page = n => ({view: 'profile', text: `Profile ${n}`, overlays: [], controls: [{i: 0, kind: 'button', label: 'Save', disabled: false, cls: '', href: '', type: ''}]});

test('a goal sends its session on every call and the newest turn as delta from the second one; the cap-made last call ends it', async () => {
  const sent = [];
  let n = 0;
  const ask = async args => { sent.push({...args, messages: [...args.messages]}); return answer('click', {control: 0}); };   // a copy: the loop goes on pushing to its own array
  await explore({act: {observe: async () => page(n++), click: async () => {}, type: async () => {}, press: async () => {}, go: async () => {}}, ask, views: ['profile'], caps: {maxSteps: 3}, session: 'agent-g2'});
  assert.deepEqual(sent.map(call => call.session), ['agent-g2', 'agent-g2', 'agent-g2']);
  assert.equal(sent[0].delta, undefined, 'the first call carries the full prompt only');
  assert.equal(sent[1].delta, sent[1].messages.at(-1).content, 'the delta is the newest user turn alone');
  assert.match(sent[1].delta, /Profile/);
  assert.deepEqual(sent.map(call => call.endSession), [undefined, undefined, true], 'only the call the step cap makes the last one says so');
  assert.equal(sent[2].messages.length, 5, 'the full conversation still travels, so a restart loses nothing');
});

test('an explorer with no session sends none of the fields', () => {
  assert.deepEqual(conversation('', [{role: 'user', content: 'x'}], 3, 10), {});
  assert.deepEqual(conversation('agent-g1', [{role: 'user', content: [{type: 'image'}]}], 1, 10), {session: 'agent-g1'}, 'a turn that is not text is not a delta');
});

test('the broker call keeps the conversation fields, except when one engine alone is asked', async () => {
  const sent = [];
  const call = async body => { sent.push(body); return {ok: true, message: {content: [{text: '{}'}], usage: {input_tokens: 600, output_tokens: 20}}, ms: 5, tier: 'large', engine: 'codex', tokens: {input: 600, output: 20, cached: 16384, counted: 620}, session: {mode: 'resumed'}}; };
  const input = {system: 's', messages: [{role: 'user', content: 'u'}], schema: {}, session: 'agent-g1', delta: 'next', endSession: true};
  const reply = await brokerAsk('large', {ask: call})(input);
  await brokerAsk('large', {only: 'claude', ask: call})(input);
  assert.deepEqual([sent[0].session, sent[0].delta, sent[0].endSession], ['agent-g1', 'next', true]);
  assert.deepEqual([sent[1].session, sent[1].delta, sent[1].endSession], [undefined, undefined, undefined], 'Claude alone keeps no Codex conversation');
  const wire = toBrokerCall(sent[0]);
  assert.deepEqual([wire.session, wire.delta, wire.endSession], ['agent-g1', 'next', true], 'the three fields reach the broker body, not only brokerAsk');
  assert.match(wire.prompt, /User:\nu/, 'the prompt stays the full conversation');
  assert.equal(toBrokerCall(sent[1]).session, undefined);
  assert.deepEqual([reply.tokens.counted, reply.session.mode], [620, 'resumed'], 'what the broker metered and the mode come back to the loop');
});

test('the cap counts the broker\'s metered tokens, not input plus output, and falls back when the broker gave none', async () => {
  const budget = runBudget({capTokens: 250_000});
  const warm = budget.actor(async () => ({text: 'x', usage: {input_tokens: 21_000, output_tokens: 100}, tokens: {counted: 900}}));
  const plain = budget.actor(async () => ({text: 'x', usage: {input_tokens: 700, output_tokens: 50}}));
  const args = {system: 's', messages: [{role: 'user', content: 'u'}], schema: {}};
  await warm(args);
  assert.equal(budget.state.total, 900, 'the cached part of a resumed turn is not spent');
  await plain(args);
  assert.equal(budget.state.total, 900 + 750, 'an answer with no count is charged input + output as before');
});

test('the report says how many calls opened, resumed or restarted a conversation, and why', () => {
  const rows = [{mode: 'opened', counted: 16_500}, {mode: 'resumed', counted: 1_000}, {mode: 'resumed', counted: 2_000}, {mode: 'restarted', reason: 'idle', counted: 16_000}, {mode: 'restarted', reason: 'gap', counted: 16_000}, {}];
  assert.equal(conversationLine(rows), 'Codex conversations: 1 opened (16.5k counted each), 2 resumed (1.5k each), 2 restarted (idle 1, gap 1).');
  assert.equal(conversationLine([{}, {}]), '', 'a run with no conversation (Claude) prints nothing');
});
