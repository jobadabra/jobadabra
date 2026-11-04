// The one Always on card: which way is running, which one it shows first, and that a way that is not open yet cannot be picked.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {choices, notice, pill, running, startWay} from '../../../renderer/always-on-choice-words.js';

test('the running way is read from the two settings', () => {
  assert.equal(running({}), null);
  assert.equal(running({hostedOn: true}), 'ours');
  assert.equal(running({cloudRepo: 'me/always-on'}), 'own');
  assert.equal(running({hostedOn: true, cloudRepo: 'me/always-on'}), 'both', 'both on is a state of its own, not hidden');
});

test('the card opens on the running way, else ours when it is open, else the person\'s own', () => {
  assert.equal(startWay({now: 'own', open: true}), 'own');
  assert.equal(startWay({now: null, open: true}), 'ours');
  assert.equal(startWay({now: null, open: false}), 'own');
  assert.equal(startWay({now: 'both', open: true}), 'own', 'the own way has the way to turn it off');
});

test('our servers is not pickable and says why while the site is not open; the own way always is', () => {
  const [ours, own] = choices({open: false});
  assert.deepEqual([ours.id, ours.disabled, ours.note], ['ours', true, 'Not open yet']);
  assert.deepEqual([own.id, own.disabled], ['own', false]);
  assert.equal(choices({open: true})[0].disabled, false);
  const noKey = choices({open: true, canRun: false})[0];   // a person with only their own key cannot use our servers
  assert.deepEqual([noKey.disabled, noKey.note], [true, 'Needs Free AI or a Pro plan']);
});

test('the pill and the notice say what runs, and nothing turns off by itself', () => {
  assert.deepEqual(pill(null), ['Off', 'neutral']);
  assert.deepEqual(pill('own'), ['On: your accounts', 'good']);
  assert.equal(notice({now: 'own', picked: 'own'}), '');
  assert.equal(notice({now: null, picked: 'ours'}), '');
  assert.deepEqual(pill('both'), ['On twice', 'warn']);
  assert.match(notice({now: 'both', picked: 'own'}), /every search happens twice/);
  assert.match(notice({now: 'ours', picked: 'own'}), /running on our servers.*stays on until you turn it off/);
});
