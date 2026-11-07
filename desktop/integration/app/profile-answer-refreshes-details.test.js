/* global document, Event */
// A drawer answer that lands on a Your details line makes the page read its lines again (#3515, AI persona run 42397491150: "Availability & compensation never shows the saved notice period").
// Root cause: showFacts() ran once, at Profile's first fresh paint; the drawer's save did not tell it. The store half (the answer reaching Availability with no AI) is test/unit/main/question-answer.test.js.
// The demo app blocks the drawer's save and its bridge (window.pilot) is read-only, so the save's effect cannot be staged; what is played is the announcement the real save makes (question-review.js answer) and the page's reaction: a new read, which Your details announces with 'details-sorting'.
// Positive control: the same wait with nothing announced sees no read (counted right after the settle), so the read it then sees is the answer's.
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
    let reads = 0;
    document.addEventListener('details-sorting', event => { if (event.detail?.on) reads++; });
    const quiet = reads;   // nothing has told the page yet
    document.dispatchEvent(new Event('question-answered'));
    await kit.until(() => reads > quiet, 'Your details to read its lines again after the answer');
    const settledAgain = await kit.until(() => document.querySelector('[data-facts="availability"] .fact-line') && true, 'the Availability card to be drawn');
    return {quiet, reads, settledAgain};
  }});
});

test('an answer saved from a drawer makes Your details read its lines again', {skip: needsElectron.skip}, () => {
  const {quiet, reads, settledAgain} = seen.result;
  assert.equal(quiet, 0, 'positive control: no read before the answer is announced');
  assert.ok(reads > quiet, 'the announced answer started a read');
  assert.equal(settledAgain, true, 'and the Availability card is drawn after it');
});
