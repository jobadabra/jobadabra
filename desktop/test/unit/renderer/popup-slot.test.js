// One connection pop-up per app open (owner, 2 Nov 2026: "I don't want to overwhelm the user"; spec docs/superpowers/specs/2026-11-02-notify-moments-design.md): Gmail, Always on and the
// notification pop-ups offer themselves to ONE slot; the highest rank opens, the others wait for a later app open (their "shown once" is written only when their own dialog opens).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createPopupSlot} from '../../../renderer/popup-slot.js';

// A fake timer: run() fires the one pending collection window.
function world() {
  let pending = null;
  const slot = createPopupSlot({setTimer: fn => { pending = fn; return 1; }, windowMs: 5000});
  return {slot, run: async () => { const fn = pending; pending = null; await fn(); }, armed: () => pending !== null};
}
const popup = (id, rank, opened, shows = true) => ({id, rank, open: async () => { opened.push(id); return shows; }});

test('three offers inside the window: only the highest rank opens', async () => {
  const {slot, run} = world(), opened = [];
  slot.offer(popup('always-on', 1, opened));
  slot.offer(popup('stuck', 3, opened));
  slot.offer(popup('code', 2, opened));
  await run();
  assert.deepEqual(opened, ['stuck']);
});

test('after one opened, a later offer in the same app run is refused: no second pop-up', async () => {
  const {slot, run, armed} = world(), opened = [];
  slot.offer(popup('code', 2, opened));
  await run();
  assert.equal(slot.offer(popup('gmail-applied', 1, opened)), false);
  assert.equal(armed(), false, 'no new window is armed');
  assert.deepEqual(opened, ['code']);
});

test('a winner that does not show (connected meanwhile, another dialog is open) does not use the slot: the next rank gets its turn', async () => {
  const {slot, run} = world(), opened = [];
  slot.offer(popup('stuck', 3, opened, false));
  slot.offer(popup('missed', 1, opened));
  await run();
  assert.deepEqual(opened, ['stuck', 'missed']);
});

test('nothing opened: the slot stays free for a later moment in the same run', async () => {
  const {slot, run} = world(), opened = [];
  slot.offer(popup('a', 1, opened, false));
  await run();
  assert.equal(slot.offer(popup('b', 1, opened)), true);
  await run();
  assert.deepEqual(opened, ['a', 'b']);
});

test('the same id offered twice in the window counts once (a moment asks again on wake)', async () => {
  const {slot, run} = world(), opened = [];
  slot.offer(popup('missed', 1, opened)); slot.offer(popup('missed', 1, opened));
  await run();
  assert.deepEqual(opened, ['missed']);
});

test('an open() that throws is skipped, not fatal', async () => {
  const {slot, run} = world(), opened = [];
  slot.offer({id: 'broken', rank: 3, open: async () => { throw new Error('boom'); }});
  slot.offer(popup('fine', 1, opened));
  await run();
  assert.deepEqual(opened, ['fine']);
});
