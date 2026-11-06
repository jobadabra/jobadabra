// Guard: money — an alert may say credit or a limit ran out only when the broker said capped; without this a dropped connection sends the owner to top up a balance that is fine.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {outcomeOf} from '../../broker-relay-run.mjs';
import {causeOf} from '../../lib/ai-failure-words.mjs';
import {startRelay} from '../../lib/broker-relay-serve.mjs';
import {alertCappedSteps} from '../../credit-alert.mjs';
import {noteSkipped} from '../../lib/broker-job.mjs';
import {AiRefused, describe, kindOf, reportRefusal} from '../../../../tools/ci-intel/lib/ai-refusal.mjs';

const env = {CI_ALERTS_TELEGRAM_BOT_TOKEN: 't', CI_ALERTS_TELEGRAM_CHAT_ID: 'c', GITHUB_REPOSITORY: 'o/r', GITHUB_RUN_ID: '1', GITHUB_WORKFLOW: 'Central scout'};
const REFUSED = 'Codex refused the AI jobs of this run; they are skipped (grey), nothing is paid';

// One note through the real writer, then the real alert; returns the Telegram text and the log lines.
async function alertOf(note) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alert-')), lines = [], sent = [], print = console.log;
  console.log = () => {};
  try { noteSkipped({job: 'central-scout', ...note, dir, env: {}}); } finally { console.log = print; }
  await alertCappedSteps({artifacts: dir, verdict: REFUSED, env, log: line => lines.push(line), fetcher: async (url, init) => { sent.push(String(init.body)); return new Response('{"ok":true}'); }});
  fs.rmSync(dir, {recursive: true, force: true});
  return {text: sent.map(body => JSON.parse(body).text).join(''), lines};
}

test('one failed call of forty is told as what it was, with the count, never as credit or a refusal', async () => {
  const reason = 'no answer from the broker: fetch failed (UND_ERR_SOCKET: other side closed) after 63 s';
  const stats = {calls: 40, ok: 39, refused: 1, capHit: 0, latched: '', reasons: [reason], causes: {connection: {icon: '📡', label: causeOf(reason).label, count: 1}}};
  const done = outcomeOf(stats, 'central-scout');
  assert.match(done.why, /^1 of 40 AI calls failed \(no answer from the broker: fetch failed \(UND_ERR_SOCKET/);
  const {text, lines} = await alertOf(done);
  assert.match(text, /AI calls failed/);
  assert.match(text, /1 of 40 AI calls failed/);
  assert.doesNotMatch(text, /ran out|refused the AI/i);
  assert.ok(lines.every(line => line.startsWith('::warning title=AI calls failed::')), lines.join());
});

test('the broker\'s budget reason and the neuron cap are still told as credit', async () => {
  const stats = {calls: 12, ok: 11, refused: 3, capHit: 0, latched: 'the AI broker said no (broker: budget:own-share 66.0% of 60%)', reasons: []};
  for (const why of [outcomeOf(stats, 'central-scout').why, '100400 of 100000 neurons; 2 skipped step(s)']) {
    const {text} = await alertOf({why});
    assert.match(text, /AI credit ran out/);
    assert.match(text, /Codex refused the AI jobs/);
  }
});

test('a 503 about one bad reply, a lost login or a 401 is no credit, though the client files them under capped', async () => {
  for (const why of ['AI skipped/failed: 3 AI calls were refused (the AI broker said no (broker: fallback:reply-refused))', 'broker: login-lost', 'mail reading: 401: invalid x-api-key', 'unreadable of 100000 neurons; 0 skipped step(s)']) {
    const {text} = await alertOf({why});
    assert.doesNotMatch(text, /ran out|refused the AI/i, why);
    assert.doesNotMatch(text, /not a credit/i, 'a 503 can hide a used-up engine: the alert never claims it was not credit');
  }
  assert.equal(kindOf('capped', 'broker: fallback:reply-refused'), 'overloaded');
  assert.equal(kindOf('capped', 'broker: login-lost'), 'limit');
  assert.equal(kindOf('capped', 'broker: budget:week 100% of 100% (scheduled)'), 'limit');
});

test('a limit among many failed notes is the one the alert keeps', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alert-')), sent = [], print = console.log;
  console.log = () => {};
  try {
    for (const [job, why] of [['a', 'broker: 500'], ['b', 'broker: 502'], ['c', 'broker: 503'], ['d', 'broker: 504'], ['e', 'broker: budget:week 100% of 100%']]) noteSkipped({job, why, dir: path.join(dir, job), env: {}});
  } finally { console.log = print; }
  await alertCappedSteps({artifacts: dir, verdict: REFUSED, env, log: () => {}, fetcher: async (url, init) => { sent.push(String(init.body)); return new Response('{}'); }});
  fs.rmSync(dir, {recursive: true, force: true});
  assert.match(sent.join(''), /budget:week/);
});

test('a failed connection is its own kind and its words name no limit; a broker 5xx is not called unreachable', () => {
  assert.equal(kindOf('unreachable', 'no answer from the broker: fetch failed'), 'connection');
  const said = describe(new AiRefused('unreachable', 'no answer from the broker: fetch failed (ECONNRESET: read ECONNRESET) after 63 s'));
  assert.match(said, /^AI skipped \(connection\): no answer came back/);
  assert.doesNotMatch(said, /overloaded/);
  assert.doesNotMatch(describe(new AiRefused(500, 'broker: 500')), /unreachable/);
});

// The owner's two alerts of 6 Nov 2026, raw: a Codex schema refusal (3 of 40) and a 100 s kill (1 of 200).
const SCHEMA_REFUSED = "the AI service said no (broker: codex-failed:1 {\"error\":{\"message\":\"Invalid schema for response_format 'codex_output_schema': In context=(), 'required' is required to include every key in properties. Missing 'portals'.\",\"type\":\"invalid_request_error\"}})";
const KILLED = 'the AI service said no (broker: codex-failed:null [killed after 100 s: codex did not finish] [codex events: 2, last: thread.started > turn.started] {"type":"turn.started"})';

// A real relay on 127.0.0.1 whose broker answers `replies` in order (null = an answer); returns what the relay counted.
async function relayed(replies) {
  const queue = [...replies];
  const relay = await startRelay({answer: async () => {
    const reason = queue.shift();
    return reason === null ? {status: 200, contentType: 'application/json', body: Buffer.from('{}')}
      : {status: 502, contentType: 'application/json', body: Buffer.from(JSON.stringify({type: 'error', error: {type: 'api_error', message: reason}}))};
  }});
  for (let i = 0; i < replies.length; i++) await fetch(`${relay.url}/v1/messages`, {method: 'POST', body: '{}'});
  await relay.close();
  return relay.stats;
}

test('the owner\'s schema alert reads as a headline, a bar and one row per cause, with the real counts and none of the raw words', async () => {
  const stats = await relayed([...Array(37).fill(null), SCHEMA_REFUSED, SCHEMA_REFUSED, KILLED]);
  assert.equal(Object.values(stats.causes).reduce((n, one) => n + one.count, 0), stats.refused, 'every refused call is counted under one cause');
  const done = outcomeOf(stats, 'central-scout');
  assert.match(done.why, /codex-failed/, 'the log line keeps the raw words');
  const {text} = await alertOf(done);
  for (const line of ['Central scout: 3 of 40 AI calls failed', '▓▓▓▓▓▓▓▓▓░  37 worked · 3 failed', '🧩 2  Our request was refused (a bug on our side)', '⏱ 1  The AI took too long (over 100 s)',
    '✅ Nothing is lost', 'Open the run']) assert.ok(text.includes(line), `${line}\n${text}`);
  assert.ok(text.indexOf('🧩 2') < text.indexOf('⏱ 1'), 'the most frequent cause first');
  assert.doesNotMatch(text, /codex-failed|response_format|schema|portals|\{|thread\.started|ran out/i);
});

test('an unknown reason beside a timeout is the plain generic words, never its raw text', async () => {
  const stats = await relayed([...Array(2).fill(null), KILLED, 'something nobody has seen: 0xDEADBEEF']);
  const {text} = await alertOf(outcomeOf(stats, 'central-scout'));
  assert.ok(text.includes('2 of 4 AI calls failed') && text.includes('⚠️ 1  The AI service failed') && text.includes('⏱ 1  The AI took too long (over 100 s)'), text);
  assert.doesNotMatch(text, /DEADBEEF|nobody has seen/);
});

test('one timeout among 200, as the owner saw it, is told as "1 of 200" with its 199 answers in the bar', async () => {
  const {text} = await alertOf(outcomeOf(await relayed([...Array(199).fill(null), KILLED]), 'central-scout'));
  for (const line of ['Central scout: 1 of 200 AI calls failed', '199 worked · 1 failed', '⏱ 1  The AI took too long (over 100 s)']) assert.ok(text.includes(line), `${line}\n${text}`);
  assert.equal(text.split('\n').filter(line => /^\S+ \d+ {2}/.test(line)).length, 1, 'one cause, one row');
});

test('calls refused after the broker latched are counted in the total and under the same cause as the call that latched it', async () => {
  const stats = await relayed([null, 'ai-capped: fallback:unsupported', ...Array(10).fill('ai-capped: fallback:unsupported')]);
  assert.equal(stats.refused, 11, 'the latching call, and the 10 the broker never saw');
  const done = outcomeOf(stats, 'central-scout');
  assert.deepEqual([done.summary.calls, done.summary.ok, done.summary.failed], [12, 1, 11], 'the total is what the job asked, never "11 of 2"');
  assert.equal(done.summary.causes.length, 1, 'one cause is one row');
  assert.equal(done.summary.causes[0].count, 11);
});

test('a status code is a status only where it is written as one, never digits inside other words', () => {
  assert.equal(causeOf('no answer from the broker: fetch failed after 401 s').key, 'connection');
  for (const [reason, key] of [['HTTP 429 too many requests', 'rate'], ['broker: 401', 'login'], ['HTTP 400', 'request'], ['took 400 ms', 'failed'], ['HTTP 502', 'failed']]) assert.equal(causeOf(reason).key, key, reason);
});

test('the AI-refusal Telegram text carries the plain cause, never the broker\'s raw words', async () => {
  const sent = [], print = console.log;
  console.log = () => {};
  try {
    await reportRefusal(new AiRefused('unreachable', 'no answer from the broker: fetch failed (ECONNRESET: read ECONNRESET) after 63 s'), {job: 'Changelog publish', effect: 'a plain entry was published',
      env: {CI_ALERTS_TELEGRAM_BOT_TOKEN: 't', CI_ALERTS_TELEGRAM_CHAT_ID: 'c'}, fetch: async (url, init) => { sent.push(JSON.parse(init.body).text); return new Response('{}'); }});
  } finally { console.log = print; }
  assert.equal(sent.length, 1);
  assert.ok(sent[0].includes('📡 The connection to the AI service dropped') && sent[0].includes('a plain entry was published'), sent[0]);
  assert.doesNotMatch(sent[0], /ECONNRESET|63 s/);
});

test('a note without counts (another producer) is told by cause with no number, and two jobs add their real counts', async () => {
  const bare = (await alertOf({why: 'AI skipped/failed: 3 AI calls were refused (the AI broker said no (broker: codex-failed:1 {"x":1}))'})).text;
  assert.ok(bare.includes('AI calls failed') && bare.includes('The AI service failed'), bare);
  assert.doesNotMatch(bare, /\d+ of \d+|worked|codex-failed|\{/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alert-')), sent = [], print = console.log;
  console.log = () => {};
  try {
    noteSkipped({job: 'a', why: 'w1', summary: {calls: 10, ok: 9, failed: 1, causes: [{key: 'timeout', icon: '⏱', label: 'The AI took too long (over 100 s)', count: 1}]}, dir: path.join(dir, 'a'), env: {}});
    noteSkipped({job: 'b', why: 'w2', summary: {calls: 30, ok: 28, failed: 2, causes: [{key: 'timeout', icon: '⏱', label: 'The AI took too long (over 100 s)', count: 2}]}, dir: path.join(dir, 'b'), env: {}});
  } finally { console.log = print; }
  await alertCappedSteps({artifacts: dir, verdict: REFUSED, env, log: () => {}, fetcher: async (url, init) => { sent.push(String(init.body)); return new Response('{}'); }});
  fs.rmSync(dir, {recursive: true, force: true});
  const said = sent.map(body => JSON.parse(body).text).join('');
  assert.ok(said.includes('Central scout: 3 of 40 AI calls failed') && said.includes('⏱ 3  The AI took too long'), said);
});

test('every cause the broker and Codex are known to give has its plain words', () => {
  const cases = [[SCHEMA_REFUSED, 'request'], [KILLED, 'timeout'], ['no answer from the broker: fetch failed (ECONNRESET) after 63 s', 'connection'], ['broker: login-lost', 'login'],
    ['broker: budget:week 100% of 100%', 'allowance'], ['HTTP 429 too many requests', 'rate'], ['relay: boom', 'failed'], ['', 'failed'], [undefined, 'failed']];
  for (const [reason, key] of cases) assert.equal(causeOf(reason).key, key, String(reason));
  assert.equal(causeOf(KILLED).label, 'The AI took too long (over 100 s)');
});
