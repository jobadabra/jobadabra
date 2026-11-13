/* global window, document */
// The panel stays on top of anything a page shows, any popup, and takes the person's click there (extension/panel-top-layer.js): a page overlay at the highest z-index, a page popover
// opened after the panel, a native modal dialog (showModal: everything outside it is inert, LinkedIn's Easy Apply), and the panel back on the page when the dialog closes; an in-flow
// layer of ours (the written-answer row) is never moved.
// The real panel-top-layer.js over a real Chrome, a stand-in host shaped like review.js's, Playwright's mouse as the person's click.
// Why (13 Nov 2026, owner, LinkedIn Easy Apply 4a: "it should be always on top of anything else on the website" · "on any popop"): the owner's rule, played on each kind of popup.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {chromium} from '../../e2e/lib/visit-page.mjs';
import {CLOSE_MS, at, clocked, onHang} from '../../e2e/lib/test-clock.mjs';

const PAGE = `<body style="margin:0;height:900px">
  <div id="cover" style="position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.2)" hidden>a page overlay at the highest z-index</div>
  <div id="pop" popover="manual" style="position:fixed;inset:0;margin:0;width:100vw;height:100vh">a page popover</div>
  <dialog id="modal" style="width:100vw;height:100vh;max-width:none;max-height:none;margin:0">a modal dialog<button id="close">Close</button><textarea id="answer"></textarea><div id="jobadabra-written-host">Review my answer</div></dialog>
  <script>
    window.clicks = 0;
    const host = Object.assign(document.createElement('div'), {id: 'jobadabra-review-host'});
    host.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483646;';
    host.innerHTML = '<button id="pill" style="width:160px;height:48px">Jobadabra</button>';
    host.addEventListener('click', () => { window.clicks += 1; });
    document.documentElement.append(host);
  </script></body>`;

const TEST_MS = 30000, TEST_CAP = {timeout: TEST_MS + CLOSE_MS + 5000};
test('the panel is on top and takes the click above an overlay, a page popover and a modal dialog, and after the dialog closes', TEST_CAP, clocked(TEST_MS, async () => {
  at('starting Chromium');
  const browser = await chromium.launch();
  onHang(() => browser.close());
  try {
    const page = await browser.newPage({viewport: {width: 1200, height: 800}});
    await page.setContent(PAGE);
    await page.addScriptTag({content: fs.readFileSync(new URL('../../../extension/panel-top-layer.js', import.meta.url), 'utf8')});
    // What the person's pointer meets at the panel's centre, and whether a click there reaches the panel.
    const where = async () => {
      const box = await page.locator('#jobadabra-review-host').boundingBox();
      const x = box.x + box.width / 2, y = box.y + box.height / 2;
      const top = await page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.closest('#jobadabra-review-host') ? 'panel' : document.elementFromPoint(px, py)?.id || 'page', [x, y]);
      const before = await page.evaluate(() => window.clicks);
      await page.mouse.click(x, y);
      return {top, clicked: (await page.evaluate(() => window.clicks)) - before, box: {right: Math.round(1200 - box.x - box.width), bottom: Math.round(800 - box.y - box.height)}};
    };
    at('a page overlay at the highest z-index');
    await page.evaluate(() => { document.getElementById('cover').hidden = false; });
    assert.deepEqual(await where(), {top: 'panel', clicked: 1, box: {right: 18, bottom: 18}}, 'above a z-index overlay, in its own place');
    await page.evaluate(() => { document.getElementById('cover').hidden = true; });

    at('a page popover opened after the panel');
    await page.evaluate(() => document.getElementById('pop').showPopover());
    await page.waitForFunction(() => document.querySelector('#jobadabra-review-host:popover-open') && document.getElementById('pop').matches(':popover-open'));
    assert.deepEqual(await where(), {top: 'panel', clicked: 1, box: {right: 18, bottom: 18}}, 'above a page popover shown later');
    await page.evaluate(() => document.getElementById('pop').hidePopover());

    at('a modal dialog');
    await page.evaluate(() => document.getElementById('modal').showModal());
    await page.waitForFunction(() => document.getElementById('jobadabra-review-host').parentElement?.id === 'modal');
    assert.deepEqual(await where(), {top: 'panel', clicked: 1, box: {right: 18, bottom: 18}}, 'above a modal dialog and not inert');
    // An in-flow layer of ours (panel-written.js puts "Review my answer" right under the answer box, here a child of the dialog) keeps its place: it is no floating layer (Gitar on #4040).
    assert.deepEqual(await page.evaluate(() => { const row = document.getElementById('jobadabra-written-host'); return {parent: row.parentElement.id, after: row.previousElementSibling?.id, popover: row.hasAttribute('popover')}; }),
      {parent: 'modal', after: 'answer', popover: false}, 'the written-answer row stays under its box');

    at('the dialog closed');
    await page.evaluate(() => document.getElementById('modal').close());
    await page.waitForFunction(() => document.getElementById('jobadabra-review-host').parentElement === document.documentElement);
    assert.deepEqual(await where(), {top: 'panel', clicked: 1, box: {right: 18, bottom: 18}}, 'back on the page, still on top');
    assert.equal(await page.evaluate(() => document.getElementById('jobadabra-written-host').parentElement.id), 'modal', 'the written-answer row never moved');
  } finally { await browser.close(); }
}));
