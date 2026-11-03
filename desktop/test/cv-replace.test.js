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
const {replaceCv} = await import('../renderer/pages/cv-replace.js');
const {showCvCheck} = await import('../renderer/cv-check-view.js');
const {documentFacts} = await import('../renderer/cv-check-model.js');
const {shared} = await import('../renderer/pages/shared.js');
const $ = id => globalThis.document.getElementById(id);
const loadCvSetting = async () => {   // what profile.js loadCvSetting does for the facts line and the check
  showCvCheck(await globalThis.window.pilot.cvCheckStatus());
  const status = await globalThis.window.pilot.cvStatus();
  $('cv-facts').textContent = ['Current CV', documentFacts(status.file)].join(' · ');
};

test('after Replace CV the card shows the new file\'s size and "Not checked yet", with no reload', async () => {
  await loadCvSetting();
  assert.match($('cv-facts').textContent, /328 KB/);
  assert.notEqual($('cvc-state').textContent, 'Not checked yet', 'the old file had a check');
  const said = [];
  const name = await replaceCv({choose: () => globalThis.window.pilot.chooseCv(), readState: async () => { shared.state = await globalThis.window.pilot.state(); },
    redraw: async file => { $('contact-cv').textContent = file; await loadCvSetting(); }, say: file => said.push(file)});
  assert.equal(name, 'New_CV.pdf');
  assert.equal($('contact-cv').textContent, 'New_CV.pdf');
  assert.match($('cv-facts').textContent, /91 KB/);
  assert.doesNotMatch($('cv-facts').textContent, /328 KB/);
  assert.equal($('cvc-state').textContent, 'Not checked yet', 'the old file\'s check is not shown for the new file');
  assert.deepEqual(said, ['New_CV.pdf']);
});

test('"CV replaced" is said even when the card fails to redraw', async () => {
  const said = [];
  await assert.rejects(replaceCv({choose: async () => 'X.pdf', readState: async () => {}, redraw: async () => { throw new Error('cvStatus failed'); }, say: file => said.push(file)}), /cvStatus failed/);
  assert.deepEqual(said, ['X.pdf']);
});

test('a cancelled picker redraws nothing', async () => {
  let drawn = 0;
  assert.equal(await replaceCv({choose: async () => null, readState: async () => {}, redraw: async () => { drawn++; }, say: () => { drawn++; }}), null);
  assert.equal(drawn, 0);
});

test('the Actions button goes through replaceCv and redraws the CV card (not only its name)', () => {
  const source = fs.readFileSync(new URL('../renderer/pages/actions.js', import.meta.url), 'utf8');
  assert.match(source, /replaceCv\(\{choose/);
  assert.match(source, /redraw: async file => \{[^}\n]*await loadCvSetting\(\)/, 'the redraw argument is the CV card\'s own loader, not a comment or a separate call');
  const build = fs.readFileSync(new URL('../renderer/pages/cv-build.js', import.meta.url), 'utf8');
  assert.match(build, /\n\s+loadCvSetting\(\);/, 'Build with AI replaces the CV too: same redraw');
});
