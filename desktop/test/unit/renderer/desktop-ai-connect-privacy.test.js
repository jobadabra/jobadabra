// The privacy note before the first Connect (4/6, owner D4): shown once per AI, "Not now" and a closed dialog connect nothing, "Connect" is remembered. The dialog is stubbed (the real one is shown by the side-by-side preview).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from '../../tiny-dom.js';

install();
const stored = {};
globalThis.localStorage = {getItem: key => stored[key] ?? null, setItem: (key, value) => { stored[key] = value; }};
const calls = [];
Object.assign(globalThis.window, {
  dispatchEvent: () => true,
  pilot: new Proxy({desktopAiConnect: async () => { calls.push('connect'); return {ok: true, opened: true}; }, desktopAiState: async () => ({state: 'off', lastUsedAt: '', tools: [{name: 'get_open_questions', description: 'Lists the open questions. More words follow.'}]})}, {get: (target, key) => target[key] ?? (async () => ({}))}),
});
let answer = 'cancel';   // what the person presses in the dialog
const make = (tag, id) => { const node = globalThis.document.createElement(tag); node.id = id; globalThis.document.body.append(node); return node; };
const dialog = make('div', 'desktop-ai-privacy-dialog');
Object.assign(dialog, {open: false, returnValue: '', showModal() { dialog.open = true; queueMicrotask(() => { dialog.open = false; dialog.returnValue = answer; for (const fn of dialog.listeners.close || []) fn(); }); }});
for (const id of ['title', 'text', 'yes', 'no', 'tools']) make('div', `desktop-ai-privacy-${id}`);
make('ul', 'desktop-ai-privacy-list');
const {pressConnect} = await import('../../../renderer/pages/desktop-ai-connect.js');

test('Not now, or closing the dialog, connects nothing and is asked again next time', async () => {
  for (const closed of ['cancel', '']) {
    answer = closed;
    calls.length = 0;
    assert.deepEqual(await pressConnect('claude'), {ok: false, text: ''});
    assert.deepEqual(calls, []);
  }
  assert.equal(stored['desktopAiPrivacy:claude'], undefined);
  assert.match(globalThis.document.getElementById('desktop-ai-privacy-text').textContent, /Anthropic/, 'the note names the company');
  assert.equal(globalThis.document.getElementById('desktop-ai-privacy-list').children[0].textContent, 'get_open_questions: Lists the open questions.');
});

test('Connect in the note connects and is remembered, so the note shows once', async () => {
  answer = 'default';
  calls.length = 0;
  assert.equal((await pressConnect('claude')).ok, true);
  assert.deepEqual(calls, ['connect']);
  assert.equal(stored['desktopAiPrivacy:claude'], '1');
  answer = 'cancel';   // a second press would be refused if the note showed again
  assert.equal((await pressConnect('claude')).ok, true);
  assert.deepEqual(calls, ['connect', 'connect']);
});
