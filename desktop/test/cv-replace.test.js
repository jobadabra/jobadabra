// Replace CV on Profile → CV (Windows tester on 0.9.2, 3 Nov 2026: "CV card stale after Replace CV: the old file size and the old CV check until reload").
// Plays the press over a fake app (the file changes size, the old check no longer applies) with the real CV check view and document facts; profile.js needs the whole
// page, so the card's redraw is the same two calls loadCvSetting makes, and a source check proves Actions passes loadCvSetting itself.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

install();
const ids = ['contact-cv', 'cv-facts', 'cv-state', 'cv-view', 'cv-more', 'setting-cvcheck', 'cvc-state', 'cvc-scores', 'cvc-fixes', 'cvc-folds', 'cvc-run', 'cvc-ai-run', 'cvc-run-cost', 'cvc-ai-cost', 'cvc-message'];
for (const id of ids) { const node = globalThis.document.createElement(id.endsWith('run') ? 'button' : 'div'); node.id = id; globalThis.document.body.append(node); }
const {cvCheck} = await import('../lib/demo.js');
const app = {file: {size: 328 * 1024, addedAt: '2026-10-12T10:00:00Z'}, check: {...cvCheck, ai: undefined, billing: 'subscription'}, name: 'Old_CV.pdf', picked: null};
globalThis.window.pilot = new Proxy({
  chooseCv: async () => { app.file = {size: 91 * 1024, addedAt: '2026-11-03T01:00:00Z'}; app.check = null; app.name = 'New_CV.pdf'; return app.name; },
  state: async () => ({settings: {cvName: app.name}, secrets: {}}),
  cvStatus: async () => ({base: true, custom: false, file: app.file}),
  cvCheckStatus: async () => app.check,
}, {get: (all, key) => all[key] || (() => null)});
const {replaceCv, onCvReplaced} = await import('../renderer/pages/cv-replace.js');
const {showCvCheck} = await import('../renderer/cv-check-view.js');
const {documentFacts} = await import('../renderer/cv-check-model.js');
const {shared} = await import('../renderer/pages/shared.js');
const $ = id => globalThis.document.getElementById(id);
const loadCvSetting = async () => {   // what profile.js loadCvSetting does for the facts line and the check
  showCvCheck(await globalThis.window.pilot.cvCheckStatus());
  const status = await globalThis.window.pilot.cvStatus();
  $('cv-facts').textContent = ['Current CV', documentFacts(status.file)].join(' · ');
};

onCvReplaced(async file => { $('contact-cv').textContent = file; await loadCvSetting(); });   // what pages/profile.js registers (it needs the whole page, so a test cannot import it)

test('after Replace CV the card shows the new file\'s size and "Not checked yet", with no reload', async () => {
  await loadCvSetting();
  assert.match($('cv-facts').textContent, /328 KB/);
  assert.notEqual($('cvc-state').textContent, 'Not checked yet', 'the old file had a check');
  const said = [];
  const name = await replaceCv({choose: () => globalThis.window.pilot.chooseCv(), readState: async () => { shared.state = await globalThis.window.pilot.state(); }, say: file => said.push(file)});
  assert.equal(name, 'New_CV.pdf');
  assert.equal($('contact-cv').textContent, 'New_CV.pdf');
  assert.match($('cv-facts').textContent, /91 KB/);
  assert.doesNotMatch($('cv-facts').textContent, /328 KB/);
  assert.equal($('cvc-state').textContent, 'Not checked yet', 'the old file\'s check is not shown for the new file');
  assert.deepEqual(said, ['New_CV.pdf']);
});

test('a cancelled picker redraws and says nothing', async () => {
  let touched = 0;
  const stop = onCvReplaced(async () => { touched++; });
  assert.equal(await replaceCv({choose: async () => null, readState: async () => {}, say: () => { touched++; }}), null);
  assert.equal(touched, 0);
  stop();
});

test('"CV replaced" is said before the redraw, and a card that fails to redraw neither hides it nor stops the other cards', async () => {
  const order = [];
  const stopBad = onCvReplaced(async () => { order.push('bad'); throw new Error('cvStatus failed'); });
  const stopGood = onCvReplaced(async () => { order.push('good'); });
  await assert.rejects(replaceCv({choose: async () => 'X.pdf', readState: async () => {}, say: file => order.push(`say ${file}`)}), /cvStatus failed/);
  assert.deepEqual(order.slice(0, 3), ['say X.pdf', 'bad', 'good']);
  stopBad(); stopGood();
});

test('the pages that replace a CV redraw through the hook, and the CV card registers its loader (no import of profile.js: no import cycle)', () => {
  const read = file => fs.readFileSync(new URL(`../renderer/pages/${file}`, import.meta.url), 'utf8');
  assert.match(read('profile.js'), /onCvReplaced\(\(\) => loadCvSetting\(\)\)/);
  assert.match(read('actions.js'), /replaceCv\(\{choose/);
  assert.match(read('cv-build.js'), /cvReplaced\(result\.name\)/);
  assert.doesNotMatch(read('actions.js') + read('cv-build.js'), /from '\.\/profile\.js'/);
});
