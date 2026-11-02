// "Let the Claude or ChatGPT desktop app answer your questions", layer 2: the app's own handlers on a FAKE Windows or Mac (no real app is started, no real clipboard).
// Why (2 Nov 2026, owner): a friend's Claude Desktop answered the questions queue by itself; the banner offers it with a copied instruction and a button that opens the app.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {registerSetupHandlers} from '../../lib/setup-handlers.js';
import {createStorage} from '../../lib/storage.js';
import {instruction, words} from '../../renderer/desktop-ai-words.js';

const W = 'C:\\Users\\Ann', LOCAL = `${W}\\AppData\\Local`;
const WIN = {platform: 'win32', env: {USERPROFILE: W, LOCALAPPDATA: LOCAL, APPDATA: `${W}\\AppData\\Roaming`, ProgramFiles: 'C:\\Program Files', PATH: 'C:\\Windows\\system32'}, home: W};
const MAC = {platform: 'darwin', env: {HOME: '/Users/ann', PATH: '/usr/bin'}, home: '/Users/ann'};

/** The handlers on a fake computer: `has` = the files and folders that exist, `list` = folder names inside a folder. Records what was copied and started. */
function pcWith(t, system, {has = [], list = {}, openApp = async () => true, shellOpen = async () => '', copyThrows = false} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-desktop-ai-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const handlers = new Map(), copied = [], started = [];
  const storage = createStorage(dir, {encrypt: value => value, decrypt: value => value});
  registerSetupHandlers({storage, ipcMain: {handle: (name, fn) => handlers.set(name, fn)}, handleImportant: () => {}, toWindow: () => {}, track: () => {}, getWindow: () => null,
    dialog: {}, shell: {openExternal() {}, openPath: async file => { started.push(file); return shellOpen(file); }}, clipboard: {writeText: text => { if (copyThrows) throw new Error('clipboard busy'); copied.push(text); }},
    plan: {pc: {...system, registry: () => [], exists: file => has.includes(file), list: folder => list[folder] || [], read: () => { throw new Error('ENOENT'); }}, platform: system.platform,
      openApp: async (command, args) => { started.push([command, ...args].join(' ')); return openApp(command, args); }}});
  return {copied, started, invoke: (name, ...args) => handlers.get(name)(null, ...args)};
}

test('Windows with Claude Desktop: the banner finds it, one press copies the instruction and starts the app\'s own file', async t => {
  const exe = `${LOCAL}\\AnthropicClaude\\claude.exe`;
  const pc = pcWith(t, WIN, {has: [`${LOCAL}\\AnthropicClaude`, exe]});
  assert.deepEqual(await pc.invoke('desktopAiApp'), {family: 'claude'}, 'the window learns the family, never the file');
  assert.deepEqual(await pc.invoke('desktopAiHelp'), {ok: true, family: 'claude', opened: true});
  assert.deepEqual(pc.copied, [instruction()]);
  assert.deepEqual(pc.started, [exe]);
});

test('Windows: an installer that keeps versions in app-x.y.z folders starts the newest one', async t => {
  const folder = `${LOCAL}\\AnthropicClaude`, newest = `${folder}\\app-1.4.0\\claude.exe`;
  const pc = pcWith(t, WIN, {has: [folder, newest, `${folder}\\app-1.3.0\\claude.exe`], list: {[folder]: ['app-1.3.0', 'app-1.4.0', 'packages']}});
  assert.equal((await pc.invoke('desktopAiHelp')).opened, true);
  assert.deepEqual(pc.started, [newest]);
});

test('Windows: 1.10.0 is newer than 1.9.0 (the folders are compared as numbers, not as text; Gitar on #3023)', async t => {
  const folder = `${LOCAL}\\AnthropicClaude`, newest = `${folder}\\app-1.10.0\\claude.exe`;
  const pc = pcWith(t, WIN, {has: [folder, newest, `${folder}\\app-1.9.0\\claude.exe`], list: {[folder]: ['app-1.10.0', 'app-1.9.0']}});
  await pc.invoke('desktopAiHelp');
  assert.deepEqual(pc.started, [newest]);
});

test('a clipboard that refuses is its own answer: the app is there, nothing was copied, nothing was started (Gitar on #3023)', async t => {
  const exe = `${LOCAL}\\AnthropicClaude\\claude.exe`;
  const pc = pcWith(t, WIN, {has: [`${LOCAL}\\AnthropicClaude`, exe], copyThrows: true});
  assert.deepEqual(await pc.invoke('desktopAiHelp'), {ok: false, reason: 'error'});
  assert.deepEqual(pc.started, []);
});

test('Windows with only a Store package (no file to start): copied, and honestly not "opened"', async t => {
  const packages = `${LOCAL}\\Packages`;
  const pc = pcWith(t, WIN, {has: [packages], list: {[packages]: ['Claude_pzs8sxrjxfjjc']}});
  assert.deepEqual(await pc.invoke('desktopAiApp'), {family: 'claude'});
  assert.deepEqual(await pc.invoke('desktopAiHelp'), {ok: true, family: 'claude', opened: false});
  assert.deepEqual(pc.copied, [instruction()]);
  assert.deepEqual(pc.started, [], 'nothing was started');
});

test('Windows: the app\'s file failing to start is "not opened", the copy still stands', async t => {
  const exe = `${LOCAL}\\Programs\\ChatGPT\\ChatGPT.exe`;
  const pc = pcWith(t, WIN, {has: [`${LOCAL}\\Programs\\ChatGPT`, exe], shellOpen: async () => 'Failed to open path'});
  assert.deepEqual(await pc.invoke('desktopAiHelp'), {ok: true, family: 'openai', opened: false});
  assert.equal(pc.copied.length, 1);
});

test('Mac with the ChatGPT app: `open <the .app found>`; Claude is chosen first when both are there', async t => {
  const chatgpt = pcWith(t, MAC, {has: ['/Applications/ChatGPT.app']});
  assert.deepEqual(await chatgpt.invoke('desktopAiHelp'), {ok: true, family: 'openai', opened: true});
  assert.deepEqual(chatgpt.started, ['open /Applications/ChatGPT.app']);
  const both = pcWith(t, MAC, {has: ['/Applications/ChatGPT.app', '/Users/ann/Applications/Claude.app']});
  assert.deepEqual(await both.invoke('desktopAiApp'), {family: 'claude'});
  await both.invoke('desktopAiHelp');
  assert.deepEqual(both.started, ['open /Users/ann/Applications/Claude.app']);
});

test('no desktop AI app: nothing to show, nothing copied or started', async t => {
  const pc = pcWith(t, WIN);
  assert.equal(await pc.invoke('desktopAiApp'), null);
  assert.deepEqual(await pc.invoke('desktopAiHelp'), {ok: false, reason: 'none'});
  assert.deepEqual([pc.copied, pc.started], [[], []]);
});

test('a test run never starts the person\'s app (the end-to-end run, the smoke run)', async t => {
  const before = process.env.JOBADABRA_E2E;
  process.env.JOBADABRA_E2E = '1';
  t.after(() => { if (before === undefined) delete process.env.JOBADABRA_E2E; else process.env.JOBADABRA_E2E = before; });
  const exe = `${LOCAL}\\AnthropicClaude\\claude.exe`;
  const pc = pcWith(t, WIN, {has: [`${LOCAL}\\AnthropicClaude`, exe]});
  assert.deepEqual(await pc.invoke('desktopAiHelp'), {ok: true, family: 'claude', opened: false});
  assert.deepEqual(pc.started, []);
});

test('the instruction says what the owner asked and promises nothing more; the words name the right app and paste key', () => {
  const text = instruction();
  for (const part of [/Profile → What we learned/, /from my CV and my details/, /Never invent/, /skip that question/, /Never press Submit on any job/, /Do not change Settings/]) assert.match(text, part);
  assert.match(words('claude', 'win32').done(true), /Claude is open.*Ctrl\+V/);
  assert.match(words('openai', 'darwin').done(false), /Open ChatGPT yourself.*⌘V/);
  assert.match(words('claude').lead, /same checks/);
  assert.doesNotMatch(JSON.stringify(words('claude')), /guarantee|always correct|automatically submit/i);
});
