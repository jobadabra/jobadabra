// Replace CV on Profile → CV (Windows tester on 0.9.2, 3 Nov 2026: "CV card stale after Replace CV: the old file size and the old CV check until reload").
// Drives the REAL pages: pages/profile.js (the CV card and its loader), pages/actions.js (the Replace CV button) and pages/cv-replace.js (the hook between them), over a fake
// app whose file changes size and whose old check no longer applies. The pages wire elements by id at import, so the test DOM makes an element for any id asked
// (importing profile.js without them threw at job-panel.js:143 `$('job-drawer-backdrop').addEventListener`, which is why an earlier version of this test copied loadCvSetting).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {install} from '../../tiny-dom.js';

install();
// Why (fx, 3 Nov 2026): the pages start timers at import (renderer/usage-signals.js:43 every 1 s, pages/interviews.js:228, focus-check.js:21); a test process that imports them never exits
// (the first version of this test hung the CI job for 15 minutes). The timers still run for the test's length but no longer hold the process open.
const realInterval = globalThis.setInterval;
globalThis.setInterval = (...args) => realInterval(...args).unref();
const doc = globalThis.document, found = doc.getElementById.bind(doc);
doc.getElementById = id => {
  let node = found(id);
  if (!node) { node = doc.createElement(/(^|-)(run|button|btn)$|^replace-cv$/.test(id) ? 'button' : 'div'); node.id = id; doc.body.append(node); }
  return node;
};
const {cvCheck} = await import('../../../lib/demo.js');
const app = {file: {size: 328 * 1024, addedAt: '2026-10-12T10:00:00Z'}, check: {...cvCheck, ai: undefined, billing: 'subscription'}, name: 'Old_CV.pdf'};
globalThis.window.pilot = new Proxy({
  chooseCv: async () => { app.file = {size: 91 * 1024, addedAt: '2026-11-03T01:00:00Z'}; app.check = null; app.name = 'New_CV.pdf'; return app.name; },
  state: async () => ({settings: {cvName: app.name}, secrets: {}}),
  cvStatus: async () => ({base: true, custom: false, file: app.file}),
  cvCheckStatus: async () => app.check,
  cvChange: async () => ({}),
}, {get: (all, key) => all[key] || (async () => null)});
const {loadCvSetting} = await import('../../../renderer/pages/profile.js');
const {init} = await import('../../../renderer/pages/actions.js');
const $ = id => globalThis.document.getElementById(id);
await init();

test('pressing Replace CV on the real page redraws the CV card: new size, "Not checked yet", no reload', async () => {
  await loadCvSetting();
  assert.match($('cv-facts').textContent, /328 KB/);
  assert.notEqual($('cvc-state').textContent, 'Not checked yet', 'the old file had a check');
  await $('replace-cv').listeners.click[0]({});
  assert.equal($('contact-cv').textContent, 'New_CV.pdf');
  assert.match($('cv-facts').textContent, /91 KB/);
  assert.doesNotMatch($('cv-facts').textContent, /328 KB/);
  assert.equal($('cvc-state').textContent, 'Not checked yet', 'the old file\'s check is not shown for the new file');
});

test('a cancelled picker redraws and says nothing', async () => {
  const before = $('cv-facts').textContent;
  globalThis.window.pilot.chooseCv = async () => null;
  $('contact-cv').textContent = 'keep';
  await $('replace-cv').listeners.click[0]({});
  assert.equal($('cv-facts').textContent, before);
  assert.equal($('contact-cv').textContent, 'keep');
});

test('"CV replaced" is said before the redraw, and a card that fails to redraw neither hides it nor stops the other cards', async () => {
  const {replaceCv, onCvReplaced} = await import('../../../renderer/pages/cv-replace.js');
  const order = [];
  const stopBad = onCvReplaced(async () => { order.push('bad'); throw new Error('cvStatus failed'); });
  const stopGood = onCvReplaced(async () => { order.push('good'); });
  await assert.rejects(replaceCv({choose: async () => 'X.pdf', readState: async () => {}, say: file => order.push(`say ${file}`)}), /cvStatus failed/);
  assert.deepEqual(order.slice(0, 3), ['say X.pdf', 'bad', 'good']);
  stopBad(); stopGood();
});

test('Build with AI redraws through the same hook, and no page imports profile.js (no import cycle)', () => {
  const read = file => fs.readFileSync(new URL(`../../../renderer/pages/${file}`, import.meta.url), 'utf8');
  // Why (3 Nov 2026, PR 3/3): the redraw moved into cvSaved so Build with AI and the LinkedIn import end the same way; the AI build still reaches it, through that one function.
  assert.match(read('cv-build.js'), /export async function cvSaved\(name\)[^]*?cvReplaced\(name\)/);
  assert.match(read('cv-build.js'), /await cvSaved\(result\.name\)/);
  assert.doesNotMatch(read('actions.js') + read('cv-build.js'), /from '\.\/profile\.js'/);
});
