// Guard: safety — without it, a CI search could open a refusing board page the shared mark refused (a retry of a 401/403), or read one when the mark cannot answer.
// CI's side of the broker's board mark (tools/persona-search/board-mark.mjs; owner, 14 Nov 2026: "Once per search page (Recommended)", "For good (Recommended)").
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {markSeams, toCard, WAIT_READING_MS} from '../../../../tools/persona-search/board-mark.mjs';

const item = {url: 'https://www.trans.bg/search?q=driver', name: 'TRANS.BG', kind: 'board'};
const job = {title: 'Шофьор', url: 'https://www.trans.bg/job/1', company: 'Acme', place: 'София', date: '2026-11-13'};
const answers = list => { const sent = []; return {sent, post: async body => { sent.push(body); return list.length > 1 ? list.shift() : list[0]; }}; };

test('only a go opens the page; every other answer of the mark is a skip with its reason, a reused page comes back as cards', async () => {
  for (const [json, expect] of [
    [{go: true}, {go: true}],
    [{go: false, state: 'stopped'}, /turned CI's browser away before/],
    [{go: false, state: 'waiting'}, /slow down/],
    [{go: false, state: 'host-full'}, /daily reads are used/],
    [{go: false, state: 'something new'}, /not opened/],
  ]) {
    const {post} = answers([{status: 200, json}]);
    const verdict = await markSeams(post).ask(item);
    if (expect instanceof RegExp) { assert.equal(verdict.go, false); assert.match(verdict.why, expect); } else assert.deepEqual(verdict, expect);
  }
  const {post} = answers([{status: 200, json: {go: false, state: 'opened', jobs: [job], read_by: 'pair#1'}}]);
  assert.deepEqual(await markSeams(post).ask(item), {go: false, cards: [toCard(job)], from: 'pair#1'});
  assert.deepEqual(toCard(job), {title: 'Шофьор', url: 'https://www.trans.bg/job/1', place: 'София', company: 'Acme'});
});

test('no answer from the mark is never a read: a failed call, a non-200 and a CI run with no token all skip', async () => {
  for (const post of [async () => { throw new Error('offline'); }, async () => ({status: 401, json: {}}), async () => ({status: 503, json: {}})]) {
    const verdict = await markSeams(post).ask(item);
    assert.equal(verdict.go, false); assert.match(verdict.why, /did not answer/);
  }
  assert.equal((await markSeams(null, {ci: true}).ask(item)).go, false, 'in CI without a token');
  assert.deepEqual(await markSeams(null, {ci: false}).ask(item), {go: true}, 'on the owner\'s Mac, one install: the app\'s own limits');
});

test('a page another CI search is still reading is waited for (a pair\'s other side), then reused; past the wait it is skipped, never opened', async () => {
  let t = 0;
  const clock = {now: () => t, sleep: async ms => { t += ms; }};
  const {post, sent} = answers([{status: 200, json: {go: false, state: 'reading'}}, {status: 200, json: {go: false, state: 'reading'}}, {status: 200, json: {go: false, state: 'opened', jobs: [job]}}]);
  assert.equal((await markSeams(post, clock).ask(item)).cards.length, 1);
  assert.equal(sent.length, 3);
  t = 0;
  const still = answers([{status: 200, json: {go: false, state: 'reading'}}]);
  const verdict = await markSeams(still.post, clock).ask(item);
  assert.equal(verdict.go, false); assert.match(verdict.why, /still reading/);
  assert.ok(t >= WAIT_READING_MS);
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
