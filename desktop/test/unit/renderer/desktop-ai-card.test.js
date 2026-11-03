// The Settings → Connections card for the Claude desktop app (4/6): it reads the same view as the banner, says the Install step once while waiting (also after a reload), shows Connect or Disconnect for
// the state, and keeps what Disconnect said after its redraw.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from '../../tiny-dom.js';

install();
const listeners = {};
let serverState = 'off';
Object.assign(globalThis.window, {
  addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
  dispatchEvent: event => { for (const fn of listeners[event.type] || []) fn(event); return true; },
  pilot: new Proxy({platform: 'darwin', desktopAiApp: async () => ({family: 'claude'}), desktopAiState: async () => ({state: serverState, lastUsedAt: '', tools: []}),
    desktopAiDisconnect: async () => { serverState = 'off'; return {ok: true}; }}, {get: (target, key) => target[key] ?? (async () => ({}))}),
});
const make = (tag, id) => { const node = globalThis.document.createElement(tag); node.id = id; globalThis.document.body.append(node); return node; };
const card = make('section', 'setting-desktop-ai');
for (const id of ['dai-title', 'dai-line', 'dai-status', 'dai-message']) make('span', id);
for (const id of ['dai-connect', 'dai-disconnect']) make('button', id);
const {showDesktopAiCard, bindDesktopAiCard} = await import('../../../renderer/pages/desktop-ai-card.js');
const {view} = await import('../../../renderer/pages/desktop-ai-connect.js');
const text = id => globalThis.document.getElementById(id).textContent;
const hidden = id => globalThis.document.getElementById(id).hidden;
const settle = () => new Promise(resolve => setImmediate(resolve));

test('off: Connect only; waiting (even after a reload, with no press made): Disconnect and the Install step said once; connected: Disconnect and the last use', async () => {
  serverState = 'off';
  await showDesktopAiCard();
  assert.deepEqual([hidden('dai-connect'), hidden('dai-disconnect'), card.hidden], [false, true, false]);
  assert.equal(text('dai-status'), 'Not connected');
  serverState = 'waiting';
  view.note = '';
  await showDesktopAiCard();
  assert.deepEqual([hidden('dai-connect'), hidden('dai-disconnect')], [true, false]);
  assert.match(text('dai-message'), /press Install/);
  assert.doesNotMatch(text('dai-line'), /press Install/, 'said once, not in both lines');
  serverState = 'connected';
  await showDesktopAiCard();
  assert.equal(text('dai-message'), '', 'a connected card carries no waiting text');
  assert.match(text('dai-status'), /Connected/);
});

test('Disconnect asks the app, and its confirmation survives the redraw', async () => {
  bindDesktopAiCard();
  serverState = 'connected';
  await showDesktopAiCard();
  globalThis.document.getElementById('dai-disconnect').click();
  await settle();
  await settle();
  assert.equal(text('dai-status'), 'Not connected');
  assert.match(text('dai-message'), /is disconnected/);
});
