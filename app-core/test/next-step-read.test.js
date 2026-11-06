// The owner's XING run (7 Nov 2026): Continue pressed on step 1, step 2 shows at the same address, and nothing read it ("the extension panel stopped, even if the work was not done").
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readAfterNextStep} from '../../extension/next-step-read.js';
import {pressInPage} from '../../extension/next-step.js';

const URL1 = 'https://www.xing.com/jobs/custom-apply/captain-c525-146641869?#jobadabra';
const parts = (over = {}) => {
  const calls = [];
  return {calls, still: async () => ({still: true, ms: 600}), getTab: async () => ({id: 5, url: URL1}), signature: async () => 'step 2', read: async tab => calls.push(['read', tab.url]), log: text => calls.push(['log', text]), ...over};
};

test('a step that changes in place at the same address is read again, once', async () => {
  const p = parts();
  assert.equal(await readAfterNextStep({id: 5, url: URL1}, 'step 1', p), 'read');
  assert.deepEqual(p.calls.map(call => call[0]), ['log', 'read']);
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

// Gitar on #3356 and the code review: the real wiring, not a grep of the source. The step's key is in `started` (a page is read once per address); after a pressed Continue that changed the page
// in place, the key is forgotten and the page is read again (consider adds it back as it starts).
test('fill-flow\'s reader forgets the page\'s key and reads it again when the step changed in place, and not when nothing changed', async () => {
  const keep = {chrome: globalThis.chrome};
  const sketch = {url: URL1, title: 'Step 2', headings: [], controls: [{label: 'Which country do you live in?', type: 'select'}], buttons: ['Continue'], texts: [], frames: []};
  globalThis.chrome = {runtime: {id: 'x', getManifest: () => ({version: '0'}), onMessage: {addListener: () => {}}}, storage: {local: {get: async () => ({}), set: async () => {}}, session: {get: async () => ({}), set: async () => {}}},
    tabs: {get: async id => ({id, url: URL1, status: 'complete'})},
    scripting: {executeScript: async ({func}) => [{result: String(func).includes('MutationObserver') ? {still: true, ms: 1} : {...sketch}}]}};
  try {
    const {initFillFlow, readNextStep, fillKey} = await import('../../extension/fill-flow.js');
    const {pageSignature} = await import('../../extension/form-ready.js');
    const ops = [], key = fillKey(5, URL1), started = new Set([key]);
    const watched = {has: item => started.has(item), add: item => { ops.push(['add', item]); started.add(item); return watched; }, delete: item => { ops.push(['delete', item]); return started.delete(item); }, get size() { return started.size; }, [Symbol.iterator]: () => started[Symbol.iterator]()};
    initFillFlow({started: watched, fillOpenedTab: async () => null, reportFlow: async () => {}, onPage: async () => true});
    const same = await pageSignature({id: 5, url: URL1}, 0);
    assert.notEqual(same, '', 'the page reads');
    await readNextStep({id: 5, url: URL1}, same, 0).catch(() => {});
    assert.deepEqual(ops, [], 'a press that changed nothing: the page is not read again');
    await readNextStep({id: 5, url: URL1}, 'the signature of step 1', 0).catch(() => {});   // consider runs on after it begins; only its first moves matter here
    assert.deepEqual(ops.slice(0, 2), [['delete', key], ['add', key]], 'the step-2 page\'s key is forgotten, then the read begins');
  } finally { Object.assign(globalThis, keep); }
});
