// LinkedIn Easy Apply's limits, plan 2/5 (spec docs/superpowers/specs/2026-11-13-linkedin-easy-apply-design.md D2, D3): at most 15 sends a local day, at least 2 min apart, a press counts even when
// LinkedIn refuses it, the count survives a restart; any LinkedIn warning pauses ALL LinkedIn for 24 h through the one shared pause, and a second one turns Easy Apply off. lib/easy-apply-limits.js.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {CAP, GAP_MS, STOP_MS, notePress, noteStop, turn} from '../../../lib/easy-apply-limits.js';
import {state, turnOn} from '../../../lib/easy-apply-switch.js';
import {pausedUntil} from '../../../lib/linkedin-session.js';

// Local times (year, month index, day, hour, minute), so the "local day" holds in any time zone CI runs in.
const at = (day, hour, minute = 0) => new Date(2026, 10, day, hour, minute);
const WARNED = at(13, 9).toISOString();
function store(settings = {linkedinJobs: {on: true}, easyApply: {on: true, warnedAt: WARNED}}) {
  let mine = structuredClone(settings);
  return {get mine() { return mine; }, settings: () => mine, saveSettings: patch => { mine = {...mine, ...patch}; return mine; }};
}
const restart = storage => store(storage.mine);   // settings are on disk: a new app reads the same file

test('the cap: 15 a local day, 2 min apart, a refused press counts, and a restart keeps the count', () => {
  let storage = store();
  let now = at(13, 10);
  for (let sent = 0; sent < CAP; sent += 1) {
    assert.deepEqual(turn(storage, now), {go: true}, `send ${sent + 1}`);
    notePress(storage, now);   // pressed: counts whatever LinkedIn answers (sent 7 below is a refused one)
    const early = new Date(now.getTime() + GAP_MS - 1000);
    if (sent + 1 < CAP) assert.deepEqual(turn(storage, early), {wait: 'gap', until: now.getTime() + GAP_MS}, 'never under 2 min apart');
    now = new Date(now.getTime() + GAP_MS);
    if (sent === 7) storage = restart(storage);
  }
  assert.equal(storage.mine.easyApply.cap.sent, CAP);
  const sixteenth = turn(storage, at(13, 23, 59));
  assert.deepEqual(sixteenth, {wait: 'cap', until: at(14, 0).getTime()}, 'the 16th waits for the next local date');
  assert.deepEqual(turn(restart(storage), at(13, 23, 59)), sixteenth, 'and so after a restart');
  assert.deepEqual(turn(storage, at(14, 0, 1)), {go: true}, 'a new date starts at 0');
  notePress(storage, at(14, 0, 1));
  assert.deepEqual(storage.mine.easyApply.cap, {day: '2026-11-14', sent: 1, lastAt: at(14, 0, 1).toISOString()});
});

test('off, or LinkedIn jobs off: no turn at all', () => {
  assert.deepEqual(turn(store({linkedinJobs: {on: true}, easyApply: {on: false, warnedAt: WARNED}}), at(13, 10)), {wait: 'off'});
  assert.deepEqual(turn(store({linkedinJobs: {on: false}, easyApply: {on: true, warnedAt: WARNED}}), at(13, 10)), {wait: 'off'});
});

test('a read\'s pause holds Easy Apply too: no send until the shared pause ends', () => {
  const until = at(14, 12);
  const storage = store({linkedinJobs: {on: true, pauseUntil: until.toISOString()}, easyApply: {on: true, warnedAt: WARNED}});
  assert.deepEqual(turn(storage, at(13, 12)), {wait: 'paused', until: until.getTime()});
  assert.deepEqual(turn(storage, new Date(until.getTime() + 1)), {go: true});
});

test('a LinkedIn warning pauses all LinkedIn 24 h; the second turns Easy Apply off and keeps the pause; turning it on again counts from 0', () => {
  const storage = store();
  const first = noteStop(storage, at(13, 10));
  assert.deepEqual(first, {until: at(13, 10).getTime() + STOP_MS, off: false});
  assert.equal(pausedUntil(storage), at(14, 10).getTime(), 'the one shared pause: the guest and signed-in reads stop too');
  assert.deepEqual(turn(storage, at(14, 9, 59)), {wait: 'paused', until: at(14, 10).getTime()}, 'no retry inside the 24 h');
  const second = noteStop(storage, at(14, 11));
  assert.deepEqual(second, {until: at(15, 11).getTime(), off: true});
  assert.equal(state(storage).on, false, 'a second stop turns the switch off');
  assert.equal(pausedUntil(storage), at(15, 11).getTime(), 'and the pause stays after it goes off');
  assert.equal(storage.mine.linkedinJobs.on, true, 'LinkedIn jobs itself is not switched off');
  assert.deepEqual(turnOn(storage, {now: at(16, 9)}), {ok: true}, 'warned once already: on again');
  assert.equal(storage.mine.easyApply.stops, 0, 'a new yes counts stops from 0');
  assert.equal(noteStop(storage, at(16, 10)).off, false, 'so the next warning only pauses');
});
