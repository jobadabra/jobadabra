// When the person was away (spec docs/superpowers/specs/2026-11-02-notify-moments-design.md, 2/2): "while you were away" in a pop-up is true only for something that ended between the moment they left
// the app (the window lost focus, hid, minimized, closed) and the moment they came back (focus). Both are stamped, each at most once a minute.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createWindowSeen} from '../lib/window-seen.js';

const MIN = 60 * 1000;
const T0 = Date.parse('2026-11-02T09:00:00Z');
const iso = ms => new Date(ms).toISOString();
function world() {
  const kept = {}, clock = {t: T0};
  const storage = {settings: () => kept, saveSettings: patch => Object.assign(kept, patch)};
  return {seen: createWindowSeen(storage, {now: () => clock.t}), kept, clock};
}

test('leaving and coming back are two stamps; a second of the same kind inside a minute is not written again', () => {
  const {seen, kept, clock} = world();
  seen.left();
  assert.equal(kept.windowSeenAt, iso(T0));
  clock.t = T0 + 30 * 1000;
  seen.left();
  assert.equal(kept.windowSeenAt, iso(T0), 'inside a minute: not rewritten');
  seen.back();
  assert.equal(kept.windowBackAt, iso(T0 + 30 * 1000), 'the other kind is independent');
  clock.t = T0 + 2 * MIN;
  seen.left();
  assert.equal(kept.windowSeenAt, iso(T0 + 2 * MIN));
});
