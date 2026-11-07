// Guard: safety — `npm run twin -- --replay <id>` must never write into the owner's real app folder, and the Admin key travels only in the Authorization header.
// The session record and job row of a reported bug land in the twin's folder; a bad id, a wrong key or an expired bundle stops with words.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {describeReplay, fetchBundle, loadBundle} from '../../lib/twin-replay.mjs';

const ID = '0123456789abcdef';
const BUNDLE = {report: {title: 'Phone label', severity: 'high', journey: 'J12', expected: 'typed phone', seen: 'label shown'}, env: {appVersion: '0.9.12'},
  state: {sessions: [{id: 's1', url: 'https://x.test/job', title: 'Designer', company: 'Acme', status: 'input'}, null, {noId: true}], job: {title: 'Designer', url: 'https://x.test/job'}}};

test('the bundle lands in the twin\'s folder: sessions join sessions.json (restored as stopped), the job row is a file; the real folder is refused', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'twin-replay-'));
  try {
    const home = path.join(root, 'twin'), real = path.join(root, 'real');
    fs.mkdirSync(home); fs.writeFileSync(path.join(home, 'sessions.json'), JSON.stringify([{id: 'old'}, {id: 's1', stale: true}]));
    const loaded = loadBundle(ID, BUNDLE, home, {real});
    assert.deepEqual([loaded.sessions, loaded.job], [1, true]);
    const records = JSON.parse(fs.readFileSync(path.join(home, 'sessions.json'), 'utf8'));
    assert.deepEqual(records.map(record => record.id), ['old', 's1']);
    assert.equal(records[1].status, 'ended');
    assert.ok(!records[1].stale, 'the bundle\'s record replaces an old one of the same id');
    assert.equal(JSON.parse(fs.readFileSync(path.join(home, 'replay', ID, 'job.json'), 'utf8')).title, 'Designer');
    assert.throws(() => loadBundle(ID, BUNDLE, real, {real}), /never writes into the real app folder/);
    assert.ok(!fs.existsSync(real), 'nothing was created in the real folder');
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
});

test('fetching sends the key only as the bearer, refuses a bad id, and says words for an expired bundle', async () => {
  const calls = [];
  const fetcher = async (url, init) => { calls.push({url: String(url), init}); return new Response(JSON.stringify({ok: 1}), {status: 200}); };
  await fetchBundle(ID, {key: 'SECRET', fetcher});
  assert.deepEqual(calls.map(call => call.url.split('/').pop()), ['report.json', 'state.json', 'env.json']);
  assert.ok(calls.every(call => call.init.headers.Authorization === 'Bearer SECRET' && !call.url.includes('SECRET')));
  await assert.rejects(fetchBundle('../x', {key: 'k', fetcher}), /16 characters/);
  await assert.rejects(fetchBundle(ID, {key: '', fetcher}), /no Admin key/);
  await assert.rejects(fetchBundle(ID, {key: 'k', fetcher: async () => new Response('Not found', {status: 404})}), /not kept/);
});

test('the replay says the bug first and warns when the app version differs', () => {
  assert.deepEqual(describeReplay(BUNDLE, {version: '0.9.12'}), ['bug: Phone label [high, journey J12]', 'expected: typed phone', 'seen: label shown']);
  assert.match(describeReplay(BUNDLE, {version: '0.9.13'}).at(-1), /seen on app 0\.9\.12; this checkout is 0\.9\.13/);
});

test('a malformed or old record from a tester cannot break the Sessions list or reach outside the twin', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'twin-replay-'));
  try {
    const home = path.join(root, 'twin'), real = path.join(root, 'real'), now = new Date('2026-11-07T10:00:00Z');
    const state = {sessions: [{id: 'a1', url: null, title: 5, company: undefined, startedAt: 12, transcript: '/etc/passwd', claudeId: 'x', output: 'secret'}, {id: '../escape'}, {id: 'old', url: 'https://x.test', startedAt: '2026-08-01T00:00:00Z'}]};
    assert.throws(() => loadBundle('../../x', {state}, home, {real}), /bundle id/);
    assert.equal(loadBundle(ID, {state}, home, {real, now}).sessions, 2);
    const records = JSON.parse(fs.readFileSync(path.join(home, 'sessions.json'), 'utf8'));
    for (const record of records) {
      for (const field of ['url', 'title', 'company', 'note', 'startedAt']) assert.equal(typeof record[field], 'string', `${field} is a string`);
      assert.equal(record.startedAt, now.toISOString(), 'an old bug is not dropped by the app\'s 14-day restore');
      assert.ok(!record.transcript && !record.claudeId && !record.output, 'no transcript path, Claude id or output is carried');
    }
    assert.deepEqual(records.map(record => record.id), ['a1', 'old'], 'the record with a path in its id is not written');
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
});

test('a wrong key, a non-JSON body and a network error each stop with words', async () => {
  await assert.rejects(fetchBundle(ID, {key: 'k', fetcher: async () => new Response('no', {status: 401})}), /answered 401/);
  await assert.rejects(fetchBundle(ID, {key: 'k', fetcher: async () => new Response('<html>', {status: 200})}), SyntaxError);
  await assert.rejects(fetchBundle(ID, {key: 'k', fetcher: async () => { throw new Error('offline'); }}), /offline/);
});
