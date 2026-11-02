/* global document */
// Profile and Strategy ask to save only after the person's own edit (owner, 2 Nov 2026: "I go to Profile, I don't modify anything and when I want to leave it asks me if I want to
// save or discard the changes"). The demo window opens each page the way a person does, touches nothing, walks the tabs and leaves: no unsaved change on the bar, no dot on a tab, no
// "Save your changes?" question. Positive control: the demo's CV proposals (contact-handlers.js DEMO_PROPOSALS) are on screen, so the CV-proposal path the owner's store takes was played.
import assert from 'node:assert/strict';
import {before, test} from 'node:test';
import {needsElectron} from '../../test/needs-electron.js';
import {probeWindow} from './window-probe.js';

let seen, seenStrategy, seenOwner;
before(() => {
  if (needsElectron.skip) return;
  seen = probeWindow({timeout: 180000, script: async kit => {
    await kit.until(() => document.querySelector('.nav[data-view=focus]:not([hidden])'), 'the menu');
    const bars = () => [...document.querySelectorAll('.page-save-bar')].filter(bar => !bar.hidden).map(bar => bar.innerText.replace(/\s+/g, ' ').trim());
    const dots = () => [...document.querySelectorAll('.has-drafts')].map(tab => tab.textContent.trim());
    const asks = () => [...document.querySelectorAll('dialog[open]')].map(dialog => dialog.innerText.replace(/\s+/g, ' ').trim());
    const out = {};
    // Profile: every tab opened, nothing typed; then leaving it.
    let settled = false;   // Your details' second paint, after the one-time moves settle (details-facts.js showFacts)
    document.addEventListener('details-sorting', event => { if (!event.detail?.on) settled = true; });
    document.querySelector('.nav[data-view="settings"][data-settings="profile"]').click();
    await kit.until(() => document.querySelector('[data-settings-page="profile"]:not([hidden])'), 'the Profile page');
    await kit.until(() => settled, 'Your details to finish settling');
    await kit.until(() => document.querySelector('#setting-contact .cv-proposals-badge'), 'the CV proposals offered on the Contact card (positive control)');
    await kit.until(() => document.querySelector('[data-facts="eligibility"] .fact-line'), 'Work eligibility drawn');
    out.offer = document.querySelector('#setting-contact .cv-proposals-badge').textContent;
    out.sure = {phone: document.querySelector('[data-contact="phone"]').value, toast: document.getElementById('toasts')?.innerText.replace(/\s+/g, ' ').trim() || ''};
    out.filledOnOpen = document.querySelectorAll('#setting-contact [data-proposed]').length;
    out.profileOpen = {bars: bars(), dots: dots()};
    out.profileTabs = {};
    for (const tab of document.querySelectorAll('[data-profile-tab]')) {
      tab.click();
      await kit.until(() => document.querySelector(`[data-profile-panel="${tab.dataset.profileTab}"]:not([hidden])`), `the ${tab.dataset.profileTab} tab`);
      out.profileTabs[tab.dataset.profileTab] = {bars: bars(), dots: dots()};
    }
    out.beforeLeave = {bars: bars(), dots: dots()};   // read again after every tab loaded
    document.querySelector('.nav[data-view="focus"]').click();
    await kit.until(() => document.querySelector('.view[data-view="focus"]:not([hidden])') || asks().length, 'Focus, or a question');
    out.profileLeave = {asks: asks(), onFocus: Boolean(document.querySelector('.view[data-view="focus"]:not([hidden])'))};
    document.querySelector('dialog[open] button[value="discard"]')?.click();   // a question left open is answered so the rest can run
    await kit.until(() => document.querySelector('.view[data-view="focus"]:not([hidden])'), 'Focus after the answer');
    // The person's own yes is a draft: back on Profile, "Review N from your CV" lists what changes, and "Fill them in" fills the boxes and the bar counts them.
    settled = false;
    document.querySelector('.nav[data-view="settings"][data-settings="profile"]').click();
    await kit.until(() => settled, 'Your details to settle on the second open');   // the open's own paint of the boxes is done before the person presses
    await kit.until(() => document.querySelector('#setting-contact .cv-proposals-badge'), 'the offer again');
    document.querySelector('#setting-contact button.cv-proposals-badge').click();
    await kit.until(() => document.querySelector('dialog[open]'), 'the question that lists what will change');
    out.dialog = {text: document.querySelector('dialog[open]').innerText.replace(/\s+/g, ' ').trim(), bars: bars(), filled: document.querySelectorAll('#setting-contact [data-proposed]').length};
    document.querySelector('dialog[open] button[value="no"]').click();
    await kit.until(() => !document.querySelector('dialog[open]'), 'Not now closes it');
    out.notNow = {bars: bars(), filled: document.querySelectorAll('#setting-contact [data-proposed]').length};
    document.querySelector('#setting-contact button.cv-proposals-badge').click();
    await kit.until(() => document.querySelector('dialog[open]'), 'the question again');
    document.querySelector('dialog[open] button[value="fill"]').click();
    await kit.until(() => bars().length, 'the bar after Fill them in').catch(error => { throw new Error(`${error.message} | ${JSON.stringify({dialogs: document.querySelectorAll('dialog[open]').length, filled: document.querySelectorAll('#setting-contact [data-proposed]').length, badge: document.querySelector('.cv-proposals-badge')?.textContent, salutation: document.querySelector('[data-contact="salutation"]')?.value, all: [...document.querySelectorAll('.page-save-bar')].map(bar => bar.hidden + bar.innerText)})}`); });
    out.afterPress = {bars: bars(), filled: document.querySelectorAll('#setting-contact [data-proposed]').length};
    return out;
  }});
  // The owner's store (2 Nov 2026): a saved Nationality, zones answered or still asked ("❓"), an older line still asked, nothing typed.
  seenOwner = probeWindow({timeout: 180000, settings: {demoFacts: {eligibility: [{label: 'Nationality', value: 'Romania'}, {label: 'EU / EEA + Switzerland', value: 'yes, freely', kind: 'per_country'},
    {label: 'United Kingdom', value: '❓ no answer yet', kind: 'per_country'}, {label: 'Work permit / visa', value: '❓ not yet'}], availability: [{label: 'Notice period', value: '2 months'}], languages: [{label: 'English', value: 'C1'}]}}, script: async kit => {
    await kit.until(() => document.querySelector('.nav[data-view=focus]:not([hidden])'), 'the menu');
    document.querySelector('.nav[data-view="settings"][data-settings="profile"]').click();
    await kit.until(() => document.querySelector('[data-facts="eligibility"] .qa-nationality'), 'Work eligibility drawn');
    await kit.until(() => document.querySelector('#setting-contact .cv-proposals-badge'), 'the offer');
    document.querySelector('[data-profile-tab="answers"]')?.click();
    document.querySelector('[data-profile-tab="cv"]')?.click();
    document.querySelector('.nav[data-view="focus"]').click();
    await kit.until(() => document.querySelector('.view[data-view="focus"]:not([hidden])') || document.querySelector('dialog[open]'), 'Focus, or a question');
    return {bars: [...document.querySelectorAll('.page-save-bar')].filter(bar => !bar.hidden).map(bar => bar.innerText.replace(/\s+/g, ' ').trim()), asks: document.querySelectorAll('dialog[open]').length, nationality: document.querySelector('[data-facts="eligibility"] .qa-nationality')?.value};
  }});
  seenStrategy = probeWindow({timeout: 180000, script: async kit => {
    await kit.until(() => document.querySelector('.nav[data-view=focus]:not([hidden])'), 'the menu');
    const bars = () => [...document.querySelectorAll('.page-save-bar')].filter(bar => !bar.hidden).map(bar => bar.innerText.replace(/\s+/g, ' ').trim());
    const dots = () => [...document.querySelectorAll('.has-drafts')].map(tab => tab.textContent.trim());
    const asks = () => [...document.querySelectorAll('dialog[open]')].map(dialog => dialog.innerText.replace(/\s+/g, ' ').trim());
    const out = {};
    // Strategy (the other page on save-bar.js): opened, nothing typed, left.
    document.querySelector('.nav[data-view="strategy"]').click();
    await kit.until(() => document.querySelector('.view[data-view="strategy"]:not([hidden])'), 'the Strategy page');
    await kit.until(() => document.querySelector('.view[data-view="strategy"] .card'), 'Strategy drawn');
    out.strategyOpen = {bars: bars(), dots: dots()};
    document.querySelector('.nav[data-view="focus"]').click();
    await kit.until(() => document.querySelector('.view[data-view="focus"]:not([hidden])') || asks().length, 'Focus, or a question');
    out.strategyLeave = {asks: asks(), onFocus: Boolean(document.querySelector('.view[data-view="focus"]:not([hidden])'))};
    return out;
  }});
});

test('Profile opened and left with no edit: no unsaved change, no dot, no question', {skip: needsElectron.skip}, () => {
  const {result} = seen;
  assert.match(result.offer, /^Review 1 from your CV$/, 'positive control: only the unsure proposal (the salutation) is offered on the Contact card');
  assert.equal(result.filledOnOpen, 0, 'opening Profile marks no box as a draft');
  assert.equal(result.sure.phone, '+44 20 7946 0000', 'a value the CV states plainly (sure) is filled in');
  assert.match(result.sure.toast, /Filled in from your CV.*Phone: \+44 20 7946 0000/, 'and said in a pop-up, listing what changed');
  assert.deepEqual(result.profileOpen, {bars: [], dots: []}, 'opening Profile leaves nothing as a draft');
  for (const [tab, state] of Object.entries(result.profileTabs)) assert.deepEqual(state, {bars: [], dots: []}, `the ${tab} tab shows no draft`);
  assert.deepEqual(result.beforeLeave, {bars: [], dots: []}, 'still no draft after every tab loaded');
  assert.deepEqual(result.profileLeave, {asks: [], onFocus: true}, 'leaving Profile asks nothing');
  assert.match(result.dialog.text, /Mr \(check it\)/, 'the question says what will change: each box and its value, and how sure the CV is');
  assert.deepEqual([result.dialog.bars, result.dialog.filled], [[], 0], 'asking changes nothing');
  assert.deepEqual([result.notNow.bars, result.notNow.filled], [[], 0], 'Not now changes nothing');
  assert.equal(result.afterPress.filled > 0, true, 'only "Fill them in" fills the boxes');
  assert.match(result.afterPress.bars[0], /^1 unsaved change in Your details/, 'and only that yes makes a draft');
});

test('Strategy opened and left with no edit: no unsaved change, no question', {skip: needsElectron.skip}, () => {
  const {result} = seenStrategy;
  assert.deepEqual(result.strategyOpen, {bars: [], dots: []});
  assert.deepEqual(result.strategyLeave, {asks: [], onFocus: true});
});

test('the owner\'s store (saved Nationality, asked zone, older asked line), nothing typed: no draft, no question', {skip: needsElectron.skip}, () => {
  assert.deepEqual({bars: seenOwner.result.bars, asks: seenOwner.result.asks}, {bars: [], asks: 0});
  assert.ok(seenOwner.result.nationality, 'positive control: the saved Nationality is drawn');
});
