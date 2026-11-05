/* global document */
// Always on, "How we protect your data" (owner, 5 Nov 2026), layer 2: in the demo window the card shows the owner's privacy line as soon as "on our servers" is the picked way, its button only while
// that way runs; the button opens the popup with every measure and its chip; closing it (Esc runs the same cancel-then-close path as requestClose) gives focus back to the button.
import assert from 'node:assert/strict';
import {before, test} from 'node:test';
import {MEASURES, NOTE} from '../../renderer/always-on-protect-words.js';
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
    const state = on => { shared.hosted = {...(shared.hosted || {}), on, open: true, canRun: true}; card.draw(); };
    const link = () => document.querySelector('#aon-protect-open'), line = () => document.querySelector('#aon-privacy');
    const seeOf = () => ({lineShown: !line().hidden, line: line().querySelector('p').textContent, linkShown: !link().hidden});
    const out = {};
    state(false); card.pick('ours');   // the person looks at "on our servers" before turning it on
    out.before = seeOf();
    state(true);
    out.on = seeOf();
    link().focus();
    link().click();
    const dialog = document.querySelector('#aon-protect-dialog');
    await kit.until(() => dialog.open, 'the popup to open');
    out.rows = [...dialog.querySelectorAll('.aon-measure')].map(row => ({id: row.dataset.measure, chip: row.querySelector('.ui-pill').textContent.trim(), hasText: row.querySelector('p').textContent.length > 20}));
    dialog.requestClose();
    await kit.until(() => !dialog.open, 'the popup to close');
    out.focusBack = document.activeElement === link();
    out.severe = kit.severe('settings');
    return out;
  }});
});

test('the privacy line shows before turning on, its button only once our servers run', {skip: needsElectron.skip}, () => {
  assert.deepEqual(seen.result.before, {lineShown: true, line: NOTE, linkShown: false});
  assert.deepEqual(seen.result.on, {lineShown: true, line: NOTE, linkShown: true});
});

test('the button opens the popup with every measure and its chip; closing it returns focus to the button', {skip: needsElectron.skip}, () => {
  assert.deepEqual(seen.result.rows.map(row => row.id), MEASURES.map(measure => measure.id));
  assert.deepEqual(seen.result.rows.map(row => row.chip), MEASURES.map(measure => measure.chip[0]));
  assert.ok(seen.result.rows.every(row => row.hasText), 'every measure says something');
  assert.equal(seen.result.focusBack, true);
  assert.deepEqual(seen.result.severe, []);
});
