// Pairing the desktop AI (lib/desktop-ai-pairing.js): a one-time code becomes a token that only its hash is kept for; Disconnect kills the token and any unused code.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startPairing, redeem, verifyToken, disconnect, noteUse, status, PAIR_MS} from '../lib/desktop-ai-pairing.js';
import {SECRET_NAMES} from '../lib/storage.js';
import {fakeStorage} from './desktop-ai-fake-storage.js';

test('the two pairing secrets are real secret names, so storage.setSecret accepts them', () => {
  assert.ok(SECRET_NAMES.includes('DESKTOP_AI_TOKEN_HASH'));
  assert.ok(SECRET_NAMES.includes('DESKTOP_AI_PAIR'));
});

test('a code works once and gives a token; the token itself is never stored', () => {
  const storage = fakeStorage();
  const {code} = startPairing(storage);
  const token = redeem(storage, code);
  assert.match(token, /^[0-9a-f]{48}$/);
  assert.equal(redeem(storage, code), null, 'the same code twice');
  assert.equal(verifyToken(storage, token), true);
  assert.ok(!Object.values(storage.secrets).some(value => value.includes(token)), 'only a hash is kept');
  assert.ok(!Object.values(storage.secrets).some(value => value.includes(code)), 'the code is kept as a hash too');
  assert.equal(status(storage).connected, true);
});

test('a wrong code does not burn the pairing; an expired one is forgotten', () => {
  const storage = fakeStorage();
  const {code} = startPairing(storage, 1000);
  assert.equal(redeem(storage, 'not-the-code', 2000), null);
  assert.equal(redeem(storage, 42, 2000), null, 'not a string');
  assert.ok(redeem(storage, code, 3000), 'the right code still works after a wrong guess');
  const late = fakeStorage();
  const old = startPairing(late, 1000);
  assert.equal(redeem(late, old.code, 1000 + PAIR_MS + 1), null, 'over 10 minutes');
  assert.equal(late.secret('DESKTOP_AI_PAIR'), '', 'forgotten');
});

test('a token that was never paired, an empty one and a wrong one all fail', () => {
  const storage = fakeStorage();
  assert.equal(verifyToken(storage, 'anything'), false);
  const token = redeem(storage, startPairing(storage).code);
  assert.equal(verifyToken(storage, ''), false);
  assert.equal(verifyToken(storage, undefined), false);
  assert.equal(verifyToken(storage, `${token}0`), false);
});

test('Disconnect kills the token and an unused code at once; connecting again gives a new token', () => {
  const storage = fakeStorage();
  const first = redeem(storage, startPairing(storage).code);
  const unused = startPairing(storage).code;
  disconnect(storage);
  assert.equal(verifyToken(storage, first), false);
  assert.equal(redeem(storage, unused), null);
  assert.equal(status(storage).connected, false);
  const second = redeem(storage, startPairing(storage).code);
  assert.notEqual(second, first);
  assert.equal(verifyToken(storage, first), false, 'the old token never comes back');
});

test('last used is written at most once a minute and only while connected', () => {
  const storage = fakeStorage();
  noteUse(storage, 5000);
  assert.equal(status(storage).lastUsedAt, '', 'not connected: nothing written');
  redeem(storage, startPairing(storage, 0).code, 0);
  noteUse(storage, 100000);
  const first = status(storage).lastUsedAt;
  noteUse(storage, 100000 + 30000);
  assert.equal(status(storage).lastUsedAt, first);
  noteUse(storage, 100000 + 61000);
  assert.notEqual(status(storage).lastUsedAt, first);
});
