// Guard: privacy — the LinkedIn session leaves the Mac only in the one send call of the cloud probe, is never in a result, and a no-answer or a check is never retried.
import test from 'node:test';
import assert from 'node:assert/strict';
import {tryCloudRead, SEARCH} from '../../../lib/linkedin-cloud-probe.js';

const SECRET = 'AQEDAR-secret-li-at';
const fakeSession = {readSession: () => ({li_at: SECRET, JSESSIONID: '"ajax:1"'})};
// A fake site that, like lib/ready-site.js, tells every onTaken listener what a readTake took; `taken` are the reads each readTake call takes (another poll may take it first: `elsewhere`).
const run = ({reads = [], sendOk = true, isOwner = true, elsewhere = false, wait = async () => {}} = {}) => {
  const calls = {send: [], run: 0, take: 0, owner: 0};
  const listeners = new Set();
  let t = 0, sessionRead = 0;
  const site = {owner: async () => { calls.owner++; return isOwner; }, onTaken: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    linkedinSend: async (_s, body) => { calls.send.push(body); return sendOk ? {ok: true} : {ok: false, error: 'not available'}; }, linkedinRun: async () => { calls.run++; return {ok: true}; },
    readTake: async () => { const got = {ok: true, reads: reads[Math.min(calls.take++, reads.length - 1)] || []}; for (const fn of listeners) fn(got); return got; }};
  const session = {readSession: () => { sessionRead++; return fakeSession.readSession(); }};
  return {calls, listeners, sessionReads: () => sessionRead, result: tryCloudRead({}, {site, session, wait, now: () => (t += 60000)}), elsewhere};
};

test('one send of ONE search with the session, one start, and the answer without the session', async () => {
  const {calls, result} = run({reads: [[], [{job: 'probe', state: 'read', read: {word: 'ok', status: 200, cards: 9, go: true}}]]});
  const got = await result;
  assert.equal(calls.send.length, 1);
  assert.equal(calls.send[0].url, SEARCH);
  assert.equal(calls.run, 1);
  assert.deepEqual([got.ok, got.go, got.word, got.cards], [true, true, 'ok', 9]);
  assert.ok(!JSON.stringify(got).includes('secret'));
});

test('a non-owner install reads and sends nothing: the owner check comes before the Keychain', async () => {
  const refused = run({isOwner: false});
  const got = await refused.result;
  assert.equal(got.ok, false);
  assert.equal(refused.sessionReads(), 0, 'the session is never read');
  assert.equal(refused.calls.send.length, 0);
});

test('a read taken by another poll (readiness or Full automation share /reads) is still the probe\'s answer, and its listener is removed', async () => {
  const other = run({reads: [[{job: 'probe', state: 'read', read: {word: 'check', status: 200, cards: 0, go: false}}]]});
  other.listeners.add(() => {});   // another poll's own listener
  const before = other.listeners.size;
  const got = await other.result;
  assert.deepEqual([got.ok, got.word], [true, 'check']);
  assert.equal(other.listeners.size, before, 'the probe took its listener out');
});

test('a check page is a no, reported once, never retried', async () => {
  const {calls, result} = run({reads: [[{job: 'probe', state: 'read', read: {word: 'check', status: 200, cards: 0, go: false}}]]});
  const got = await result;
  assert.deepEqual([got.ok, got.go, got.word], [true, false, 'check']);
  assert.equal(calls.send.length, 1);
  assert.equal(calls.run, 1);
});

test('go needs the word ok too, an unknown word or an unreadable read is a no', async () => {
  assert.equal((await run({reads: [[{job: 'probe', state: 'read', read: {word: 'weird', go: true}}]]}).result).go, false);
  assert.equal((await run({reads: [[{job: 'probe', state: 'unreadable', read: null}]]}).result).word, 'error');
});

test('no session, a refused send, or no answer in time: not ok, no second try', async () => {
  assert.equal((await tryCloudRead({}, {session: {readSession: () => null}, site: {owner: async () => true}})).ok, false);
  const refused = run({sendOk: false});
  assert.equal((await refused.result).ok, false);
  assert.equal(refused.calls.run, 0);
  const silent = run({reads: [[]]});
  assert.equal((await silent.result).ok, false);
  assert.equal(silent.calls.send.length, 1);
});

import {registerLinkedinCloudHandlers} from '../../../lib/linkedin-cloud-handlers.js';

test('the IPC reaches nothing in demo mode, and a second press while one runs does not send a second read', async () => {
  const handlers = {};
  const ipcMain = {handle: (name, fn) => { handlers[name] = fn; }};
  registerLinkedinCloudHandlers({DEMO: true, ipcMain, storage: {}, probe: async () => { throw new Error('must not run'); }});
  assert.equal((await handlers.linkedinCloudProbe()).ok, false);
  let started = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  registerLinkedinCloudHandlers({DEMO: false, allowed: () => true, ipcMain, storage: {}, probe: async () => { started++; await gate; return {ok: true, go: false, word: 'check'}; }});
  const first = handlers.linkedinCloudProbe(), second = handlers.linkedinCloudProbe();
  release();
  assert.deepEqual([await first, await second], [{ok: true, go: false, word: 'check'}, {ok: true, go: false, word: 'check'}]);
  assert.equal(started, 1);
});

test('a packaged build without the Beta channel refuses before the session is read, and by default', async () => {
  const handlers = {};
  const ipcMain = {handle: (name, fn) => { handlers[name] = fn; }};
  const probe = async () => { throw new Error('must not run'); };
  registerLinkedinCloudHandlers({DEMO: false, ipcMain, storage: {}, probe});
  assert.equal((await handlers.linkedinCloudProbe()).ok, false);
  registerLinkedinCloudHandlers({DEMO: false, ipcMain, storage: {}, probe, allowed: () => false});
  assert.equal((await handlers.linkedinCloudProbe()).ok, false);
});
