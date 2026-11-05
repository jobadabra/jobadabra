// A persona goal is one Codex conversation (broker contract of jobadabra-web #409, owner 5 Nov 2026 via mac-32): the loop names the goal's session and sends the newest turn as a delta, the broker call keeps those fields
// unless one engine alone is asked, the run's cap counts what the broker metered (`tokens.counted`), and the report says how many calls opened, resumed or restarted a conversation.
// Guard: money — without it every step pays Codex's ~12k own context again (~15 steps in a 250k run instead of ~50), or the cap counts the cached part and stops a warm goal at a third of its use.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {conversation, explore, refusedLine} from '../../lib/explore.mjs';
import {brokerAsk} from '../../lib/agent-ask.mjs';
import {toBrokerCall} from '../../lib/broker-client.mjs';
import {conversationLine, runBudget, CAP_REACHED} from '../../lib/agent-tier.mjs';
import {runSession} from '../../lib/agent-run.mjs';
import {planSession} from '../../lib/agent-plan.mjs';
import {askBroker} from '../../lib/broker-client.mjs';

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
  const rows = [{mode: 'opened', counted: 16_500}, {mode: 'resumed', counted: 1_000}, {mode: 'resumed', counted: 2_000}, {mode: 'restarted', reason: 'idle', counted: 16_000}, {mode: 'restarted', reason: 'gap', counted: 16_000}, {mode: 'ended', counted: 800}, {}];
  assert.equal(conversationLine(rows), 'Codex conversations: 1 opened (16.5k counted each), 2 resumed (1.5k each), 2 restarted (idle 1, gap 1), 1 ended.');
  assert.equal(conversationLine([{}, {}]), '', 'a run with no conversation (Claude) prints nothing');
});

test('a run of warm calls is not stopped early: 60 resumed steps of 2.6k fit in the cap, a restart is still allowed for', async () => {
  const budget = runBudget({capTokens: 250_000});
  let step = 0;
  const ask = budget.actor(async () => {
    step++;
    const input = 16_500 + 2_500 * (step - 1), output = 100, cached = step === 1 ? 0 : input - 2_500;
    return {text: 'x', usage: {input_tokens: input, output_tokens: output}, tokens: {input, output, cached, counted: input - cached + output}};
  });
  const args = {system: 's'.repeat(8_000), messages: [{role: 'user', content: 'u'.repeat(12_000)}], schema: {}};
  let stoppedAt = 0;
  for (let n = 1; n <= 80; n++) { try { await ask(args); } catch (error) { assert.equal(error.message, CAP_REACHED); stoppedAt = n; break; } }
  assert.ok(budget.state.total <= 250_000, `counted ${budget.state.total}`);
  assert.ok(stoppedAt === 0 || stoppedAt > 60, `stopped at step ${stoppedAt} with only ${budget.state.total} metered of 250,000 (the judge keeps 40k and one restart is allowed for)`);
});

test('the broker client hands back the tokens and the session mode it was told', async () => {
  const env = {ACTIONS_ID_TOKEN_REQUEST_URL: 'https://gh.example/token?x=1', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'rt', CODEX_BROKER_URL: 'https://broker.example'};
  const reply = {reply: '{}', tier: 'large', model: 'm', engine: 'codex', ms: 3, tokens: {input: 16_578, output: 18, cached: 16_384, counted: 212}, session: {mode: 'resumed'}};
  const fetchImpl = async url => new Response(JSON.stringify(String(url).startsWith('https://gh.example') ? {value: 'jwt'} : reply));
  const answer = await askBroker({model: 'claude-opus-5-5', messages: [{role: 'user', content: 'hi'}], session: 'agent-g1', delta: 'n'}, {env, fetchImpl});
  assert.deepEqual([answer.tokens.counted, answer.tokens.cached, answer.session.mode], [212, 16_384, 'resumed']);
});

test('a session names each goal\'s conversation, and the trace row keeps what the broker said of the call', async () => {
  const plan = planSession({seed: 7, moves: [{group: 'Profile', label: 'Edit your phone number'}, {group: 'Jobs', label: 'Open a job'}], count: 2});
  const sessions = [];
  const done = {...answer('done', {verdict: 'worked', summary: 'ok'}), tokens: {input: 16_000, output: 5, cached: 0, cacheWritten: 900, counted: 16_005}, session: {mode: 'opened'}};
  const act = {observe: async () => page(1), click: async () => {}, type: async () => {}, press: async () => {}, go: async () => {}};
  const result = await runSession({act, ask: async args => { sessions.push(args.session); return done; }, judgeAsk: async () => ({text: '{}', usage: {}, tier: 'mid'}), views: ['profile'], plan, knowledgeIds: [], caps: {maxSteps: 5}});
  assert.deepEqual(sessions, ['agent-g1', 'agent-g2'], 'one conversation per goal');
  assert.deepEqual([result.trace[0].cached, result.trace[0].cacheWritten, result.trace[0].counted, result.trace[0].mode], [0, 900, 16_005, 'opened']);
});

test('a refused call says which call of which conversation it was and how big', () => {
  const messages = [{role: 'user', content: 'a'.repeat(100)}, {role: 'assistant', content: 'b'.repeat(20)}, {role: 'user', content: 'c'.repeat(30)}];
  assert.equal(refusedLine({session: 'agent-g1', delta: 'c'.repeat(30), messages}, 4), '  call 5 of agent-g1 was refused (delta 30 chars, 3 turns, 150 chars in all)');
  assert.match(refusedLine({messages: [{role: 'user', content: 'x'}]}, 0), /call 1 of no conversation was refused \(full prompt, 1 turns, 1 chars/);
});
