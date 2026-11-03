// The footer's "Next refresh" (a Windows tester on 0.9.2, 3 Nov 2026: at 02:00 it still read "Next refresh 01:53 AM" and looked like a refresh that never ran). The app checks its
// schedule every 10 minutes (lib/schedule.js), so a time a few minutes in the past is normal and must say "due now", the same words Upcoming checks and Status use.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

// Why (fx, 3 Nov 2026): the pages start timers at import; they must not hold the test process open (see test/cv-replace.test.js).
const realInterval = globalThis.setInterval;
globalThis.setInterval = (...args) => realInterval(...args).unref();
install();
const doc = globalThis.document, found = doc.getElementById.bind(doc);
doc.getElementById = id => {
  let node = found(id);
  if (!node) { node = doc.createElement('div'); node.id = id; doc.body.append(node); }
  return node;
};
globalThis.window.dispatchEvent = () => true;
globalThis.Event ??= class { constructor(type) { this.type = type; } };
globalThis.window.pilot = new Proxy({}, {get: () => async () => null});
const {nextWords} = await import('../renderer/pages/activity-basics.js');
const {renderActivity} = await import('../renderer/pages/activity-render.js');
const {shared} = await import('../renderer/pages/shared.js');
shared.state = {settings: {}, secrets: {}};
const $ = id => doc.getElementById(id);
const local = (day, hour, minute) => new Date(2026, 10, day, hour, minute).getTime();   // 2 Nov 2026 is the tester's Monday

test('a time that has passed says "due now"; later today, tomorrow and another day say when', () => {
  const now = local(3, 2, 0);
  assert.equal(nextWords(local(3, 1, 53), now), 'due now', 'the tester\'s 01:53, seen at 02:00');
  assert.equal(nextWords(now, now), 'due now');
  assert.match(nextWords(local(3, 14, 0), now), /^Today \d/);
  assert.match(nextWords(local(4, 1, 53), now), /^Tomorrow \d/);
  assert.doesNotMatch(nextWords(local(7, 1, 53), now), /^(Today|Tomorrow|due)/);
});

test('the footer after a run that stopped, with the next refresh already past: "Next refresh due now", not a bare past time', () => {
  const past = Date.now() - 7 * 60000;
  const stopped = {id: 1, kind: 'search', ok: false, startedAt: new Date(past - 4 * 3600000).toISOString(), endedAt: new Date(past - 4 * 3600000).toISOString(), result: 'stopped without finishing (see Recent activity)', trigger: 'schedule', where: 'mac'};
  const warnIcon = doc.createElement('span');   // the warnings box draws its icon into this child
  warnIcon.className = 'ap-warn-icon';
  $('activity-warnings').append(warnIcon);
  renderActivity({running: null, runs: [stopped], queued: [], nextSearchAt: past, nextMailAt: null, nextScoutAt: null, historyLoaded: true});
  assert.match($('activity-meta').textContent, /Next refresh due now/);
  assert.doesNotMatch($('activity-meta').textContent, /Next refresh \d/);
});
