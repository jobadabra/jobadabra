// The update channel switch (lib/update-channel.js), shared by the menu's Update Channel and Settings → Diagnostics.
import test, {afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {channelOf, createUpdateChannel} from '../../../lib/update-channel.js';
import {setLocale} from '../../../i18n/index.js';

afterEach(() => setLocale('en'));

function setup({answer = 0, ahead = false, locked = false, settings = {}} = {}) {
  const saved = {...settings}, asked = [], calls = {check: 0, install: 0, change: 0, offer: null};
  const channel = createUpdateChannel({
    app: {getVersion: () => '0.6.12'},
    dialog: {showMessageBox: async (_, options) => { asked.push(options.message); return {response: answer}; }},
    storage: {settings: () => saved, saveSettings: patch => Object.assign(saved, patch)},
    updater: {stableRelease: async () => ({version: '0.6.11', ahead})},
    isLocked: () => locked, checkForUpdate: () => { calls.check++; }, installUpdate: async () => { calls.install++; return {ok: true}; },
    setUpdateOffer: value => { calls.offer = value; }, parentWindow: () => undefined, onChange: () => { calls.change++; },
  });
  return {channel, saved, asked, calls};
}

test('picking Beta or Test builds asks first, saves one channel only and checks at once', async () => {
  const {channel, saved, asked, calls} = setup({settings: {betaChannel: true}});
  assert.deepEqual(await channel.pick('test'), {ok: true, check: true});
  assert.deepEqual(asked, ['Get test builds?']);
  assert.deepEqual([saved.testChannel, saved.betaChannel], [true, false]);
  assert.equal(channel.current(), 'test');
  assert.equal(calls.change, 1);
});

test('declined: nothing changes, nothing is checked', async () => {
  const {channel, saved, calls} = setup({answer: 1});
  assert.deepEqual(await channel.pick('beta'), {ok: false, cancelled: true});
  assert.equal(channelOf(saved), 'stable');
  assert.equal(calls.check + calls.change, 0);
});

test('Stable from a build ahead of stable offers to go back and installs it', async () => {
  const {channel, saved, asked, calls} = setup({ahead: true, settings: {testChannel: true}});
  assert.deepEqual(await channel.pick('stable'), {ok: true});
  assert.equal(channelOf(saved), 'stable');
  assert.deepEqual(asked, ['Go back to stable 0.6.11?']);
  assert.equal(calls.install, 1);
  assert.equal(calls.offer.version, '0.6.11');
});

test('Stable when already on the stable version: switched off, no dialog, no install', async () => {
  const {channel, saved, asked, calls} = setup({settings: {betaChannel: true}});
  assert.deepEqual(await channel.pick('stable'), {ok: true});
  assert.equal(channelOf(saved), 'stable');
  assert.deepEqual(asked, []);
  assert.equal(calls.install, 0);
});

test('demo mode or from source: no switch', async () => {
  const {channel, saved} = setup({locked: true});
  assert.equal((await channel.set('test', true)).ok, false);
  assert.equal((await channel.pick('beta')).ok, false);
  assert.equal(channelOf(saved), 'stable');
});

test('channel dialogs resolve the current language when opened, not when the controller was created', async () => {
  const {channel, asked, saved} = setup();
  setLocale('de');
  await channel.set('beta', true);
  assert.match(asked[0], /Beta-Version/);
  assert.equal(saved.betaChannel, true);
});

test('a translated stable rollback explanation does not decide channel-switch control flow', async () => {
  const {channel, asked, saved} = setup({settings: {betaChannel: true}});
  setLocale('fr');
  const back = await channel.rollback();
  assert.equal(back.reason, 'notAhead');
  assert.notEqual(back.text, 'You are not ahead of the stable version.');
  assert.deepEqual(await channel.pick('stable'), {ok: true});
  assert.equal(saved.betaChannel, false);
  assert.deepEqual(asked, []);
});
