// The owner's XING run (7 Nov 2026): Continue pressed on step 1, step 2 shows at the same address, and nothing read it ("the extension panel stopped, even if the work was not done").
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readAfterNextStep} from '../../extension/next-step-read.js';
import {pressInPage} from '../../extension/next-step.js';

const URL1 = 'https://www.xing.com/jobs/custom-apply/captain-c525-146641869?#jobpilotto';
const parts = (over = {}) => {
  const calls = [];
  return {calls, still: async () => ({still: true, ms: 600}), getTab: async () => ({id: 5, url: URL1}), signature: async () => 'step 2', forget: tab => calls.push(['forget', tab.url]), read: async tab => calls.push(['read', tab.url]), log: text => calls.push(['log', text]), ...over};
};

test('a step that changes in place at the same address is read again, once', async () => {
  const p = parts();
  assert.equal(await readAfterNextStep({id: 5, url: URL1}, 'step 1', p), 'read');
  assert.deepEqual(p.calls.map(call => call[0]), ['log', 'forget', 'read']);
});

test('a step that swapped before any watcher could start still reads: the page\'s signature decides, not a timer', async () => {
  const p = parts({still: async () => ({still: false, ms: 3000})});   // the quiet wait gave no answer: the page is compared all the same
  assert.equal(await readAfterNextStep({id: 5, url: URL1}, 'step 1', p), 'read');
});

test('a press that moved the tab to another address is left to that page\'s own load', async () => {
  const p = parts({getTab: async () => ({id: 5, url: 'https://www.xing.com/jobs/custom-apply/captain-c525-146641869/step-3'})});
  assert.equal(await readAfterNextStep({id: 5, url: URL1}, 'step 1', p), 'moved');
  assert.deepEqual(p.calls, []);
});

test('a press that changed nothing, an unreadable page, or a closed tab reads nothing (no loop on a Continue that did nothing)', async () => {
  const same = parts({signature: async () => 'step 1'}), blind = parts({signature: async () => ''}), gone = parts({getTab: async () => null});
  assert.equal(await readAfterNextStep({id: 5, url: URL1}, 'step 1', same), 'unchanged');
  assert.equal(await readAfterNextStep({id: 5, url: URL1}, 'step 1', blind), 'unchanged');
  assert.equal(await readAfterNextStep({id: 5, url: URL1}, '', parts()), 'unchanged');
  assert.equal(await readAfterNextStep({id: 5, url: URL1}, 'step 1', gone), 'gone');
  assert.deepEqual([...same.calls, ...blind.calls, ...gone.calls], []);
});

// form-ready.js: a pressed Continue hands the tab to the one reader; a judged page with no next control does not.
async function formWith(answer, pressed) {
  const {formNext, useNextStepRead, forgetJudged} = await import('../../extension/form-ready.js');
  const read = [], keep = {chrome: globalThis.chrome, fetch: globalThis.fetch};
  useNextStepRead(async (tab, before) => { read.push([tab.id, typeof before === 'string' && before.length > 0]); });
  globalThis.chrome = {
    storage: {local: {get: async () => ({workerUrl: 'http://127.0.0.1:47111', token: 't'}), set: async () => {}}, session: {get: async () => ({}), set: async () => {}}},
    scripting: {executeScript: async ({func}) => (func === pressInPage ? [{result: {pressed}}] : [{result: {url: URL1, title: 'Step 2', headings: [], controls: [], buttons: ['Continue'], texts: [], frames: []}}])},
    runtime: {getManifest: () => ({version: '0'})}};
  globalThis.fetch = async () => ({ok: true, status: 200, json: async () => answer, text: async () => ''});
  forgetJudged(5);
  try { await formNext({id: 5, url: URL1}, 0); await new Promise(resolve => setTimeout(resolve, 20)); } finally { Object.assign(globalThis, keep); }
  return read;
}

test('form-ready: a pressed Continue asks for the new step to be read; a refused or absent one does not', async () => {
  assert.deepEqual(await formWith({answer: 'ready', step: 'middle', nextControl: 'Continue'}, true), [[5, true]]);
  assert.deepEqual(await formWith({answer: 'ready', step: 'middle', nextControl: 'Continue'}, false), []);
  assert.deepEqual(await formWith({answer: 'ready', step: 'middle', nextControl: ''}, true), []);
});

test('fill-flow hands the one reader to form-ready', async () => {
  const fs = await import('node:fs');
  assert.match(fs.readFileSync(new URL('../../extension/fill-flow.js', import.meta.url), 'utf8'), /useNextStepRead\(readNextStep\)/);
});
