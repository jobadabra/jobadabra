/* global document, Event */
// A drawer answer that lands on a Your details line makes the page paint its saved lines again (#3515, AI persona run 42397491150: "Availability & compensation never shows the saved notice period").
// Root cause: the sections were read once, at Profile's first fresh paint; the drawer's save did not tell the page. The store half (the answer reaching Availability with no AI) is test/unit/main/question-answer.test.js.
// The demo app blocks the drawer's save and its bridge (window.pilot) is read-only, so the save's effect cannot be staged; what is played is the announcement the real save makes (question-review.js answer) and the page's reaction:
// the Availability card is drawn again (its rows are new nodes). Proof it bites: with the listener removed this wait hangs (checked by hand, 7 Nov 2026).
import assert from 'node:assert/strict';
import {before, test} from 'node:test';
import {needsElectron} from '../../test/needs-electron.js';
import {probeWindow} from './window-probe.js';

let seen;
before(() => {
  if (needsElectron.skip) return;
  seen = probeWindow({timeout: 180000, script: async kit => {
    await kit.until(() => document.querySelector('.nav[data-view=focus]:not([hidden])'), 'the menu');
    let settled = false;
    document.addEventListener('details-sorting', event => { if (!event.detail?.on) settled = true; });
    document.querySelector('.nav[data-view="settings"][data-settings="profile"]').click();
    await kit.until(() => settled, 'Your details to finish settling');
    const rowNow = () => document.querySelector('[data-facts="availability"] .fact-line');
    const drawn = rowNow();
    document.dispatchEvent(new Event('question-answered'));
    await kit.until(() => drawn && !drawn.isConnected && rowNow(), 'the Availability card to be drawn again after the answer');
    return {hadRow: Boolean(drawn)};
  }});
});

test('an answer saved from a drawer makes the Availability card paint its saved lines again', {skip: needsElectron.skip}, () => {
  assert.deepEqual(seen.result, {hadRow: true}, 'the card had a row, and the probe saw it replaced by a new one after the answer was announced');
});
