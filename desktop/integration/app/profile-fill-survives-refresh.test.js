/* global document, Event */
// "Fill them in" and a typed edit always make a draft on the bar, even when Your details reads the Contact again at that moment (pf, 2 Nov 2026). Flaky root cause: showContact paints the kept copy
// at once and the fresh read a moment later; the fresh paint's "never draw over drafts" guard was off for a read that started from a kept copy, so a Fill pressed in between was wiped
// and the paint's baseline took the wiped boxes as saved: no draft, no bar. The order is forced here: the read is started, the fill is made in the same tick (the read cannot have answered),
// then the read's paint is awaited. Control: Discard all still redraws the boxes (the one paint that is meant to).
import assert from 'node:assert/strict';
import {before, test} from 'node:test';
import {needsElectron} from '../../test/needs-electron.js';
import {probeWindow} from './window-probe.js';

let seen;
before(() => {
  if (needsElectron.skip) return;
  seen = probeWindow({timeout: 180000, script: async kit => {
    await kit.until(() => document.querySelector('.nav[data-view=focus]:not([hidden])'), 'the menu');
    const bars = () => [...document.querySelectorAll('.page-save-bar')].filter(bar => !bar.hidden).map(bar => bar.innerText.replace(/\s+/g, ' ').trim());
    const box = field => document.querySelector(`#setting-contact [data-contact="${field}"]`);
    let settled = false;
    document.addEventListener('details-sorting', event => { if (!event.detail?.on) settled = true; });
    document.querySelector('.nav[data-view="settings"][data-settings="profile"]').click();
    await kit.until(() => settled, 'Your details to finish settling');
    await kit.until(() => document.querySelector('#setting-contact .cv-proposals-badge'), 'the CV proposals offered (positive control)');
    const {showContact} = await import('./pages/profile.js');
    const {showProposals} = await import('./pages/contact-proposals.js');
    const {showFacts} = await import('./pages/details-facts.js');
    const fact = () => document.querySelector('textarea[data-fact-value="availability"]');
    const savedFact = fact().value;
    const out = {start: {bars: bars(), salutation: box('salutation').value}};

    // 1. Fill them in while the Contact read is on its way.
    const reading = showContact();   // the kept copy is painted now, the fresh read is still out
    const shown = showProposals([{field: 'salutation', value: 'Mr', sure: false}]);   // the person's yes lands here
    out.filled = {shown, bars: bars(), salutation: box('salutation').value};
    await reading;   // the fresh paint
    out.afterRead = {bars: bars(), salutation: box('salutation').value, marked: box('salutation').dataset.proposed || ''};

    // 2. A typed edit while the Contact read is on its way.
    box('phone').value = '+41 79 000 00 00';
    box('phone').dispatchEvent(new Event('input', {bubbles: true}));
    await showContact();
    out.afterTyped = {bars: bars(), phone: box('phone').value};

    // 3. A fact edited while the Facts are read again (Disconnect Telegram, a store move: loadSettings reads the Contact and then the facts).
    fact().value = 'edited in the test';
    fact().dispatchEvent(new Event('input', {bubbles: true}));
    await showFacts();
    out.afterFact = {bars: bars(), fact: fact().value};

    // 4. Control: Discard all is the one paint that redraws over drafts.
    [...document.querySelectorAll('.page-save-bar:not([hidden]) button')].find(button => button.textContent === 'Discard all').click();
    await kit.until(() => { if (bars().length || box('salutation').value || fact().value !== savedFact) throw new Error(JSON.stringify({bars: bars(), salutation: box('salutation').value, phone: box('phone').value})); return true; }, 'Discard all to redraw the boxes');
    out.discarded = {bars: bars(), salutation: box('salutation').value, phone: box('phone').value, factRestored: fact().value === savedFact};
    return out;
  }});
});

test('Fill them in while the Contact is read again: the box keeps its value and the bar counts it', {skip: needsElectron.skip}, () => {
  const {result} = seen;
  assert.deepEqual(result.start, {bars: [], salutation: ''}, 'positive control: nothing filled, no draft before the press');
  assert.equal(result.filled.shown, 1, 'the press fills the box');
  assert.match(result.filled.bars[0], /^1 unsaved change/, 'and the bar counts it at once');
  assert.deepEqual([result.afterRead.salutation, result.afterRead.marked], ['Mr', 'cv'], 'the read answering later does not wipe the filled box');
  assert.match(result.afterRead.bars[0], /^1 unsaved change/, 'nor hide the bar');
});

test('a typed edit while the Contact is read again is kept as a draft', {skip: needsElectron.skip}, () => {
  const {result} = seen;
  assert.equal(result.afterTyped.phone, '+41 79 000 00 00');
  assert.match(result.afterTyped.bars[0], /^2 unsaved changes/, 'the typed phone and the filled salutation');
});

test('a fact edited while the Facts are read again is kept as a draft', {skip: needsElectron.skip}, () => {
  const {result} = seen;
  assert.equal(result.afterFact.fact, 'edited in the test');
  assert.match(result.afterFact.bars[0], /^3 unsaved changes/, 'the filled salutation, the typed phone and the edited fact');
});

test('Discard all still redraws the boxes from what is saved', {skip: needsElectron.skip}, () => {
  assert.deepEqual(seen.result.discarded, {bars: [], salutation: '', phone: '', factRestored: true}, 'the demo keeps no phone: the boxes show what is saved (nothing), not the drafts');
});
