// Guard: safety — without it, a CI search could open a refusing board page the shared mark refused (a retry of a 401/403), or read one when the mark cannot answer.
// CI's side of the broker's board mark (tools/persona-search/board-mark.mjs; owner, 14 Nov 2026: "Once per search page (Recommended)", "For good (Recommended)").
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {OWN_MAX_MS, OWN_STEP_MS, brokerPost, markSeams, toCard} from '../../../../tools/persona-search/board-mark.mjs';
import {boardForward} from '../../../../tools/persona-search/codex.mjs';

const item = {url: 'https://www.trans.bg/search?q=driver', name: 'TRANS.BG', kind: 'board'};
const job = {title: 'Шофьор', url: 'https://www.trans.bg/job/1', company: 'Acme', place: 'София', date: '2026-11-13'};
const answers = list => { const sent = []; return {sent, post: async body => { sent.push(body); return list.length > 1 ? list.shift() : list[0]; }}; };

test('only a go opens the page; every other answer of the mark is a skip with its reason, a reused page comes back as cards', async () => {
  for (const [json, expect] of [
    [{go: true}, {go: true}],
    [{go: false, state: 'stopped'}, /turned CI's browser away before/],
    [{go: false, state: 'waiting'}, /slow down/],
    [{go: false, state: 'host-full'}, /daily reads are used/],
    [{go: false, state: 'reading'}, /reading this page right now; not opened twice, not waited for/],
    [{go: false, state: 'something new'}, /not opened/],
  ]) {
    const {post} = answers([{status: 200, json}]);
    const verdict = await markSeams(post).ask(item);
    if (expect instanceof RegExp) { assert.equal(verdict.go, false); assert.match(verdict.why, expect); } else assert.deepEqual(verdict, expect);
  }
  const {post} = answers([{status: 200, json: {go: false, state: 'opened', jobs: [job], read_by: 'pair#1'}}]);
  assert.deepEqual(await markSeams(post).ask(item), {go: false, cards: [toCard(job)], from: 'pair#1'});
  assert.deepEqual(toCard(job), {title: 'Шофьор', url: 'https://www.trans.bg/job/1', place: 'София', company: 'Acme', date: '2026-11-13'});
});

test('no answer from the mark is never a read: a failed call, a non-200 and a CI run with no token all skip', async () => {
  for (const post of [async () => { throw new Error('offline'); }, async () => ({status: 401, json: {}}), async () => ({status: 503, json: {}})]) {
    const verdict = await markSeams(post).ask(item);
    assert.equal(verdict.go, false); assert.match(verdict.why, /did not answer/);
  }
  assert.equal((await markSeams(null, {ci: true}).ask(item)).go, false, 'in CI without a token');
  assert.deepEqual(await markSeams(null, {ci: false}).ask(item), {go: true}, 'on the owner\'s Mac, one install: the app\'s own limits');
});

test('a page another CI search is reading is skipped at once, asked once, never waited for (owner, 14 Nov 2026: "No wait, skip")', async () => {
  const {post, sent} = answers([{status: 200, json: {go: false, state: 'reading'}}]);
  const verdict = await markSeams(post).ask(item);
  assert.equal(verdict.go, false); assert.equal(sent.length, 1);
});

test('after a read the mark is told how it ended: jobs as opened, a stop or a 429 as such, anything else not at all (the page stays reading)', async () => {
  const {post, sent} = answers([{status: 200, json: {}}]);
  const {told} = markSeams(post);
  await told(item, {state: 'read', jobs: 23, listing: [job]});
  await told(item, {state: 'stopped', why: 'HTTP 403'});
  await told(item, {state: 'waiting', why: 'asked us to slow down'});
  await told(item, {state: 'skipped'});
  assert.deepEqual(sent, [
    {op: 'report', page: item.url, outcome: 'opened', jobs: [job], count: 23},
    {op: 'report', page: item.url, outcome: 'stopped', why: 'HTTP 403'},
    {op: 'report', page: item.url, outcome: 'waiting', why: 'asked us to slow down'},
  ]);
});

test('a pair side waits for its own run\'s read of the page and gets the same cards; another run\'s read stays a skip', async () => {
  const naps = [];
  const sleep = async ms => { naps.push(ms); };
  const {post, sent} = answers([{status: 200, json: {go: false, state: 'reading', own: true}}, {status: 200, json: {go: false, state: 'reading', own: true}},
    {status: 200, json: {go: false, state: 'opened', jobs: [job], read_by: 'pair#1'}}]);
  assert.deepEqual(await markSeams(post, {sleep}).ask(item), {go: false, cards: [toCard(job)], from: 'pair#1'});
  assert.equal(sent.length, 3, 'asked again until the other side reported');
  assert.equal(naps.length, 2);
  const own = answers([{status: 200, json: {go: false, state: 'reading', own: true}}, {status: 200, json: {go: false, state: 'stopped'}}]);
  assert.match((await markSeams(own.post, {sleep}).ask(item)).why, /turned CI's browser away before/, 'the other side was stopped: this side skips, never opens');
});

test('Gitar on #4355: a pair side whose other side never reports stops waiting after the longest read and skips, never opens', async () => {
  const naps = [];
  const {post, sent} = answers([{status: 200, json: {go: false, state: 'reading', own: true}}]);
  const verdict = await markSeams(post, {sleep: async ms => { naps.push(ms); }}).ask(item);
  assert.equal(verdict.go, false);
  assert.match(verdict.why, /did not report its read within 90 s/);
  assert.equal(naps.length * OWN_STEP_MS, OWN_MAX_MS, 'waited exactly the longest read');
  assert.equal(sent.length, naps.length + 1);
});

test('the own-read wait ends with the press: a Stop or the deadline during the wait opens nothing and asks no more', async () => {
  const stop = new AbortController();
  const {post, sent} = answers([{status: 200, json: {go: false, state: 'reading', own: true}}]);
  const pending = markSeams(post).ask(item, stop.signal);
  setImmediate(() => stop.abort());
  const verdict = await pending;
  assert.equal(verdict.go, false);
  assert.match(verdict.why, /stopped/);
  assert.equal(sent.length, 1, 'the real nap ends at once on the abort; no second ask');
});

test('Gitar on #4306: a Stop before the ask sends nothing', async () => {
  const stop = new AbortController(); stop.abort();
  const {post, sent} = answers([{status: 200, json: {go: true}}]);
  assert.equal((await markSeams(post).ask(item, stop.signal)).go, false);
  assert.equal(sent.length, 0);
});

test('under the relay (codex.mjs) the mark is asked through it: the child sends no token, the relay signs with the run\'s own and passes the body as sent', async () => {
  const seen = [];
  const fetchImpl = async (url, init = {}) => { seen.push({url, auth: init.headers?.authorization || null, body: init.body || null, bounded: init.signal instanceof AbortSignal});
    return url.includes('id-token') ? {ok: true, status: 200, json: async () => ({value: 'run-token'})} : {ok: true, status: 200, json: async () => ({go: true}), text: async () => '{"go":true}'}; };
  const post = await brokerPost({JOBADABRA_BOARD_MARK_URL: 'http://127.0.0.1:9/board-read'}, fetchImpl);
  assert.deepEqual(await post({op: 'reserve', page: item.url}), {status: 200, json: {go: true}});
  assert.deepEqual(seen.at(-1), {url: 'http://127.0.0.1:9/board-read', auth: null, body: JSON.stringify({op: 'reserve', page: item.url}), bounded: true}, 'no token in the child, a bounded call');
  const env = {ACTIONS_ID_TOKEN_REQUEST_URL: 'https://gh.example/id-token?x=1', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 't', AI_BROKER_URL: 'https://broker.example'};
  const reserve = JSON.stringify({op: 'reserve', page: item.url});
  assert.deepEqual(await boardForward(reserve, {env, fetchImpl}), {status: 200, body: '{"go":true}'});
  assert.deepEqual(seen.at(-1), {url: 'https://broker.example/board-read', auth: 'Bearer run-token', body: reserve, bounded: true});
  assert.equal((await boardForward(reserve, {env: {}, fetchImpl})).status, 503, 'no run token in the relay: a refusal, so the caller skips');
  const before = seen.length;
  for (const text of ['{"op":"peek","page":"https://a.example/x"}', '{"op":"reserve","page":"file:///etc/passwd"}', 'not json', '{"op":"report"}']) {
    assert.equal((await boardForward(text, {env, fetchImpl})).status, 400, `the relay signs only the mark's two calls: ${text}`);
  }
  assert.equal(seen.length, before, 'nothing refused is sent or signed (Gitar on #4344)');
});

test('CI\'s board browser drops the sandbox only on Linux, by the harness\'s one rule (Gitar on #4333)', async () => {
  const {sandboxArgs} = await import('../../../e2e/lib/hidden-browser-env.mjs');
  assert.deepEqual(sandboxArgs('linux'), ['--no-sandbox']);
  for (const platform of ['darwin', 'win32']) assert.deepEqual(sandboxArgs(platform), [], `${platform} keeps the sandbox`);
});
