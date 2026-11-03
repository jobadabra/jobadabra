// The look of Connect Claude (4/6) in the window: the banner in each state, the redraw when the state changes, the Changes strip and its Undo. The main-process side is desktop-ai-connect.test.js,
// the words desktop-ai-connect-words.test.js. Runs on the tiny DOM like desktop-ai.test.js; the privacy note is seen already (its dialog needs a real browser, shown by the side-by-side preview).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from '../../tiny-dom.js';

install();
const listeners = {};
const calls = [];
let serverState = 'off';   // what the app says the connection is
let connectAnswer = {ok: true, opened: true};
globalThis.localStorage = {getItem: () => '1', setItem() {}};   // the privacy note was seen
Object.assign(globalThis.window, {
  addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
  dispatchEvent: event => { for (const fn of listeners[event.type] || []) fn(event); return true; },
  pilot: new Proxy({platform: 'darwin', desktopAiConnect: async () => { calls.push('connect'); return connectAnswer; }, desktopAiDisconnect: async () => { calls.push('disconnect'); serverState = 'off'; return {ok: true}; },
    desktopAiState: async () => ({state: serverState, lastUsedAt: '', tools: []}), desktopAiHelp: async () => ({ok: true, family: 'claude', opened: true}),
    desktopAiUndo: async id => { calls.push(['undo', id]); return {ok: true}; }}, {get: (target, key) => target[key] ?? (async () => ({}))}),
});
globalThis.document.addEventListener ??= () => {};
const {questionsNow} = await import('../../../renderer/pages/jobs-questions.js');
const {desktopAiBanner, setDesktopAiSeams} = await import('../../../renderer/pages/desktop-ai.js');
const {view, brief, pressConnect} = await import('../../../renderer/pages/desktop-ai-connect.js');
const {changesStrip} = await import('../../../renderer/pages/desktop-ai-changes.js');

const offer = state => {
  Object.assign(questionsNow(), {learned: [{question: 'Why', key: 'a'}], desktopAi: {family: 'claude'}});
  setDesktopAiSeams({focusIsRead: () => true, answered: () => false, answerEntry() {}, toast() {}});
  serverState = state;
  connectAnswer = {ok: true, opened: true};
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

test('the privacy note lists each tool by its first sentence, cut when long', () => {
  assert.equal(brief('Saves an answer. It is saved as New for the person. More words follow.'), 'Saves an answer.');
  assert.equal(brief('x'.repeat(300)).length, 108);
  assert.equal(brief(''), '');
});

test('what Disconnect or a quiet Connect says stays on the banner that the redraw put in its place', async () => {
  const box = globalThis.document.createElement('div');
  globalThis.document.body.append(box);
  offer('connected');
  box.append(desktopAiBanner());
  box.querySelector('#desktop-ai-disconnect').click();
  await settle();
  assert.equal(box.querySelector('.qa-desktop-ai').dataset.state, 'off');
  assert.match(box.querySelector('[role="status"]').textContent, /is disconnected/, 'the confirmation is not wiped by the redraw');
  box.querySelector('#desktop-ai-connect').click();
  await settle();
  assert.match(box.querySelector('[role="status"]').textContent, /Waiting for Claude/, 'a run that stays off (demo, smoke) still shows what the press did');
  box.remove();
});

test('a failed Connect says so on the banner', async () => {
  const box = globalThis.document.createElement('div');
  globalThis.document.body.append(box);
  offer('off');
  connectAnswer = {ok: false};
  box.append(desktopAiBanner());
  box.querySelector('#desktop-ai-connect').click();
  await settle();
  assert.match(box.querySelector('[role="status"]').textContent, /Could not prepare the connection/);
  box.remove();
});

test('Connect while already waiting or connected asks the app for nothing', async () => {
  for (const state of ['waiting', 'connected']) {
    offer(state);
    calls.length = 0;
    assert.deepEqual(await pressConnect('claude'), {ok: false, text: ''});
    assert.deepEqual(calls, [], `${state}: no second file`);
  }
});
