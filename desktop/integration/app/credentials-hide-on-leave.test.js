/* global document */
// A password revealed on Settings → Credentials goes back behind its mask when the person leaves the page (#3530, AI persona run 42401302994: "Old password is visible without pressing Show").
// Root cause: the old job-site password was set to the password by Show and nothing masked it again; the account rows were only drawn again when the page re-opened. The demo app answers Show with a fixed fictional password.
// Positive control: right after Show the password is on the page, so the masked reading after leaving is the fix's.
import assert from 'node:assert/strict';
import {before, test} from 'node:test';
import {needsElectron} from '../../test/needs-electron.js';
import {probeWindow} from './window-probe.js';

let seen;
before(() => {
  if (needsElectron.skip) return;
  seen = probeWindow({timeout: 180000, script: async kit => {
    await kit.until(() => document.querySelector('.nav[data-view=focus]:not([hidden])'), 'the menu');
    const {settingsPage} = await import('./pages/settings.js');
    const page = () => document.querySelector('[data-settings-page="credentials"]');
    const everything = () => page().innerText + [...page().querySelectorAll('b')].map(each => each.textContent).join('|');
    document.querySelector('.nav[data-view="settings"]:not([data-settings])').click();
    settingsPage('credentials');
    await kit.until(() => document.querySelectorAll('#credentials-table .task-row:not(.is-head)').length > 0, 'the account rows');
    document.querySelector('#credentials-shared-show').click();
    await kit.until(() => /Maple-Rocket-42/.test(document.querySelector('#credentials-shared').textContent), 'the old job-site password shown after Show');
    const rowsBefore = document.querySelectorAll('#credentials-table .task-row:not(.is-head)').length;
    document.querySelector('#credentials-shared-show').click();   // Hide: the old password is dots again and the account list stays
    const hideKeepsRows = !document.querySelector('#credentials-shared').textContent.includes('Maple-Rocket-42') && document.querySelectorAll('#credentials-table .task-row:not(.is-head)').length === rowsBefore;
    document.querySelector('#credentials-shared-show').click();
    await kit.until(() => /Maple-Rocket-42/.test(document.querySelector('#credentials-shared').textContent), 'the old job-site password shown again');
    const row = document.querySelector('#credentials-table .task-row:not(.is-head) .small-button');
    row.click();
    await kit.until(() => /Maple-Rocket-42/.test(document.querySelector('#credentials-table').innerText), 'an account password shown after Show');
    const shown = everything().includes('Maple-Rocket-42');
    settingsPage('overview');
    const hiddenAfterLeaving = !everything().includes('Maple-Rocket-42');   // the page is hidden but its DOM holds what was shown
    settingsPage('credentials');
    await kit.until(() => document.querySelectorAll('#credentials-table .task-row:not(.is-head)').length > 0, 'the account rows again');
    return {shown, hideKeepsRows, hiddenAfterLeaving, backOnPage: !everything().includes('Maple-Rocket-42'), button: document.querySelector('#credentials-shared-show').textContent};
  }});
});

test('a password revealed on Credentials is masked again after leaving the page', {skip: needsElectron.skip}, () => {
  assert.deepEqual(seen.result, {shown: true, hideKeepsRows: true, hiddenAfterLeaving: true, backOnPage: true, button: 'Show'});
});
