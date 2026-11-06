// #1711 (owner, 27 Oct 2026: "One shared e-mail"): Always on uses the address Settings → Notifications keeps (lib/notify-channel.js), never a second copy.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {NO_ADDRESS, followNotify, turnOnShared} from '../../../lib/hosted-email.js';

const store = (settings = {}) => { const mine = {...settings}; return {settings: () => mine, saveSettings: patch => Object.assign(mine, patch)}; };
const fakes = () => {
  const on = [], saved = [];
  return {on, saved, turnOn: async (storage, given) => { on.push(given); storage.saveSettings({hostedSearch: {on: true, email: given.email}}); return {ok: true}; },
    save: async (storage, given) => { saved.push(given); storage.saveSettings({notifyEmail: given.email.toLowerCase()}); return {ok: true}; }};
};

test('turning on from the Settings card uses the Notifications address', async () => {
  const st = store({notifyEmail: 'a@example.com'}), f = fakes();
  assert.equal((await turnOnShared(st, {}, f)).ok, true);
  assert.deepEqual(f.on, [{email: 'a@example.com'}]);
  assert.deepEqual(f.saved, [], 'nothing new to keep');
});

test('with no address anywhere it says where to add one, and sends nothing', async () => {
  const f = fakes();
  assert.deepEqual(await turnOnShared(store(), {}, f), {ok: false, error: NO_ADDRESS});
  assert.equal(f.on.length, 0);
  assert.match(NO_ADDRESS, /Notifications/);
});

test('an address typed in the setup step becomes the Notifications address too', async () => {
  const st = store(), f = fakes();
  assert.equal((await turnOnShared(st, {email: ' New@Example.com '}, f)).ok, true);
  assert.deepEqual(f.on, [{email: 'New@Example.com'}]);
  assert.deepEqual(f.saved, [{email: 'New@Example.com'}]);
  assert.equal(st.settings().notifyEmail, 'new@example.com');
});

test('a changed Notifications address moves Always on with it, only while it is on', async () => {
  const f = fakes();
  const on = store({notifyEmail: 'b@example.com', hostedSearch: {on: true, email: 'a@example.com'}});
  assert.equal((await followNotify(on, f)).moved, true);
  assert.deepEqual(f.on, [{email: 'b@example.com'}]);
  assert.equal((await followNotify(on, f)).moved, false, 'the same address again: no call');
  const off = store({notifyEmail: 'b@example.com', hostedSearch: {on: false, skipped: false}});
  assert.equal((await followNotify(off, f)).moved, false, 'never turns Always on on by itself: that is the person\'s own press');
  assert.equal(f.on.length, 1);
});
