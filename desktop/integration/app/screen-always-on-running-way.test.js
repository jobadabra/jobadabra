/* global document */
// Always on, the way that runs now can always be picked (#3158), layer 2: hosted Always on runs, the site reads closed (open: false), the person picks "your own accounts":
// the "our servers" choice is still enabled, picking it shows the hosted card again (where Always on is turned off), and with nothing running it stays disabled.
import assert from 'node:assert/strict';
import {before, test} from 'node:test';
import {needsElectron} from '../../test/needs-electron.js';
import {probeWindow} from './window-probe.js';

let seen;

before(() => {
  if (needsElectron.skip) return;
  seen = probeWindow({settings: {cloud: {repo: ''}}, script: async kit => {
    await kit.until(() => document.querySelector('.nav[data-view=focus]:not([hidden])'), 'the menu');
    await kit.go('settings');
    const shared = (await import('./pages/shared.js')).shared, card = await import('./pages/always-on-choice.js'), settings = await import('./pages/settings.js');
    settings.openSetting('hosted');
    const state = on => { shared.hosted = {...(shared.hosted || {}), on, open: false, canRun: true}; card.draw(); };
    const ours = () => document.querySelector('#aon-choices [data-choice=ours]');
    const see = () => ({oursDisabled: ours().disabled, hostedCardShown: !document.querySelector('#setting-hosted').hidden});
    const out = {};
    state(false); card.pick('own');
    out.nothingRunning = see();
    state(true); card.pick('own');   // the person looked at their own accounts; hosted Always on is running
    out.runningOwnPicked = see();
    card.pick('ours');
    out.runningThenOurs = see();
    out.severe = kit.severe('settings');
    return out;
  }});
});

test('with nothing running and the site closed, our servers stays disabled and its card hidden', {skip: needsElectron.skip}, () => {
  assert.deepEqual(seen.result.nothingRunning, {oursDisabled: true, hostedCardShown: false});
});

test('hosted Always on running, site closed, own picked: our servers can be picked back to turn it off', {skip: needsElectron.skip}, () => {
  assert.equal(seen.result.runningOwnPicked.oursDisabled, false, 'the running way is pickable');
  assert.deepEqual(seen.result.runningThenOurs, {oursDisabled: false, hostedCardShown: true});
  assert.deepEqual(seen.result.severe, []);
});
