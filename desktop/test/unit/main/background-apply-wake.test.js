// A queued Background / Full automation job wakes the hidden browser's poll at once (Why 10 Nov 2026, hw): the poll that claims a queued job came only with the extension's 30 s tab report.
// Guard: release — without it every job queued while the hidden browser already runs (the second batch, every Full automation batch after its form check) waits up to 30 s before its form opens.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createBackgroundApplyController} from '../../../lib/background-apply-controller.js';

const now = Date.parse('2026-11-10T10:00:00Z');
function rig({wake, enrolled = true} = {}) {
  const events = [];
  const controller = createBackgroundApplyController({}, {
    store: {queue: async (url, id, mode) => { events.push('queued'); return {session: id, mode, state: 'queued'}; }, read: async () => ({session: 's1', state: 'queued'})},
    browser: {ready: () => true, start: async () => { events.push('started'); return {owner: 'o1'}; }, ...(wake ? {wake: () => { events.push('wake'); return wake(); }} : {})},
    terminals: {list: () => [], byUrl: () => null, startForm: ({id}) => ({id}), record: () => null, report: () => {}},
    config: () => ({mode: 'fill', chosenAt: 'c1'}), now: () => now, token: () => 't', notify: () => {}, stop: () => false, log: (_area, line) => events.push(`log:${line}`)});
  return {events, enqueue: () => controller.enqueue([{url: 'https://jobs.example.test/a'}], 'fill', {autoConfirmedAt: ''})};
}

test('queueing a job wakes the hidden browser once, after the job is in the queue', async () => {
  const {events, enqueue} = rig({wake: async () => true});
  assert.equal((await enqueue()).ok, true);
  assert.deepEqual(events.filter(event => !event.startsWith('log:')), ['queued', 'started', 'wake']);
});

test('a wake that fails or throws is logged and never fails the queueing', async () => {
  for (const wake of [async () => false, async () => { throw new Error('socket closed'); }]) {
    const {events, enqueue} = rig({wake});
    assert.equal((await enqueue()).ok, true);
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(events.some(event => /^log:queued jobs: the hidden browser (did not take the wake|could not be woken)$/.test(event)), 'the missed wake is logged; the 30 s report still claims the job');
  }
});

test('the wake is not waited for inside the queueing: its poll would wait for that same turn', async () => {
  let release, done = false;
  const {enqueue} = rig({wake: () => new Promise(resolve => { release = resolve; })});
  const queued = enqueue().then(result => { done = true; return result; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof release, 'function', 'the wake was asked for');
  assert.equal(done, true, 'enqueue returned while the wake was still out');
  assert.equal((await queued).ok, true);
  release(true);
});
