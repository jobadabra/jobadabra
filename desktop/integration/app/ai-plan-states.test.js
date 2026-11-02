// The AI chooser's readiness states, layer 2, the half a window cannot play: the app's own handlers on FAKE computers (Windows and Mac; only the Claude app, only the ChatGPT app, nothing, not signed in,
// a chosen file that is gone, a CLI that does not start, a failed check), a temp folder for settings, no real CLI, no ~/.claude.json, no network. What the window would draw comes from the status and
// the words of each state. Why (2 Nov 2026, owner: "How can we check all the scenarios… we should never show a raw error"): a Windows tester had only the Claude app and saw a wall of folders.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {cleanProps, EVENTS} from '../../lib/analytics.js';
import {registerSetupHandlers} from '../../lib/setup-handlers.js';
import {FAILURES, STATES} from '../../lib/plan-readiness.js';
import {createStorage} from '../../lib/storage.js';
import {guide} from '../../renderer/ai-plan-guide.js';

const W = 'C:\\Users\\Ann', RAW_ERROR = `Claude Code failed: spawn C:\\Users\\Ann\\.local\\bin\\claude.exe ENOENT (exit code 1) at Object.<anonymous> (C:\\x\\y.js:10:3)`;
const WIN = {platform: 'win32', env: {USERPROFILE: W, LOCALAPPDATA: `${W}\\AppData\\Local`, APPDATA: `${W}\\AppData\\Roaming`, ProgramFiles: 'C:\\Program Files', PATH: 'C:\\Windows\\system32'}, home: W};
const MAC = {platform: 'darwin', env: {HOME: '/Users/ann', PATH: '/usr/bin:/bin'}, home: '/Users/ann'};
const CLAUDE_EXE = `${W}\\.local\\bin\\claude.exe`, CODEX_EXE = `${W}\\.local\\bin\\codex.exe`, CLAUDE_APP = `${W}\\AppData\\Local\\AnthropicClaude`;
const OK = {checkedAt: '2026-11-02T10:00:00Z', authenticated: true, login: 'signed-in'};

/** The handlers of the setup on a fake computer. -> {storage, invoke, events, choose(file)}; `version` is what `claude --version` gives. */
function app(t, base, {has = [], settings = {}, packages = {}, version = '2.1.7', pick = null, account = false} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-plan-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const storage = createStorage(dir, {encrypt: value => value, decrypt: value => value});
  storage.saveSettings(settings);
  const handlers = new Map(), events = [], opened = [];
  const computer = {...base, registry: () => [], exists: file => has.includes(file), list: folder => packages[folder] || [],
    read: () => { if (account) return JSON.stringify({oauthAccount: {emailAddress: 'x'}}); throw new Error('ENOENT'); }};
  registerSetupHandlers({storage, ipcMain: {handle: (name, fn) => handlers.set(name, fn)}, handleImportant: () => {}, toWindow: () => {}, track: (event, props) => events.push([event, props]),
    dialog: {showOpenDialog: async () => (pick ? {canceled: false, filePaths: [pick]} : {canceled: true, filePaths: []})}, getWindow: () => null, shell: {openExternal: url => opened.push(url)},
    plan: {pc: computer, platform: base.platform, runVersion: async () => version, verifyFns: {claude: async () => {}, openai: async () => {}}}});
  return {storage, events, opened, invoke: (name, ...args) => handlers.get(name)(null, ...args)};
}

const CASES = [
  ['Windows, only the Claude app', 'claude', WIN, {has: [CLAUDE_APP]}, 'app-only'],
  ['Windows, only the Claude app from the Store', 'claude', WIN, {has: [`${W}\\AppData\\Local\\Packages`], packages: {[`${W}\\AppData\\Local\\Packages`]: ['Claude_pzs8sxrjxfjjc']}}, 'app-only'],
  ['Windows, nothing', 'claude', WIN, {}, 'nothing'],
  ['Windows, Claude Code installed, never checked (the chooser checks it next)', 'claude', WIN, {has: [CLAUDE_EXE]}, 'checking'],
  ['Windows, Claude Code installed, signed in', 'claude', WIN, {has: [CLAUDE_EXE], settings: {claudeCode: OK}}, 'ready'],
  ['Windows, Claude Code installed, signed out', 'claude', WIN, {has: [CLAUDE_EXE], settings: {claudeCode: {checkedAt: 'x', login: '', authenticated: false, failure: 'signed-out', error: RAW_ERROR}}}, 'sign-in'],
  ['Windows, Claude Code did not start', 'claude', WIN, {has: [CLAUDE_EXE], version: null, settings: {claudeCode: OK}}, 'broken'],
  ['Windows, Claude Code needs Git Bash (a real check said so)', 'claude', WIN, {has: [CLAUDE_EXE], settings: {claudeCode: {checkedAt: 'x', login: '', authenticated: false, failure: 'needs-git', error: RAW_ERROR}}}, 'needs-git'],
  ['Windows, the file chosen earlier is gone', 'claude', WIN, {settings: {claudeFile: 'D:\\Tools\\claude.exe'}}, 'elsewhere'],
  ['Windows, the check failed for another reason', 'claude', WIN, {has: [CLAUDE_EXE], settings: {claudeCode: {checkedAt: 'x', login: '', authenticated: false, failure: 'failed', error: RAW_ERROR}}}, 'check-failed'],
  ['Windows, the plan limit is reached', 'claude', WIN, {has: [CLAUDE_EXE], settings: {claudeCode: {...OK, failure: 'limit', error: RAW_ERROR}}}, 'limit'],
  ['Mac, only the Claude app', 'claude', MAC, {has: ['/Applications/Claude.app']}, 'app-only'],
  ['Mac, nothing', 'claude', MAC, {}, 'nothing'],
  ['Mac, Claude Code installed, signed in', 'claude', MAC, {has: ['/Users/ann/.local/bin/claude'], settings: {claudeCode: OK}}, 'ready'],
  ['Windows, only the ChatGPT app', 'openai', WIN, {has: [`${W}\\AppData\\Local\\Packages`], packages: {[`${W}\\AppData\\Local\\Packages`]: ['OpenAI.ChatGPT-Desktop_2p2nqsd0c76g0']}}, 'app-only'],
  ['Windows, nothing for ChatGPT', 'openai', WIN, {}, 'nothing'],
  ['Windows, Codex installed, signed out', 'openai', WIN, {has: [CODEX_EXE], settings: {codex: {checkedAt: 'x', login: '', authenticated: false, failure: 'signed-out', error: RAW_ERROR}}}, 'sign-in'],
  ['Windows, Codex ready', 'openai', WIN, {has: [CODEX_EXE], settings: {codex: OK}}, 'ready'],
  ['Mac, only the ChatGPT app', 'openai', MAC, {has: ['/Applications/ChatGPT.app']}, 'app-only'],
  ['Mac, Codex ready', 'openai', MAC, {has: ['/Users/ann/.local/bin/codex'], settings: {codex: OK}}, 'ready'],
];
const STATUS = {claude: 'claudeCodeStatus', openai: 'codexStatus'};

for (const [name, family, base, options, state] of CASES) {
  test(`${name}: state ${state}, one counted event, no raw text on the screen`, async t => {
    const {invoke, events} = app(t, base, options);
    const status = await invoke(STATUS[family]);
    assert.equal(status.state, state);
    assert.ok(STATES.includes(status.state));
    const drawn = guide(status.state, {family, platform: base.platform, inApp: true});
    const screen = [JSON.stringify({...status, path: undefined}), drawn.title, drawn.text, ...drawn.steps, ...drawn.actions.map(a => a.label)].join('\n');
    assert.doesNotMatch(screen, /ENOENT|exit code|spawn |Claude Code failed|\bat Object|y\.js/, 'a raw message reached the screen');
    assert.ok(!('error' in status), 'the status carries no raw error');
    await invoke(STATUS[family]);   // asked again (the window re-checks): still one event for this state
    assert.deepEqual(events, [['ai_setup_state', {family, state, os: base.platform}]]);
    assert.ok(EVENTS.includes('ai_setup_state'));
    assert.deepEqual(cleanProps(events[0][1]), {family, state, os: base.platform}, 'the analytics scrub keeps the event whole');
  });
}

test('every failure a check can return maps to a named state, in both families, with no raw text', async t => {
  for (const [family, key, file] of [['claude', 'claudeCode', CLAUDE_EXE], ['openai', 'codex', CODEX_EXE]]) {
    for (const failure of ['', ...FAILURES]) {
      const {invoke} = app(t, WIN, {has: [file], settings: {[key]: {checkedAt: 'x', login: '', authenticated: failure === 'limit', failure, error: RAW_ERROR}}});
      const status = await invoke(STATUS[family]);
      assert.ok(STATES.includes(status.state), `${family} ${failure || 'none'} -> ${status.state}`);
      assert.doesNotMatch(JSON.stringify(status), /ENOENT|exit code/);
    }
  }
});

test('the file picker: cancel does nothing; the chat app\'s file and a wrong name are refused; the real CLI is kept and found next time', async t => {
  const chat = `${CLAUDE_APP}\\claude.exe`, real = 'D:\\Tools\\claude.exe';
  assert.deepEqual(await app(t, WIN, {}).invoke('planChooseFile', 'claude'), {ok: false, reason: 'cancelled'});
  assert.deepEqual(await app(t, WIN, {pick: chat}).invoke('planChooseFile', 'claude'), {ok: false, reason: 'not-the-cli'});
  assert.deepEqual(await app(t, WIN, {pick: 'D:\\Tools\\notepad.exe'}).invoke('planChooseFile', 'claude'), {ok: false, reason: 'not-the-cli'});
  assert.deepEqual(await app(t, WIN, {pick: real, version: null}).invoke('planChooseFile', 'claude'), {ok: false, reason: 'did-not-start'});
  const kept = app(t, WIN, {pick: real, has: [real], settings: {claudeCode: OK}});
  const picked = await kept.invoke('planChooseFile', 'claude');
  assert.equal(picked.ok, true);
  assert.equal(picked.status.path, real);
  assert.equal(kept.storage.settings().claudeFile, real);
  assert.equal((await kept.invoke('claudeCodeStatus')).state, 'checking', 'a new file is a new CLI: the last check said nothing about it, so it is checked again');
});

test('"Copy details for support" holds where we looked and the last raw message; the install page opens only an official address', async t => {
  const {invoke, opened} = app(t, WIN, {has: [CLAUDE_APP], settings: {claudeCode: {checkedAt: 'x', login: '', failure: 'failed', error: RAW_ERROR}}});
  const text = await invoke('planSupportDetails', 'claude');
  assert.match(text, /looked in: .*\.local\\bin/);
  assert.match(text, /npm/);
  assert.match(text, /chat app found: yes/);
  assert.match(text, /ENOENT/);
  assert.equal(await invoke('planOpenGuide', 'claude'), true);
  assert.equal(await invoke('planOpenGuide', 'git'), true);
  assert.equal(await invoke('planOpenGuide', 'https://evil.example/'), false);
  assert.deepEqual(opened, ['https://code.claude.com/docs/en/setup', 'https://git-scm.com/downloads/win']);
});
