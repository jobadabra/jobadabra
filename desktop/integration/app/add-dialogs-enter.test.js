/* global document, KeyboardEvent */
// Enter in an Add dialog (Add job, Add application) presses its "Add it", never "Close" (lg coordinator, 14 Nov 2026: "pressing Enter in the Add job dialog closes the dialog instead of pressing Add it").
// Root cause: each form's first submit button is its Close, and a browser's Enter in a text box activates the form's FIRST submit button. The probe plays what the browser does: a cancelable
// keydown Enter on the box; when nothing cancelled it, the form's first submit button is pressed. Demo store only, in the demo window (the app's own harness, never the owner's app).
import assert from 'node:assert/strict';
import {before, test} from 'node:test';
import {needsElectron} from '../../test/needs-electron.js';
import {probeWindow} from './window-probe.js';

const live = {skip: needsElectron.skip};
let seen;
before(() => {
  if (needsElectron.skip) return;
  seen = probeWindow({timeout: 180000, script: async kit => {
    await kit.until(() => document.querySelector('.nav[data-view=focus]:not([hidden])'), 'the menu');
    const out = {};
    // The browser's own Enter: keydown first; if it is not cancelled, the form's first submit button is pressed (the HTML "implicit submission").
    const enter = box => {
      const event = new KeyboardEvent('keydown', {key: 'Enter', bubbles: true, cancelable: true});
      box.dispatchEvent(event);
      if (!event.defaultPrevented) box.form.querySelector('button:not([type=button]):not([type=reset])').click();
    };
    for (const [name, opener, box, message] of [['job', 'import-open', 'import-url', 'import-message'], ['application', 'applied-open', 'applied-url', 'applied-message']]) {
      const dialog = document.getElementById(box).closest('dialog');
      document.getElementById(opener).click();
      await kit.until(() => dialog.open, `the ${name} dialog opens`);
      document.getElementById(box).value = 'not a link';   // "Add it" answers it with its own error and the dialog stays: no network, nothing added to the demo store
      enter(document.getElementById(box));
      await kit.until(() => document.getElementById(message).textContent.trim() || !dialog.open, `the ${name} dialog answers Enter`);
      out[name] = {open: dialog.open, message: document.getElementById(message).textContent.trim()};
      if (dialog.open) dialog.close();
    }
    return out;
  }});
});

for (const name of ['job', 'application']) {
  test(`Enter in the Add ${name} dialog presses its Add button: the dialog stays open and says something`, live, () => {
    assert.equal(seen.result[name].open, true, 'Enter closed the dialog (it pressed Close)');
    assert.notEqual(seen.result[name].message, '', 'nothing answered: "Add it" was not pressed');
  });
}
