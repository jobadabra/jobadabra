// #3911 (owner, 12 Nov 2026: "Why I don't get any notification or feedback"): the one notice for a LinkedIn sign-in that needs the person, and the "renewed" after it. lib/linkedin-notice.js.
// Raised by the verdict of a read (lib/linkedin-session.js noteRun), through the app's notify(); "needs you" at most once a day (mac-9a, 12 Nov 2026), "renewed" once.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {linkedinTell, noticeWords, DAY_MS} from '../../../lib/linkedin-notice.js';
import {clean} from '../../../renderer/targets.js';

const LOCALES = ['en', 'de', 'fr', 'it', 'es', 'ro', 'ru'];
const store = (settings = {}) => ({settings: () => settings, saveSettings: patch => Object.assign(settings, patch)});
const rig = (settings = {linkedinJobs: {on: true}}, at = Date.parse('2026-11-12T18:00:00Z')) => {
  const calls = [], storage = store(settings), clock = {at};
  return {calls, storage, clock, tell: linkedinTell({storage, notify: (...call) => calls.push(call), now: () => clock.at})};
};

test('a dead sign-in is told with what happened and the one step, and a click opens Settings → Connections', () => {
  for (const why of ['missing', 'signed-out', 'check', 'empty']) {
    const {calls, tell} = rig();
    tell({event: 'needs-you', why});
    assert.equal(calls.length, 1, why);
    const [title, body, target, tone] = calls[0];
    assert.ok(/LinkedIn/.test(title), why);
    assert.match(body, /Chrome/, `${why}: the step starts in Chrome`);
    assert.match(body, /extension/, `${why}: keep the extension on`);
    assert.match(body, /Find jobs/, `${why}: then press Find jobs`);
    assert.deepEqual(clean(target), {view: 'settings', section: 'connections'}, `${why}: the click opens something`);
    assert.equal(tone, 'warn');
  }
});

test('"needs you" is at most one notice a day, however many presses end in it; "renewed" is told once and starts the day over', () => {
  const {calls, tell, clock, storage} = rig();
  tell({event: 'needs-you', why: 'signed-out'});
  clock.at += 3600000; tell({event: 'needs-you', why: 'signed-out'});
  assert.equal(calls.length, 1, 'the 2nd press an hour later: the card and the step line still show it, no 2nd notice');
  clock.at += DAY_MS; tell({event: 'needs-you', why: 'signed-out'});
  assert.equal(calls.length, 2, 'a day later it is told again');
  tell({event: 'renewed', why: ''});
  assert.equal(calls.length, 3);
  assert.equal(calls[2][3], 'good');
  assert.match(calls[2][0], /renewed/i);
  tell({event: 'needs-you', why: 'check'});
  assert.equal(calls.length, 4, 'after a renewal the next failure is told at once');
  assert.equal(JSON.stringify(storage.settings()).match(/AQED|li_at/), null);
});

test('no event, an unknown event or the switch off raise nothing', () => {
  const {calls, tell} = rig();
  for (const event of [null, undefined, {event: null, why: ''}, {event: 'weird', why: 'x'}]) tell(event);
  assert.deepEqual(calls, []);
  const off = rig({linkedinJobs: {on: false}});
  off.tell({event: 'needs-you', why: 'signed-out'});
  assert.deepEqual(off.calls, []);
});

test('every reason has words in all seven languages', () => {
  const seen = new Set();
  for (const locale of LOCALES) for (const why of ['missing', 'signed-out', 'check', 'empty', 'renewed']) {
    const {title, body} = noticeWords(why, locale);
    assert.ok(title && body && !/undefined|\{/.test(title + body), `${locale} ${why}`);
    if (locale !== 'en') assert.notEqual(title, noticeWords(why, 'en').title, `${locale} ${why} is translated`);
    seen.add(title);
  }
  assert.ok(seen.size >= 5 * 7 - 7, 'a title per reason and language');
});
