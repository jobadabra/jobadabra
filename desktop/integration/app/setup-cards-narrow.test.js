/* global document, window */
// Every setup card (.magic: Welcome, AI, Your CV) fits the narrowest window: nothing inside a card reaches past its edge, where the card's `overflow: hidden` would cut it off.
// Why (5 Nov 2026, co): at 640 px (lib/main-window.js MIN_WIDTH) the CV card's last button was cut 13 px off: its button row did not wrap, which widened the card's
// one grid column (an implicit `auto` column grows to its widest child, the class test/guards/rules/narrow-window.test.js names for a bare `1fr` but could not see).
// The CV step is drawn in its fullest state (file chosen, the e-mail line from the CV shown), fictional data only.
import assert from 'node:assert/strict';
import {before, test} from 'node:test';
import {needsElectron} from '../../test/needs-electron.js';
import {MIN_WIDTH} from '../../lib/main-window.js';
import {probeWindow} from './window-probe.js';

const live = {skip: needsElectron.skip};
let found;

before(() => {
  if (needsElectron.skip) return;
  found = probeWindow({settings: {setupDone: false, displayLanguage: 'en', wizardStep: 'welcome'}, env: {JOBADABRA_SHOT_WIDTH: String(MIN_WIDTH)}, timeout: 120000, script: async kit => {
    await kit.until(() => document.querySelector('.step[data-step="welcome"]:not([hidden])'), 'the welcome step');
    document.getElementById('app').hidden = true;
    document.getElementById('wizard').hidden = false;
    const fill = {   // the fullest state of a step, where it has one
      cv: () => {
        document.getElementById('cv-file').hidden = false;
        document.getElementById('cv-name').textContent = 'Alexandra_Example-Longname_Curriculum_Vitae_2026.pdf';
        document.getElementById('cv-meta').textContent = 'Added 5 Nov';
        const email = document.getElementById('cv-email');
        if (email) {
          email.hidden = false;
          document.getElementById('cv-email-address').textContent = 'alexandra.example-longname@example.com';
        }
      },
    };
    const steps = [...document.querySelectorAll('.step')].filter(step => step.querySelector('.magic')).map(step => step.dataset.step);
    const out = {width: window.outerWidth, steps, over: {}};   // the window in screen pixels: the page itself is wider in CSS pixels at the app's zoom (0.8)
    for (const name of steps) {
      document.querySelectorAll('.step').forEach(step => { step.hidden = step.dataset.step !== name; });
      fill[name]?.();
      for (const card of document.querySelectorAll(`.step[data-step="${name}"] .magic`)) {
        const edge = card.getBoundingClientRect();
        out.over[name] = [...card.querySelectorAll('*')].filter(el => el.offsetParent && el.getBoundingClientRect().width > 0)
          .map(el => ({el: el.id || String(el.className) || el.tagName, by: Math.round(Math.max(el.getBoundingClientRect().right - edge.right, edge.left - el.getBoundingClientRect().left))}))
          .filter(item => item.by > 1).slice(0, 5);
      }
    }
    return out;
  }}).result;
});

test('the window really is the narrowest one, and every setup card is measured', live, () => {
  assert.ok(found.width <= MIN_WIDTH, `window ${found.width} px`);
  assert.ok(found.steps.includes('cv') && found.steps.includes('welcome'), `steps measured: ${found.steps}`);
});

test('nothing inside a setup card reaches past its edge at the narrowest window', live, () => {
  assert.deepEqual(Object.fromEntries(Object.entries(found.over).filter(([, list]) => list.length)), {});
});
