// The Connect press and the Settings card's main-process side (lib/desktop-ai-connect.js): off -> waiting -> connected -> off, the helper file opened and then removed, the change list and Undo.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {connect, disconnect, stateOf, changesOf, undo} from '../lib/desktop-ai-connect.js';
import {redeem} from '../lib/desktop-ai-pairing.js';
import * as changes from '../lib/desktop-ai-changes.js';
import * as dismissed from '../lib/question-dismissed.js';
import {fakeStorage} from './desktop-ai-fake-storage.js';

test('off until Connect, waiting while the code is valid, connected only once the helper redeemed it, off after Disconnect', async () => {
  const storage = fakeStorage(), now = Date.parse('2026-11-03T10:00:00Z');
  assert.equal(stateOf(storage, now).state, 'off');
  const opened = [];
  const done = await connect(storage, {version: '9.9.9', port: 47111, openFile: async file => { opened.push(file); return ''; }, now, keepMs: 60_000});
  assert.deepEqual([done.ok, done.opened, opened.length], [true, true, 1]);
  assert.match(opened[0], /jobadabra\.mcpb$/);
  assert.equal(stateOf(storage, now + 1000).state, 'waiting', 'the file is open in Claude; nothing has reached this app yet');
  assert.equal(stateOf(storage, now + 11 * 60 * 1000).state, 'off', 'the code expired unused');
  const zip = (await import('jszip')).default, loaded = await zip.loadAsync(fs.readFileSync(opened[0]));
  const { code } = JSON.parse(await loaded.file('config.json').async('string'));
  assert.ok(redeem(storage, code, now + 2000));
  assert.equal(stateOf(storage, now + 3000).state, 'connected');
  assert.deepEqual(disconnect(storage), {ok: true});
  assert.equal(stateOf(storage, now + 4000).state, 'off');
});

test('a file the system would not open says opened: false, and a second Connect replaces the first code', async () => {
  const storage = fakeStorage();
  const first = await connect(storage, {version: '1', port: 1, openFile: async () => 'no application', keepMs: 60_000});
  assert.deepEqual([first.ok, first.opened], [true, false]);
  const second = await connect(storage, {version: '1', port: 1, openFile: async () => { throw new Error('boom'); }, keepMs: 60_000});
  assert.deepEqual([second.ok, second.opened], [true, false], 'a throwing opener is the same as a refused one');
});

test('quiet (a test, the demo, the smoke run) builds nothing and opens nothing', async () => {
  const storage = fakeStorage();
  const done = await connect(storage, {version: '1', port: 1, quiet: true, openFile: async () => { throw new Error('must not open'); }});
  assert.equal(done.ok, true);
  assert.equal(stateOf(storage).state, 'off', 'no code was registered');
});

test('the helper file is removed once its code has expired', async () => {
  const storage = fakeStorage();
  let file = '';
  await connect(storage, {version: '1', port: 1, openFile: async made => { file = made; return ''; }, keepMs: 5});
  for (let i = 0; i < 400 && fs.existsSync(file); i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(fs.existsSync(file), false);
});

test('the change list says what can be undone and why not', () => {
  const storage = fakeStorage();
  dismissed.dismiss(storage, 'L7', 'Visa needed?');
  const gone = changes.record(storage, {tool: 'dismiss_question', target: 'L7', question: 'Visa needed?', before: '', after: 'dismissed'});
  const moved = changes.record(storage, {tool: 'answer_question', target: 'L2', question: 'Notice', before: '', after: '3 months', undo: 'It moved to Your details; change it there.'});
  const listed = changesOf(storage);
  assert.deepEqual(listed.map(each => [each.id, each.canUndo]), [[moved.id, false], [gone.id, true]]);
  assert.equal(listed[0].why, 'It moved to Your details; change it there.');
});

test('Undo through the main-process function restores a dismissed question and marks the change undone', async () => {
  const storage = fakeStorage();
  dismissed.dismiss(storage, 'L7', 'Visa needed?');
  const gone = changes.record(storage, {tool: 'dismiss_question', target: 'L7', question: 'Visa needed?', before: '', after: 'dismissed'});
  assert.deepEqual(await undo(storage, gone.id), {ok: true});
  assert.equal(dismissed.isDismissed(storage, 'L7'), false);
  assert.equal(changesOf(storage)[0].undone, true);
  assert.equal(changesOf(storage)[0].canUndo, false);
  assert.equal((await undo(storage, 'nope')).ok, false);
});

test('the window gets all five channels; the demo answers off and an empty list, and a quiet run never starts the file', async () => {
  const {registerDesktopAi} = await import('../lib/desktop-ai-handlers.js');
  const handlers = {};
  const ipcMain = {handle: (name, fn) => { handlers[name] = fn; }};
  const storage = fakeStorage();
  const shell = {openPath: async () => { throw new Error('must not open'); }};
  registerDesktopAi({DEMO: true, ipcMain, shell, app: {getVersion: () => '1'}, storage, getWindow: () => null, getPlan: () => null});
  assert.deepEqual(Object.keys(handlers).sort(), ['desktopAiChanges', 'desktopAiConnect', 'desktopAiDisconnect', 'desktopAiState', 'desktopAiUndo']);
  assert.equal(handlers.desktopAiState().state, 'off');
  assert.deepEqual(handlers.desktopAiChanges(), []);
  assert.equal((await handlers.desktopAiConnect()).ok, true, 'quiet: nothing built, nothing opened');
  assert.equal((await handlers.desktopAiUndo({}, 'x')).ok, false);
});
