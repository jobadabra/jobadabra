// Guard: release — CI picks the wrong AI provider or tier, or a broker refusal reads as a red or green step.
// Guards the CI AI provider switch (lib/ai-provider.mjs) and CI's side of the Codex broker (lib/broker-client.mjs): precedence, parity of tiers, the broker's refusals as skips.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {aiProvider, providerLine} from '../../lib/ai-provider.mjs';
import {AUDIENCE, BROKER_URL, aiLine, askBroker, failureOf, resetTold, runToken, tierOf, toBrokerCall} from '../../lib/broker-client.mjs';

test('the switch: input beats a job override beats the repo variable beats the default; nothing silently changes provider', () => {
  const ci = {CI: 'true'};
  assert.deepEqual(aiProvider({...ci}), {provider: 'free', from: 'default'});
  assert.equal(aiProvider({...ci, CI_AI_PROVIDER: 'codex'}).provider, 'codex');
  assert.equal(aiProvider({...ci, CI_AI_PROVIDER: 'codex', E2E_AI_PROVIDER_JUDGES: 'free'}, 'judges').provider, 'free');
  assert.equal(aiProvider({...ci, CI_AI_PROVIDER: 'codex', E2E_AI_PROVIDER_JUDGES: 'free'}, 'review').provider, 'codex');   // another consumer keeps the global
  assert.deepEqual(aiProvider({...ci, CI_AI_PROVIDER: 'free', E2E_AI_PROVIDER_JUDGES: 'free', E2E_AI_PROVIDER: 'codex'}, 'judges'), {provider: 'codex', from: 'E2E_AI_PROVIDER'});
  assert.equal(aiProvider({...ci, CI_AI_PROVIDER: ' Codex '}).provider, 'codex');
  assert.throws(() => aiProvider({...ci, CI_AI_PROVIDER: 'gpt'}), /must be codex or free/);
  // Owner, 3 Nov 2026: "We should not use API Keys at all anymore." CI has no claude value, in any of the three variables, and says why.
  for (const name of ['CI_AI_PROVIDER', 'E2E_AI_PROVIDER', 'E2E_AI_PROVIDER_JUDGES']) assert.throws(() => aiProvider({...ci, [name]: 'claude'}, 'judges'), /CI holds no Anthropic API key/, name);
  assert.equal(aiProvider({CI_AI_PROVIDER: 'codex'}).provider, 'claude');   // a Mac keeps its own Claude Code
  assert.equal(providerLine({...ci, CI_AI_PROVIDER: 'codex'}), 'AI provider: codex (from CI_AI_PROVIDER)');
});

test('the switch reaches the judges: no claude on CI, even with the relay up; images are numbered across turns', async () => {
  const {judgeFamily} = await import('../../lib/engine.mjs');
  const relay = {CI: 'true', E2E_FREE_AI_URL: 'http://x', E2E_FREE_AI_KEY: 'k'};
  assert.equal(judgeFamily(relay), 'free');
  assert.throws(() => judgeFamily({...relay, CI_AI_PROVIDER: 'claude'}), /CI holds no Anthropic API key/);
  const part = data => ({type: 'image', source: {media_type: 'image/png', data}});
  const call = toBrokerCall({model: 'claude-haiku-5-5', messages: [{role: 'user', content: [part('A')]}, {role: 'assistant', content: 'ok'}, {role: 'user', content: [part('B')]}]});
  assert.deepEqual(call.images.map(i => i.name), ['image0.png', 'image1.png']);
});

test('parity: each Claude tier keeps its Codex counterpart', () => {
  assert.deepEqual(['claude-haiku-5-5', 'claude-haiku-4-5-20251001', 'claude-sonnet-5-5', 'claude-opus-5-5', undefined].map(tierOf), ['small', 'small', 'mid', 'large', 'mid']);
});

test('a Messages request becomes one broker call: system, turns, schema, pictures, tier', () => {
  const call = toBrokerCall({model: 'claude-haiku-5-5', system: [{text: 'Be strict.'}, {text: 'JSON only.'}], output_config: {format: {schema: {type: 'object'}}},
    messages: [{role: 'user', content: [{type: 'text', text: 'Is it red?'}, {type: 'image', source: {media_type: 'image/png', data: 'AAAA'}}]}]});
  assert.equal(call.tier, 'small');
  assert.match(call.prompt, /Be strict\.\n\nJSON only\.\n\nUser:\nIs it red\?/);
  assert.deepEqual(call.schema, {type: 'object'});
  assert.deepEqual(call.images, [{name: 'image0.png', base64: 'AAAA'}]);
});

// Why (7 Nov 2026): the engine's title/score calls ask for low effort and the relay ran them at Codex's default (11.6 s p50 alone against 1.9 s on the plan path); this plays that request.
test('the effort a Messages request asks for reaches the broker, only when the broker accepts it', () => {
  const ask = output_config => toBrokerCall({model: 'claude-haiku-5-5', output_config, messages: [{role: 'user', content: 'Score this title.'}]});
  const schema = {type: 'object'};
  assert.equal(ask({format: {type: 'json_schema', schema}, effort: 'low'}).effort, 'low', "the engine's low effort is sent");
  for (const effort of ['medium', 'high', 'xhigh']) assert.equal(ask({effort}).effort, effort);
  for (const effort of ['max', 'LOW', '', 'constructor', 7, null]) assert.equal(Object.hasOwn(ask({effort}), 'effort'), false, `${effort} is not the broker's value, so it is not sent`);
  assert.equal(Object.hasOwn(ask({format: {schema}}), 'effort'), false, 'no effort asked: the call stays as before');
  assert.equal(Object.hasOwn(toBrokerCall({model: 'claude-haiku-5-5', messages: [{role: 'user', content: 'x'}]}), 'effort'), false, 'no output_config at all');
});

const env = {ACTIONS_ID_TOKEN_REQUEST_URL: 'https://gh.example/token?x=1', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'rt', CODEX_BROKER_URL: 'https://broker.example'};
const fake = reply => async (url, init) => (String(url).startsWith('https://gh.example') ? new Response(JSON.stringify({value: 'jwt-for-run'})) : reply(url, init));

test('an answered call comes back in Messages shape with its tokens; the run token is the Bearer', async () => {
  let seen;
  const answer = await askBroker({model: 'claude-sonnet-5-5', messages: [{role: 'user', content: 'hi'}]}, {env, fetchImpl: fake((url, init) => { seen = {url, auth: init.headers.authorization}; return new Response(JSON.stringify({reply: '{"verdict":"pass"}', tokens: {input: 13576, output: 25}, ms: 51, tier: 'mid', model: 'gpt-6.1-sol'})); })});
  assert.deepEqual(seen, {url: 'https://broker.example/call', auth: 'Bearer jwt-for-run'});
  assert.equal(answer.ok, true);
  assert.equal(answer.ms, 51, 'the container timing reaches the persona measurement');
  assert.equal(answer.message.content[0].text, '{"verdict":"pass"}');
  assert.deepEqual(answer.message.usage, {input_tokens: 13576, output_tokens: 25});
});

test('the broker\'s budget saying no is a skip with its reason, never another provider; no token and no answer are said apart', async () => {
  const ask = fetchImpl => askBroker({model: 'claude-haiku-5-5', messages: [{role: 'user', content: 'hi'}]}, {env, fetchImpl});
  assert.deepEqual(await ask(fake(() => new Response(JSON.stringify({why: 'budget:own-share 60.1% of 60% (scheduled)'}), {status: 429}))), {ok: false, status: 'capped', detail: 'broker: budget:own-share 60.1% of 60% (scheduled)'});
  assert.equal((await ask(fake(() => new Response('{"why":"oidc: wrong repository"}', {status: 401})))).status, 401);
  assert.equal((await ask(fake(() => { throw new Error('boom'); }))).status, 'unreachable');
  assert.equal((await askBroker({model: 'x', messages: []}, {env: {}, fetchImpl: async () => { throw new Error('no call without a token'); }})).status, 'no-token');
});

// Owner via mac-32, 4 Nov 2026: "A check that keeps skipping in grey because its login is gone isn't measuring anything" (the Search check stayed broken through 11 fixes).
test('only a budget reason is a skip; every other refusal (a lost login, a fallback that cannot answer) is a failure the job shows, with its reason', async () => {
  const ask = reply => askBroker({model: 'claude-haiku-5-5', messages: [{role: 'user', content: 'hi'}]}, {env, fetchImpl: fake(reply),
    sleep: async () => { throw new Error('a refusal that gave its reason is not asked again'); }});
  for (const [status, why] of [[503, 'no-login'], [503, 'login-lost'], [503, 'fallback:search-unsupported'], [503, 'fallback:unavailable'], [503, 'only-codex: unavailable'], [429, 'rate-limited']]) {
    assert.deepEqual(await ask(() => new Response(JSON.stringify({why}), {status})), {ok: false, status, detail: `broker: ${why}`}, `${status} ${why}`);
  }
  assert.equal((await ask(() => new Response(JSON.stringify({why: 'budget:fallback-day $2 Free AI (UTC)'}), {status: 503}))).status, 'capped', 'the reason decides, not the code');
  // Run 42040707448 (5 Nov 2026): Codex's JSON stream filled the 160 characters the agent kept, so the reason was cut at "Selec". The server's own words come first now, unescaped.
  const message = 'Selected model is at capacity. Please try a \\"different\\" model.';
  const stream = `codex-failed:1 {"type":"thread.started","thread_id":"01a1ac05-5b58-7850-8433-3b742820d8cb"} {"type":"turn.started"} {"type":"error","message":"${message}"} {"type":"turn.failed","error":{"message":"${message}"}}`;
  assert.deepEqual(await ask(() => new Response(JSON.stringify({why: stream}), {status: 502})), {ok: false, status: 502, detail: 'broker: codex-failed:1 Selected model is at capacity. Please try a "different" model.'});
});

// Treats a symptom (4 Nov 2026, with mac-32): while the broker's container is swapped after a deploy, the platform answers 500 for a few seconds with no reason of the broker's
// (6 calls in 24 s on 4 Nov). One more try after 30 s rides it out. The cause, calls cut off by the swap, is JOB-274 (drain in-flight calls before it).
test('a 5xx the broker gave no reason for is asked again once after 30 s, never twice', async () => {
  const body = {model: 'claude-haiku-5-5', messages: [{role: 'user', content: 'hi'}]}, slept = [];
  let asked = 0;
  const fixed = {reply: 'ok', tokens: {input: 1, output: 1}, tier: 'small', model: 'gpt-6-luna'};
  const rides = await askBroker(body, {env, fetchImpl: fake(() => { asked++; return asked === 1 ? new Response('error code: 1101', {status: 500}) : new Response(JSON.stringify(fixed)); }), sleep: async ms => { slept.push(ms); }});
  assert.deepEqual([rides.ok, asked, slept], [true, 2, [30000]]);
  asked = 0; slept.length = 0;
  const stays = await askBroker(body, {env, fetchImpl: fake(() => { asked++; return new Response('error code: 1101', {status: 502}); }), sleep: async ms => { slept.push(ms); }});
  assert.deepEqual([stays.ok, stays.status, asked, slept], [false, 502, 2, [30000]], 'the second 5xx is the answer');
});

test('at the job: a budget refusal skips (a note for the one alert); a lost login throws, so the job is red and says why', async () => {
  const {askOrSkip} = await import('../../lib/broker-job.mjs'), {mkdtempSync} = await import('node:fs'), {tmpdir} = await import('node:os'), {join} = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'broker-job-'));
  const run = (reply, status) => askOrSkip({model: 'claude-haiku-5-5', messages: [{role: 'user', content: 'hi'}]}, {job: 'search', dir, env: {}, ask: (body, options) => askBroker(body, {...options, env, fetchImpl: fake(() => new Response(JSON.stringify({why: reply}), {status}))})});
  const log = console.log, lines = [];
  console.log = line => lines.push(String(line));
  try {
    assert.deepEqual(await run('budget:week 85% of 80%', 429), {ok: false, why: 'broker: budget:week 85% of 80%'});
    await assert.rejects(run('login-lost', 503), /the AI broker failed \(503\): broker: login-lost/);
    await assert.rejects(run('fallback:search-unsupported', 503), /the AI broker failed \(503\): broker: fallback:search-unsupported/);
  } finally { console.log = log; }
  assert.equal(lines.length, 1, 'only the budget refusal was noted as a skip');
});

test('a connection the broker never answered names its cause and how long it was open, from a real socket', async () => {
  const server = http.createServer(req => req.socket.destroy());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const clock = [1000, 64000], tokenOnly = (url, init) => (String(url).startsWith('https://gh.example') ? new Response('{"value":"t"}') : fetch(url, init));
  try {
    const answer = await askBroker({model: 'x', messages: []}, {env: {...env, CODEX_BROKER_URL: `http://127.0.0.1:${server.address().port}`}, fetchImpl: tokenOnly, now: () => clock.shift()});
    assert.equal(answer.status, 'unreachable');
    assert.match(answer.detail, /^no answer from the broker: fetch failed \((UND_ERR_SOCKET|ECONNRESET): .+\) after 63 s$/);
  } finally { server.close(); }
});

test('a connection lost after the headers is no answer, not an empty success', async () => {
  const server = http.createServer((req, res) => { res.writeHead(200, {'content-type': 'application/json', 'content-length': '100'}); res.write('{"reply":'); setImmediate(() => req.socket.destroy()); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const tokenOnly = (url, init) => (String(url).startsWith('https://gh.example') ? new Response('{"value":"t"}') : fetch(url, init));
  try {
    const answer = await askBroker({model: 'x', messages: []}, {env: {...env, CODEX_BROKER_URL: `http://127.0.0.1:${server.address().port}`}, fetchImpl: tokenOnly});
    assert.equal(answer.status, 'unreachable');
    assert.match(answer.detail, /^the broker's answer was cut off: /);
  } finally { server.close(); }
});

test('every address failing still names a cause, and no cause leaves the message alone', () => {
  assert.equal(failureOf(Object.assign(new Error('fetch failed'), {cause: Object.assign(new AggregateError([Object.assign(new Error('connect ETIMEDOUT 1.2.3.4:443'), {code: 'ETIMEDOUT'})]), {code: 'ETIMEDOUT'})})), 'fetch failed (ETIMEDOUT: connect ETIMEDOUT 1.2.3.4:443)');
  assert.equal(failureOf(new Error('The operation was aborted due to timeout')), 'The operation was aborted due to timeout');
});

test('a network failure on the way to the run token is not called a job without id-token', async () => {
  const answer = await askBroker({model: 'x', messages: []}, {env, fetchImpl: async () => { throw Object.assign(new TypeError('fetch failed'), {cause: {code: 'EAI_AGAIN', message: 'getaddrinfo EAI_AGAIN'}}); }});
  assert.deepEqual(answer, {ok: false, status: 'unreachable', detail: 'no run token from GitHub: fetch failed (EAI_AGAIN: getaddrinfo EAI_AGAIN)'});
});

// 12 Nov 2026, press-tapes-auto run 43232268713: GitHub's token service answered "upstream connect error…" (not JSON) on 18 calls; each became a refused AI call and
// tapes 10, 11 and 14 were not kept. A gateway 502/503/504 gets one more try after ~10 s (the owner's "One retry on GitHub errors", 3 Nov 2026, tools/gh_retry.py).
test('a run token: a gateway 502/503/504 is asked once more; a second one names the status and GitHub\'s words', async () => {
  const slept = [], sleep = async ms => { slept.push(ms); };
  const reply = (status, body) => new Response(body, {status});
  let answers = [reply(503, 'upstream connect error or disconnect/reset before headers'), reply(200, JSON.stringify({value: 'tok'}))];
  assert.equal(await runToken(env, async () => answers.shift(), sleep), 'tok');
  assert.deepEqual(slept, [10000]);
  answers = [reply(503, 'upstream connect error'), reply(502, 'upstream reset')];
  await assert.rejects(runToken(env, async () => answers.shift(), sleep), /HTTP 502: upstream reset/);
  answers = [reply(403, 'forbidden'), reply(200, JSON.stringify({value: 'never'}))];
  await assert.rejects(runToken(env, async () => answers.shift(), sleep), /HTTP 403: forbidden/);   // not a gateway status: never asked again
  assert.equal(answers.length, 1);
  answers = [reply(500, 'internal error'), reply(200, JSON.stringify({value: 'never'}))];
  await assert.rejects(runToken(env, async () => answers.shift(), sleep), /HTTP 500: internal error/);   // 500 is not in tools/gh_retry.py's gateway set
  assert.equal(answers.length, 1);
  assert.deepEqual(slept, [10000, 10000], 'only the two gateway answers waited');
  const unreadable = {ok: false, status: 403, text: async () => { throw new Error('socket hang up'); }};
  await assert.rejects(runToken(env, async () => unreadable, sleep), /HTTP 403: \(body unreadable: socket hang up\)/);
});

test('the judges on codex: an answer returns in Messages shape; a broker refusal is a skip with its reason, said by the runner\'s cap path', async () => {
  const {modelFetch} = await import('../../lib/model.mjs');
  const {takeCapped, capMessage} = await import('../../lib/ai-cap.mjs');
  const ciEnv = {...env, CI: 'true', CI_AI_PROVIDER: 'codex', E2E_SUITE: 'x'};
  const request = {method: 'POST', headers: {}, body: JSON.stringify({model: 'claude-haiku-5-5', messages: [{role: 'user', content: 'ok?'}]})};
  const realFetch = globalThis.fetch;
  try {
    let status = 200;
    globalThis.fetch = fake(() => (status === 200 ? new Response(JSON.stringify({reply: 'yes', tokens: {input: 5, output: 1}, tier: 'small', model: 'gpt-6-luna'})) : new Response(JSON.stringify({why: 'budget:week 85% of 85% (scheduled)'}), {status: 429})));
    const ok = await modelFetch('https://api.anthropic.com/v1/messages', request, {engine: () => 'api', env: ciEnv});
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).content[0].text, 'yes');
    assert.equal(takeCapped(), null);
    status = 429;
    const refused = await modelFetch('https://api.anthropic.com/v1/messages', {...request, body: JSON.stringify({model: 'claude-haiku-5-5', messages: [{role: 'user', content: 'another?'}]})}, {engine: () => 'api', env: ciEnv});
    assert.equal(refused.status, 503);
    const capped = takeCapped();
    assert.match(capMessage(capped.neurons, ciEnv, capped.why), /AI broker said no \(broker: budget:week 85%/);
  } finally { globalThis.fetch = realFetch; }
});


test('web search reaches the broker as search true and ordinary calls omit the flag', async () => {
  const seen = [];
  const fetchImpl = fake((url, init) => { seen.push(JSON.parse(init.body)); return new Response(JSON.stringify({reply: '{"boards":[]}', tokens: {input: 1, output: 1}, tier: 'small', model: 'gpt-6-luna'})); });
  const body = {model: 'claude-haiku-5-5', messages: [{role: 'user', content: 'Find boards.'}]};
  await askBroker({...body, tools: [{type: 'web_search_20250305', name: 'web_search', max_uses: 3}]}, {env, fetchImpl});
  await askBroker(body, {env, fetchImpl});
  assert.equal(seen[0].search, true);
  assert.equal(Object.hasOwn(seen[1], 'search'), false);
});

// ai-broker 6/7 (owner, 1 Nov 2026: Claude, Codex or Free AI by one flag; CI should know which one answers).
test('the client talks to the AI broker: its audience and address, the new address variable first, the old one still honoured', () => {
  assert.equal(AUDIENCE, 'jobadabra-ai-broker');
  assert.equal(BROKER_URL({}), 'https://jobadabra-ai-broker.jobpilotto.workers.dev');
  assert.equal(BROKER_URL({CODEX_BROKER_URL: 'https://old.example'}), 'https://old.example');
  assert.equal(BROKER_URL({CODEX_BROKER_URL: 'https://old.example', AI_BROKER_URL: 'https://new.example'}), 'https://new.example');
});

test('the run token is asked for the AI broker audience', async () => {
  let asked = '';
  await askBroker({model: 'claude-haiku-5-5', messages: [{role: 'user', content: 'hi'}]}, {env, fetchImpl: async (url, init) => {
    if (String(url).startsWith('https://gh.example')) { asked = String(url); return new Response(JSON.stringify({value: 'jwt-for-run'})); }
    return new Response(JSON.stringify({reply: 'x', tokens: {input: 1, output: 1}}));
  }});
  assert.match(asked, /[?&]audience=jobadabra-ai-broker(&|$)/);
});

test('an answer says which engine wrote it and what it fell back from; aiLine is one line, printed once per distinct answer, never per call', async () => {
  resetTold();
  const lines = [], log = console.log;
  console.log = line => lines.push(String(line));
  try {
    const reply = extra => fake(() => new Response(JSON.stringify({reply: 'x', tokens: {input: 1, output: 1}, model: 'claude-haiku-5-5', tier: 'small', ...extra})));
    const first = await askBroker({model: 'claude-haiku-5-5', messages: [{role: 'user', content: 'hi'}]}, {env, fetchImpl: reply({engine: 'claude', fellBack: [{engine: 'codex', why: 'ran-out'}]})});
    for (let i = 0; i < 3; i++) await askBroker({model: 'claude-haiku-5-5', messages: [{role: 'user', content: 'hi'}]}, {env, fetchImpl: reply({engine: 'claude', fellBack: [{engine: 'codex', why: 'ran-out'}]})});
    await askBroker({model: 'claude-haiku-5-5', messages: [{role: 'user', content: 'hi'}]}, {env, fetchImpl: reply({engine: 'codex', model: 'gpt-6-luna'})});
    assert.deepEqual([first.engine, first.fellBack], ['claude', [{engine: 'codex', why: 'ran-out'}]]);
    assert.deepEqual(lines.filter(line => line.startsWith('AI: ')), ['AI: claude / claude-haiku-5-5 (codex ran-out)', 'AI: codex / gpt-6-luna']);
  } finally { console.log = log; }
  assert.equal(aiLine({}), '', 'an older broker that sends no engine prints nothing');
  assert.equal(aiLine({model: 'gpt-6-luna'}), 'AI: gpt-6-luna');
});
