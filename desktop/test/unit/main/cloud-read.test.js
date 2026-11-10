// The app's cloud read (lib/cloud-read.js): what the person's press ends in when the site's night is slow, loses a read, refuses, or is stopped. A form never hangs; a read is handed over once.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {GIVE_UP_MS, createCloudRead} from '../../../lib/cloud-read.js';

const JOBS = [{code: 'a', url: 'https://jobs.example/a', title: 'SRE', company: 'Acme'}, {code: 'b', url: 'https://jobs.example/b', title: 'Ops', company: 'Birch'}];
const READ = {eligible: true, simple: true};
function rig(takes, {send = {ok: true}, start = {ok: true}, ownKey = ''} = {}) {
  const seen = [], queue = [...takes];
  let clock = 0;
  const site = {readSend: async (_, jobs, options) => { seen.push(['send', jobs.length, options.ai]); return send; }, readStart: async () => { seen.push(['start']); return start; },
    readTake: async () => { seen.push(['take']); return queue.length > 1 ? queue.shift() : queue[0]; }, readStop: async () => { seen.push(['stop']); return {ok: true}; }};
  return {seen, reader: createCloudRead({storage: {}, jobs: JOBS, ownKey, site, wait: async ms => { clock += ms; }, now: () => clock}), tick: ms => { clock += ms; }};
}

test('reads arrive over several polls and each form gets its own; the own key travels only when set', async () => {
  const {reader, seen} = rig([{ok: true, pending: 1, reads: [{job: 'b', state: 'read', read: READ}]}, {ok: true, pending: 0, reads: [{job: 'a', state: 'unreadable', why: 'timeout'}]}], {ownKey: 'sk-ant-api03-xxxxxxxxxxxxxxxxxxxxxxxx'});
  assert.deepEqual(await reader.start(), {ok: true});
  assert.deepEqual(await reader.readForm(JOBS[1]), READ);
  assert.deepEqual(await reader.readForm(JOBS[0]), {unreadable: true, why: 'timeout'});
  await reader.done;
  assert.deepEqual(seen[0], ['send', 2, 'sk-ant-api03-xxxxxxxxxxxxxxxxxxxxxxxx']);
});

test("the site's refusal ends the press before anything starts, in the site's words", async () => {
  const {reader, seen} = rig([], {send: {ok: false, status: 429, error: "Today's cloud checks are used up (30 of 30 forms)."}});
  assert.deepEqual(await reader.start(), {ok: false, error: "Today's cloud checks are used up (30 of 30 forms)."});
  assert.deepEqual(seen.map(([name]) => name), ['send'], 'no start after a refused batch');
});

test('a read the site no longer has (a lost response, a read past its day) is a form that could not be read, not a hang', async () => {
  const {reader} = rig([{ok: true, pending: 0, reads: []}]);
  await reader.start();
  assert.deepEqual(await reader.readForm(JOBS[0]), {unreadable: true, why: 'lost'});
  assert.deepEqual(await reader.readForm(JOBS[1]), {unreadable: true, why: 'lost'});
});

test('a night that never finishes ends at the time limit with every open form unreadable', async () => {
  const {reader, seen} = rig([{ok: true, pending: 2, reads: []}]);
  await reader.start();
  assert.deepEqual(await reader.readForm(JOBS[0]), {unreadable: true, why: 'timeout'});
  assert.ok(seen.filter(([name]) => name === 'take').length >= GIVE_UP_MS / 4000 - 1, 'it kept asking until the limit');
});

test('Stop ends the site night and tells every open form there is no read', async () => {
  const {reader, seen} = rig([{ok: true, pending: 2, reads: []}]);
  await reader.start();
  const waiting = reader.readForm(JOBS[0]);
  await reader.stop();
  assert.equal(await waiting, null);
  assert.ok(seen.some(([name]) => name === 'stop'));
  assert.equal(reader.readForm({code: 'zzz'}), null, 'a form that was never in the batch has no cloud read');
});
