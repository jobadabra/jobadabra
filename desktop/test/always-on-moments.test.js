// Always on's dialog moments (spec docs/superpowers/specs/2026-11-02-always-on-moments-design.md): a missed check is found when the app starts or wakes, the offer opens once, and never when it is on, cannot run, or in setup.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createMoments, missedCheck, MISSED_GRACE_MS} from '../lib/always-on-moments.js';
import {missedWords} from '../renderer/hosted-words.js';

const HOUR = 3600 * 1000;
const at = (h, m = 0) => new Date(2026, 10, 2, h, m).getTime();
// A Mac that last searched at 3:00 with a 4-hour schedule: due at 7:00.
const base = (patch = {}) => ({setupDone: true, lastSearchAt: new Date(at(3)).toISOString(), schedule: {search: 4}, ...patch});
const fake = settings => {
  const store = {settings: () => settings, saveSettings: patch => { Object.assign(settings, patch); }};
  return store;
};

test('a check is missed when its time passed more than the grace before the app looked, with the due time', () => {
  assert.deepEqual(missedCheck(base(), at(7) + MISSED_GRACE_MS + 1), {at: at(7)});
  assert.equal(missedCheck(base(), at(7) + MISSED_GRACE_MS - 1), null, 'an awake Mac with the app open starts it within the tick: not missed');
  assert.equal(missedCheck(base(), at(6, 59)), null, 'not due yet');
});

test('nothing is missed in setup, without a first search, with searches only when asked, or when GitHub Always on runs them', () => {
  const late = at(12);
  for (const [name, patch] of [['setup', {setupDone: false}], ['no first search', {lastSearchAt: ''}], ['only when asked', {schedule: {search: 0}}], ['GitHub Always on', {cloud: {repo: 'me/jobs'}}]]) {
    assert.equal(missedCheck(base(patch), late), null, name);
  }
});

test('the offer opens once: found at start, shown, then never again, even for a later missed check', () => {
  const settings = base();
  const moments = createMoments(fake(settings), {available: () => true});
  assert.equal(moments.next(), null, 'nothing noted yet');
  moments.note(at(9));
  assert.deepEqual(moments.next(), {moment: 'missed', at: new Date(at(7)).toISOString()});
  moments.shown('missed', at(9));
  assert.ok(Date.parse(settings.hostedSearch.moments.missed) > 0, 'the owner of the state is settings.hostedSearch, next to skipped');
  assert.equal(moments.next(), null);
  moments.note(at(9) + 24 * HOUR);
  assert.equal(moments.next(), null, 'the same moment never comes back');
});

test('never when Always on is on, when the install cannot run it, or when Skip/Not now came earlier for another reason it may still open', () => {
  const run = (hostedSearch, available = true) => {
    const settings = base(hostedSearch ? {hostedSearch} : {});
    const moments = createMoments(fake(settings), {available: () => available});
    moments.note(at(9));
    return moments.next();
  };
  assert.equal(run({on: true}), null, 'already on');
  assert.equal(run(null, false), null, 'no in-house key: it could not run');
  assert.notEqual(run({skipped: true}), null, 'an earlier Skip does not block a different moment');
});

test('the catch-up search that runs a minute later does not cancel the offer: the check still did not run at its time', () => {
  const settings = base();
  const moments = createMoments(fake(settings), {available: () => true});
  moments.note(at(9));
  settings.lastSearchAt = new Date(at(9, 2)).toISOString();   // the catch-up search ran and finished
  assert.equal(moments.next()?.moment, 'missed');
});

test('the words: the due time in the person\'s own clock, honest about asleep or off', () => {
  const words = missedWords(new Date(at(7)).toISOString());
  assert.equal(words.title, 'Your 7:00 check didn\'t run');
  assert.match(words.body, /asleep or off/);
  assert.match(words.body, /even when your Mac is off/);
  assert.equal(missedWords(new Date(at(14, 5)).toISOString()).title, 'Your 14:05 check didn\'t run');
});
