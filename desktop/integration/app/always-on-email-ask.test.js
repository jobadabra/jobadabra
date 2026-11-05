/* global document */
// Always on's one more ask for e-mail, drawn in the real window: the switch row says what it asks, to which address, and starts on. A consent switch with no words is no consent.
// Why (5 Nov 2026, #3282): el() takes one content, so the row built in JS drew a bare checkbox and every unit test still passed; only a render showed it.
import assert from 'node:assert/strict';
import {before, test} from 'node:test';
import {needsElectron} from '../../test/needs-electron.js';
import {REST, WHAT} from '../../renderer/email-consent-words.js';
import {probeWindow} from './window-probe.js';

const live = {skip: needsElectron.skip};
let found;

before(() => {
  if (needsElectron.skip) return;
  found = probeWindow({timeout: 120000, script: async kit => {
    await kit.go('settings');
    const press = await kit.until(() => document.getElementById('hosted-turn-on'), 'the Turn on button of Always on');
    press.click();
    const row = await kit.until(() => document.getElementById('hosted-email-ask'), 'the e-mail ask');
    return {text: row.textContent, knob: !!row.querySelector('.switch input + span'), on: row.querySelector('input').checked, named: row.querySelector('input').labels.length};
  }}).result;
});

test('the Always on ask shows its words, the address and the switch, on', live, () => {
  assert.ok(found.text.includes(WHAT), `the sentence is shown, got "${found.text}"`);
  assert.ok(found.text.includes(REST), 'the rest of the sentence is shown');
  assert.match(found.text, /To \S+@example\.com\./, 'the address is shown');
  assert.equal(found.knob, true, 'the switch has its knob');
  assert.equal(found.on, true, 'on by default');
  assert.equal(found.named, 1, 'the row is the input\'s label');
});
