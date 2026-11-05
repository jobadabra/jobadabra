// The explorer (and the AI user agent) lists only controls a person can reach: one inside a closed <details> is not listed, one in an open fold is, and a button in a closed fold's own heading stays (#3126: it pressed a button in a closed fold and filed a false alarm).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {observePage} from '../../lib/explore.mjs';

test('a control in a closed fold is not listed; the fold\'s summary, an open fold\'s control and a loose control are', async () => {
  const {chromium} = await import('playwright-core');
  const browser = await chromium.launch({headless: true});
  try {
    const page = await browser.newPage();
    await page.setContent(`<div class="view" data-view="settings"><details><summary>Chrome extension</summary><button>Open chrome://extensions</button>
      <details open><summary>Inner open, outer closed</summary><button>Deep</button></details></details>
      <details><summary>Technical log <button>Copy</button></summary><pre>log</pre></details>
      <details><button>No heading</button></details>
      <details open><summary>Open fold</summary><button>Inside open</button></details><button>Outside</button></div>`);
    const seen = await page.evaluate(observePage);
    assert.deepEqual(seen.controls.map(control => control.label), ['Chrome extension', 'Technical log Copy', 'Copy', 'Open fold', 'Inside open', 'Outside']);
  } finally { await browser.close(); }
});
