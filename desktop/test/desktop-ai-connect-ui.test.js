// The look of Connect Claude (4/6) in the window: the banner in each state, the redraw when the state changes, the Changes strip and its Undo. The main-process side is desktop-ai-connect.test.js,
// the words desktop-ai-connect-words.test.js. Runs on the tiny DOM like desktop-ai.test.js; the privacy note is seen already (its dialog needs a real browser, shown by the side-by-side preview).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

install();
const listeners = {};
const calls = [];
globalThis.localStorage = {getItem: () => '1', setItem() {}};   // the privacy note was seen
Object.assign(globalThis.window, {
  addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
  dispatchEvent: event => { for (const fn of listeners[event.type] || []) fn(event); return true; },
  pilot: new Proxy({platform: 'darwin', desktopAiConnect: async () => { calls.push('connect'); return {ok: true, opened: true}; }, desktopAiDisconnect: async () => { calls.push('disconnect'); return {ok: true}; },
    desktopAiState: async () => ({state: 'off', lastUsedAt: '', tools: []}), desktopAiHelp: async () => ({ok: true, family: 'claude', opened: true}),
    desktopAiUndo: async id => { calls.push(['undo', id]); return {ok: true}; }}, {get: (target, key) => target[key] ?? (async () => ({}))}),
});
globalThis.document.addEventListener ??= () => {};
const {questionsNow} = await import('../renderer/pages/jobs-questions.js');
const {desktopAiBanner, setDesktopAiSeams} = await import('../renderer/pages/desktop-ai.js');
const {view} = await import('../renderer/pages/desktop-ai-connect.js');
const {changesStrip} = await import('../renderer/pages/desktop-ai-changes.js');

const offer = state => {
  Object.assign(questionsNow(), {learned: [{question: 'Why', key: 'a'}], desktopAi: {family: 'claude'}});
  setDesktopAiSeams({focusIsRead: () => true, answered: () => false, answerEntry() {}, toast() {}});
  Object.assign(view, {loaded: true, state, lastUsedAt: '', note: ''});
};
const ids = banner => Array.from(banner.querySelectorAll('button'), button => button.id);
const settle = () => new Promise(resolve => setImmediate(resolve));

test('not connected: Connect Claude is the primary button, the copy press is secondary; pressing Connect asks the app and says what to do next', async () => {
  offer('off');
  const banner = desktopAiBanner();
  assert.deepEqual(ids(banner), ['desktop-ai-connect', 'desktop-ai-copy', 'desktop-ai-later']);
  assert.match(banner.querySelector('#desktop-ai-connect').className, /primary/);
  assert.match(banner.querySelector('#desktop-ai-copy').className, /secondary/);
  calls.length = 0;
  banner.querySelector('#desktop-ai-connect').click();
  await settle();
  assert.deepEqual(calls, ['connect']);
  assert.match(banner.querySelector('[role="status"]').textContent, /Waiting for Claude.*press Install/);
});

test('waiting: only Disconnect and Not now, with the wait written in the lead', () => {
  offer('waiting');
  view.note = 'Waiting for Claude. In its window, read what it asks and press Install.';
  const banner = desktopAiBanner();
  assert.deepEqual(ids(banner), ['desktop-ai-disconnect', 'desktop-ai-later']);
  assert.match(banner.querySelector('[role="status"]').textContent, /press Install/);
});

test('connected: the title says when it was last used, the copy press stays primary, Disconnect is there; Disconnect asks the app', async () => {
  offer('connected');
  view.lastUsedAt = '2026-11-02T09:05:00.000Z';   // a fixed day: the line then reads "2 Nov, hh:mm" whatever today is
  const banner = desktopAiBanner();
  assert.match(banner.querySelector('b').textContent, /^Claude is connected · Last used \d{1,2} \w{3}, \d\d:\d\d$/);
  assert.deepEqual(ids(banner), ['desktop-ai-copy', 'desktop-ai-disconnect', 'desktop-ai-later']);
  assert.match(banner.querySelector('#desktop-ai-copy').className, /primary/);
  calls.length = 0;
  banner.querySelector('#desktop-ai-disconnect').click();
  await settle();
  assert.deepEqual(calls, ['disconnect']);
});

test('ChatGPT has no Connect yet: its banner stays the copy press', () => {
  Object.assign(questionsNow(), {learned: [{question: 'Why', key: 'a'}], desktopAi: {family: 'openai'}});
  Object.assign(view, {state: 'off'});
  assert.deepEqual(ids(desktopAiBanner()), ['desktop-ai-copy', 'desktop-ai-later']);
});

test('a banner on the page turns when the connection changes', () => {
  offer('off');
  const box = globalThis.document.createElement('div');
  globalThis.document.body.append(box);
  box.append(desktopAiBanner());
  assert.equal(box.querySelector('.qa-desktop-ai').dataset.state, 'off');
  view.state = 'connected';
  globalThis.window.dispatchEvent(new Event('desktop-ai-changed'));
  assert.equal(box.querySelector('.qa-desktop-ai').dataset.state, 'connected', 'redrawn in place, no reopening');
  box.remove();
});

test('the Changes strip: nothing while there are no changes; a row says before to after, offers Undo, says why when it cannot, and Undo asks the app', () => {
  assert.equal(changesStrip([], 'claude', () => {}), null);
  const at = '2026-11-03T10:00:00.000Z';
  const rows = [
    {id: 'a1', at, tool: 'answer_question', question: 'Notice period', before: '', after: '3 months (new)', undone: false, canUndo: true, why: ''},
    {id: 'b2', at, tool: 'answer_question', question: 'Visa', before: '', after: 'Yes', undone: false, canUndo: false, why: 'It moved to Your details; change it there.'},
    {id: 'c3', at, tool: 'dismiss_question', question: 'Hobbies', before: '', after: 'dismissed', undone: true, canUndo: false, why: ''},
  ];
  const pressed = [];
  const strip = changesStrip(rows, 'claude', change => pressed.push(change.id));
  assert.equal(strip.children[0].textContent, 'Changes by Claude');
  const text = id => Array.from(strip.querySelectorAll('.qa-change')).find(row => row.dataset.id === id).textContent;
  assert.match(text('a1'), /Notice period.*open → 3 months \(new\)/);
  assert.match(text('b2'), /change it there/);
  assert.match(text('c3'), /Set aside.*Undone/);
  assert.equal(strip.querySelectorAll('button').length, 1, 'only the change Undo can restore has a button');
  strip.querySelector('button').click();
  assert.deepEqual(pressed, ['a1']);
});
