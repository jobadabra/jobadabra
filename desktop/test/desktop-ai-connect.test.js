// The Connect press and the Settings card's main-process side (lib/desktop-ai-connect.js): off -> waiting -> connected -> off, the helper file opened and then removed, the change list and Undo.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {after, test} from 'node:test';
import {connect, disconnect, stateOf, changesOf, undo, removeFolder, sweepHelpers} from '../lib/desktop-ai-connect.js';
import {redeem, startPairing} from '../lib/desktop-ai-pairing.js';
import * as changes from '../lib/desktop-ai-changes.js';
import * as dismissed from '../lib/question-dismissed.js';
import {fakeStorage} from './desktop-ai-fake-storage.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jobadabra-connect-test-'));   // the helper folders of these tests live here, not in the real temp folder
after(() => fs.rmSync(tmp, {recursive: true, force: true}));

test('off until Connect, waiting while the code is valid, connected only once the helper redeemed it, off after Disconnect', async () => {
  const storage = fakeStorage(), now = Date.parse('2026-11-03T10:00:00Z');
  assert.equal(stateOf(storage, now).state, 'off');
  const opened = [];
  const done = await connect(storage, {version: '9.9.9', port: 47111, openFile: async file => { opened.push(file); return ''; }, now, keepMs: 60_000, tmp});
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

test('a file the system would not open says opened: false and is shown in its folder', async () => {
  const storage = fakeStorage(), shown = [];
  const refused = await connect(storage, {version: '1', port: 1, openFile: async () => 'no application', reveal: file => shown.push(file), keepMs: 60_000, tmp});
  assert.deepEqual([refused.ok, refused.opened, shown.length], [true, false, 1], 'the person is told to choose the file, so the app shows where it is');
  const thrown = await connect(fakeStorage(), {version: '1', port: 1, openFile: async () => { throw new Error('boom'); }, reveal: file => shown.push(file), keepMs: 60_000, tmp});
  assert.deepEqual([thrown.ok, thrown.opened, shown.length], [true, false, 2], 'a throwing opener is the same as a refused one');
  const fine = await connect(fakeStorage(), {version: '1', port: 1, openFile: async () => '', reveal: file => shown.push(file), keepMs: 60_000, tmp});
  assert.deepEqual([fine.opened, shown.length], [true, 2], 'an opened file is not revealed');
});

test('a second Connect while waiting or connected builds and opens nothing, so the first install keeps working', async () => {
  const storage = fakeStorage(), now = Date.parse('2026-11-03T10:00:00Z'), opened = [];
  const first = await connect(storage, {version: '1', port: 1, openFile: async file => { opened.push(file); return ''; }, now, keepMs: 60_000, tmp});
  const zip = (await import('jszip')).default, code = async () => JSON.parse(await (await zip.loadAsync(fs.readFileSync(opened[0]))).file('config.json').async('string')).code;
  const second = await connect(storage, {version: '1', port: 1, openFile: async file => { opened.push(file); return ''; }, now: now + 1000, keepMs: 60_000, tmp});
  assert.deepEqual([first.ok, second.ok, second.opened, second.already, opened.length], [true, true, false, 'waiting', 1]);
  assert.ok(redeem(storage, await code(), now + 2000), 'the first file\'s code still works');
  const third = await connect(storage, {version: '1', port: 1, openFile: async () => { throw new Error('must not open'); }, now: now + 3000, keepMs: 60_000, tmp});
  assert.equal(third.already, 'connected');
});

test('a build that fails leaves no waiting state and no folder', async () => {
  const storage = fakeStorage();
  let made = '';
  const done = await connect(storage, {version: '1', port: 1, openFile: async () => '', keepMs: 60_000, tmp, build: async (own, {dir}) => { made = dir; startPairing(own); throw new Error('disk full'); }});
  assert.equal(done.ok, false);
  assert.equal(stateOf(storage).state, 'off', 'the half-made code was dropped');
  assert.ok(made && !fs.existsSync(made), 'the folder was removed');
});

test('removing the helper folder never throws (a file Claude still holds open on Windows)', () => {
  assert.equal(removeFolder('x', () => { throw Object.assign(new Error('busy'), {code: 'EBUSY'}); }), false);
  const dir = fs.mkdtempSync(path.join(tmp, 'jobadabra-helper-'));
  assert.equal(removeFolder(dir), true);
  assert.equal(fs.existsSync(dir), false);
});

test('a helper folder left by an earlier run is swept, a fresh one and other folders are not', () => {
  const now = Date.parse('2026-11-03T10:00:00Z'), box = fs.mkdtempSync(path.join(tmp, 'sweep-'));
  const make = (name, at) => { const dir = path.join(box, name); fs.mkdirSync(dir); fs.utimesSync(dir, at / 1000, at / 1000); return dir; };
  const stale = make('jobadabra-helper-old', now - 30 * 60 * 1000), fresh = make('jobadabra-helper-new', now), other = make('something-else', now - 30 * 60 * 1000);
  sweepHelpers({dir: box, now, olderThanMs: 11 * 60 * 1000});
  assert.deepEqual([fs.existsSync(stale), fs.existsSync(fresh), fs.existsSync(other)], [false, true, true]);
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
  await connect(storage, {version: '1', port: 1, openFile: async made => { file = made; return ''; }, keepMs: 5, tmp});
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

test('Undo of a dismissal never overrides what the person did since', async () => {
  const storage = fakeStorage();
  dismissed.dismiss(storage, 'L7', 'Visa needed?');
  const gone = changes.record(storage, {tool: 'dismiss_question', target: 'L7', question: 'Visa needed?', before: '', after: 'dismissed'});
  dismissed.bringBack(storage, 'L7');   // the person brought it back themselves
  assert.equal((await undo(storage, gone.id)).ok, false, 'nothing to undo: it is not dismissed any more');
  assert.equal(changesOf(storage)[0].undone, false, 'and the list does not claim it was undone');
  dismissed.dismiss(storage, 'L7', 'A different question now on that line');   // keys are line numbers on this Mac
  assert.equal((await undo(storage, gone.id)).ok, false, 'the key names another question now');
  assert.equal(dismissed.isDismissed(storage, 'L7'), true);
});

test('the window gets all five channels; the demo answers off and fictional changes, and a quiet run never starts the file', async () => {
  const {registerDesktopAi} = await import('../lib/desktop-ai-handlers.js');
  const handlers = {};
  const ipcMain = {handle: (name, fn) => { handlers[name] = fn; }};
  const storage = fakeStorage();
  const shell = {openPath: async () => { throw new Error('must not open'); }};
  registerDesktopAi({DEMO: true, ipcMain, shell, app: {getVersion: () => '1'}, storage, getWindow: () => null, getPlan: () => null});
  assert.deepEqual(Object.keys(handlers).sort(), ['desktopAiChanges', 'desktopAiConnect', 'desktopAiDisconnect', 'desktopAiState', 'desktopAiUndo']);
  assert.equal(handlers.desktopAiState().state, 'off');
  assert.deepEqual(handlers.desktopAiChanges().map(each => each.id), ['demo-1', 'demo-2', 'demo-3'], 'fictional rows, so the demo shows the strip');
  assert.equal((await handlers.desktopAiConnect()).ok, true, 'quiet: nothing built, nothing opened');
  assert.equal((await handlers.desktopAiUndo({}, 'x')).ok, false);
});

test('outside the demo the channels answer from the store, pass the id on, and a test or smoke run still never starts the file', async () => {
  const {registerDesktopAi} = await import('../lib/desktop-ai-handlers.js');
  const handlers = {}, storage = fakeStorage(), opened = [];
  const shell = {openPath: async file => { opened.push(file); return ''; }, showItemInFolder() {}};
  const before = {e2e: process.env.JOBADABRA_E2E, smoke: process.env.JOBADABRA_SMOKE};
  try {
    for (const variable of ['JOBADABRA_E2E', 'JOBADABRA_SMOKE']) {
      delete process.env.JOBADABRA_E2E; delete process.env.JOBADABRA_SMOKE;
      process.env[variable] = '1';
      registerDesktopAi({DEMO: false, ipcMain: {handle: (name, fn) => { handlers[name] = fn; }}, shell, app: {getVersion: () => '1'}, storage, getWindow: () => null, getPlan: () => null});
      assert.equal((await handlers.desktopAiConnect()).ok, true);
      assert.deepEqual(opened, [], `${variable}: nothing opened`);
      assert.equal(handlers.desktopAiState().state, 'off', `${variable}: nothing registered`);
    }
  } finally {
    for (const [name, value] of [['JOBADABRA_E2E', before.e2e], ['JOBADABRA_SMOKE', before.smoke]]) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
  assert.ok(handlers.desktopAiState().tools.length > 0, 'the tool list reaches the window');
  dismissed.dismiss(storage, 'L7', 'Visa needed?');
  const gone = changes.record(storage, {tool: 'dismiss_question', target: 'L7', question: 'Visa needed?', before: '', after: 'dismissed'});
  assert.equal(handlers.desktopAiChanges().length, 1);
  assert.deepEqual(await handlers.desktopAiUndo({}, gone.id), {ok: true}, 'the id arrives as the second argument');
  assert.deepEqual(await handlers.desktopAiDisconnect(), {ok: true});
});

test('Connect, Disconnect and Undo each leave one log line with identities and outcomes, never the code, the path or the question', async () => {
  const {registerDesktopAi} = await import('../lib/desktop-ai-handlers.js');
  const {logTo} = await import('../lib/log.js');
  const folder = fs.mkdtempSync(path.join(tmp, 'log-'));
  logTo(folder);
  const handlers = {}, storage = fakeStorage(), before = process.env.JOBADABRA_E2E;
  process.env.JOBADABRA_E2E = '1';   // quiet: nothing is built or opened
  try {
    registerDesktopAi({DEMO: false, ipcMain: {handle: (name, fn) => { handlers[name] = fn; }}, shell: {}, app: {getVersion: () => '1'}, storage, getWindow: () => null, getPlan: () => null});
    dismissed.dismiss(storage, 'L7', 'A private question about visas');
    const gone = changes.record(storage, {tool: 'dismiss_question', target: 'L7', question: 'A private question about visas', before: '', after: 'dismissed'});
    await handlers.desktopAiConnect();
    handlers.desktopAiDisconnect();
    await handlers.desktopAiUndo({}, gone.id);
  } finally { if (before === undefined) delete process.env.JOBADABRA_E2E; else process.env.JOBADABRA_E2E = before; }
  const lines = fs.readFileSync(path.join(folder, 'app.log'), 'utf8').split('\n').filter(line => line.includes('[desktop-ai]'));
  assert.deepEqual(lines.map(line => /\] (\w+ \w+)/.exec(line)[1]), ['connect pressed', 'disconnect pressed', 'undo pressed']);
  assert.match(lines[2], new RegExp(`"id":"${changes.list(storage)[0].id}","ok":true`));
  assert.doesNotMatch(lines.join('\n'), /private question|\.mcpb|jobadabra-helper/);
});

test('an Undo that throws (the store fails) still leaves its log line', async () => {
  const {registerDesktopAi} = await import('../lib/desktop-ai-handlers.js');
  const {logTo} = await import('../lib/log.js');
  const folder = fs.mkdtempSync(path.join(tmp, 'log-'));
  logTo(folder);
  const handlers = {}, storage = fakeStorage();
  registerDesktopAi({DEMO: false, ipcMain: {handle: (name, fn) => { handlers[name] = fn; }}, shell: {}, app: {getVersion: () => '1'}, storage, getWindow: () => null, getPlan: () => null});
  dismissed.dismiss(storage, 'L7', 'Visa needed?');
  const gone = changes.record(storage, {tool: 'dismiss_question', target: 'L7', question: 'Visa needed?', before: '', after: 'dismissed'});
  storage.saveSettings = () => { throw new TypeError('store down'); };
  await assert.rejects(handlers.desktopAiUndo({}, gone.id), /store down/);
  const lines = fs.readFileSync(path.join(folder, 'app.log'), 'utf8').split('\n').filter(line => line.includes('undo pressed'));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /"ok":false,"error":"TypeError"/);
  assert.doesNotMatch(lines[0], /store down|Visa/, 'the error name only');
});
