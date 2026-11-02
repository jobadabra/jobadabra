// The one owner of "can the person's own AI plan run on this computer, and if not, what is the one next step" (lib/plan-readiness.js), played on FAKE computers:
// files and folders given as lists, no real PATH, no registry, no ~/.claude.json, no CLI started. Windows and Mac, the Claude family (Claude Code) and the OpenAI
// family (Codex). Why (2 Nov 2026, owner, a Windows tester who had only the Claude app): "How can we check all the scenarios".
import assert from 'node:assert/strict';
import path from 'node:path';
import {test} from 'node:test';
import {FAILURES, STATES, failureOf, facts, readiness} from '../lib/plan-readiness.js';
import * as apply from '../lib/apply.js';
import {codexBinary} from '../lib/ai/codex-cli.js';

const W = 'C:\\Users\\Ann';
const WIN = {platform: 'win32', env: {USERPROFILE: W, LOCALAPPDATA: `${W}\\AppData\\Local`, APPDATA: `${W}\\AppData\\Roaming`, ProgramFiles: 'C:\\Program Files', PATH: 'C:\\Windows\\system32'}, home: W};
const MAC = {platform: 'darwin', env: {HOME: '/Users/ann', PATH: '/usr/bin:/bin'}, home: '/Users/ann'};

/** A fake computer: `has` lists the files and folders that exist; `account` is what ~/.claude.json holds; `packages` the folders under a given folder. */
const pc = (base, {has = [], account = false, packages = {}} = {}) => ({...base, registry: () => [], exists: file => has.includes(file),
  list: dir => packages[dir] || [], read: () => { if (account) return JSON.stringify({oauthAccount: {emailAddress: 'x'}}); throw new Error('ENOENT'); }});
const state = (family, computer, settings = {}, ran) => readiness(facts(family, {...computer, settings, ran}));

const CLAUDE_EXE = `${W}\\.local\\bin\\claude.exe`, CODEX_EXE = `${W}\\.local\\bin\\codex.exe`;
const SIGNED = {claudeCode: {authenticated: true, checkedAt: '2026-11-02T10:00:00Z', login: 'signed-in'}};

test('Windows with only the Claude app (the owner\'s tester): app-only, not "nothing"', () => {
  const computer = pc(WIN, {has: [`${W}\\AppData\\Local\\AnthropicClaude`]});
  assert.equal(state('claude', computer), 'app-only');
  assert.equal(facts('claude', {...computer}).desktopApp, true);
});

test('Windows with the Claude app from the Store (a Claude_* package) is app-only too', () => {
  const folder = `${W}\\AppData\\Local\\Packages`;
  assert.equal(state('claude', pc(WIN, {has: [folder], packages: {[folder]: ['Microsoft.Edge_x', 'Claude_pzs8sxrjxfjjc']}})), 'app-only');
});

test('Windows with nothing from Anthropic: nothing', () => assert.equal(state('claude', pc(WIN)), 'nothing'));

test('a claude.exe inside the Claude app\'s own folder is the chat app, never Claude Code', () => {
  const inApp = `${W}\\AppData\\Local\\AnthropicClaude\\claude.exe`;
  const computer = pc({...WIN, env: {...WIN.env, PATH: `${W}\\AppData\\Local\\AnthropicClaude;C:\\Windows`}}, {has: [inApp, `${W}\\AppData\\Local\\AnthropicClaude`]});
  assert.equal(apply.claudeBinary(computer.env, computer.exists, 'win32', computer.registry), '');
  assert.equal(state('claude', computer), 'app-only');
});

test('Claude Code in ~/.local/bin: ready once signed in, sign-in until then, limit when the plan is used up', () => {
  const computer = pc(WIN, {has: [CLAUDE_EXE]});
  assert.equal(state('claude', computer, SIGNED), 'ready');
  assert.equal(state('claude', computer, {claudeCode: {authenticated: false, login: '', checkedAt: '2026-11-02T10:00:00Z', failure: 'signed-out'}}), 'sign-in');
  assert.equal(state('claude', computer, {claudeCode: {authenticated: true, login: '', checkedAt: '2026-11-02T10:00:00Z', failure: 'limit'}}), 'limit');
  assert.equal(state('claude', computer), 'checking', 'never checked: one real check decides, no guess from a file');
  assert.equal(state('claude', pc(WIN, {has: [CLAUDE_EXE], account: true})), 'checking', 'an account file on this computer decides nothing either');
  assert.equal(state('claude', pc(WIN, {has: [CLAUDE_EXE], account: false}), {claudeCode: {...SIGNED.claudeCode, login: 'signed-in'}}), 'ready', 'signed in per the CLI itself, no ~/.claude.json on this computer (Windows keeps the login elsewhere)');
});

test('Claude Code found but it did not start: broken (reinstall), with the Claude app also there', () => {
  assert.equal(state('claude', pc(WIN, {has: [CLAUDE_EXE, `${W}\\AppData\\Local\\AnthropicClaude`]}), SIGNED, false), 'broken');
});

test('Git for Windows is optional: a missing Git alone never blocks; the git-bash failure of a real check does', () => {
  assert.equal(state('claude', pc(WIN, {has: [CLAUDE_EXE]}), SIGNED), 'ready', 'no Git on this computer, still ready');
  assert.equal(state('claude', pc(WIN, {has: [CLAUDE_EXE]}), {claudeCode: {authenticated: false, login: '', checkedAt: 'x', failure: 'needs-git'}}), 'needs-git');
});

test('a failed check that is neither sign-in nor limit is check-failed, never a raw message', () => {
  assert.equal(state('claude', pc(WIN, {has: [CLAUDE_EXE]}), {claudeCode: {authenticated: false, login: '', checkedAt: 'x', failure: 'failed', error: 'Claude Code failed: ECONNRESET'}}), 'check-failed');
});

test('a file the person chose that is gone: elsewhere; a chosen file that exists is used', () => {
  const chosen = 'D:\\Tools\\claude.exe';
  assert.equal(state('claude', pc(WIN, {has: [`${W}\\AppData\\Local\\AnthropicClaude`]}), {claudeFile: chosen}), 'elsewhere');
  const computer = pc(WIN, {has: [chosen]});
  assert.equal(facts('claude', {...computer, settings: {claudeFile: chosen}}).path, chosen);
  assert.equal(state('claude', computer, {claudeFile: chosen, ...SIGNED}), 'ready');
});

test('Mac: the Claude app in /Applications or ~/Applications is app-only; Claude Code in ~/.local/bin is ready', () => {
  assert.equal(state('claude', pc(MAC, {has: ['/Applications/Claude.app']})), 'app-only');
  assert.equal(state('claude', pc(MAC, {has: ['/Users/ann/Applications/Claude.app']})), 'app-only');
  assert.equal(state('claude', pc(MAC)), 'nothing');
  assert.equal(state('claude', pc(MAC, {has: ['/Users/ann/.local/bin/claude']}), SIGNED), 'ready');
});

test('Codex, the same states: the ChatGPT app alone is app-only (Mac and Windows), nothing, sign-in, ready, limit', () => {
  const store = `${W}\\AppData\\Local\\Packages`;
  assert.equal(state('openai', pc(MAC, {has: ['/Applications/ChatGPT.app']})), 'app-only');
  assert.equal(state('openai', pc(WIN, {has: [store], packages: {[store]: ['OpenAI.ChatGPT-Desktop_2p2nqsd0c76g0']}})), 'app-only');
  assert.equal(state('openai', pc(WIN)), 'nothing');
  const codex = pc(WIN, {has: [CODEX_EXE]});
  assert.equal(state('openai', codex, {codex: {authenticated: true, login: '', checkedAt: 'x'}}), 'ready');
  assert.equal(state('openai', codex, {codex: {authenticated: false, login: '', checkedAt: 'x', failure: 'signed-out'}}), 'sign-in');
  assert.equal(state('openai', codex, {codex: {authenticated: true, login: '', checkedAt: 'x', failure: 'limit'}}), 'limit');
  assert.equal(state('openai', codex), 'checking', 'never checked');
  assert.equal(state('openai', pc(WIN, {has: [CODEX_EXE]}), {codex: {authenticated: false, login: '', checkedAt: 'x', failure: 'needs-git'}}), 'check-failed', 'Codex never needs Git: that failure is just a failed check');
});

test('Codex found in a chosen file', () => {
  const chosen = 'D:\\Tools\\codex.exe';
  assert.equal(codexBinary({PATH: ''}, file => file === chosen, 'win32', chosen), chosen);
});

test('Codex put by its official Windows installer is found without any PATH (the real-runner row "Windows · Codex", 2 Nov 2026: installed, then "nothing")', () => {
  const folder = 'C:\\Users\\runneradmin\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin';   // the folder the installer script names (install.ps1: Programs\\OpenAI\\Codex\\bin)
  const file = `${folder}\\codex.exe`;
  assert.equal(codexBinary({PATH: '', LOCALAPPDATA: 'C:\\Users\\runneradmin\\AppData\\Local', USERPROFILE: 'C:\\Users\\runneradmin'}, candidate => candidate === file, 'win32', ''), file);
});

test('every failure a check can return has one state, and every state has a name', () => {
  const computer = pc(WIN, {has: [CLAUDE_EXE]});
  for (const failure of FAILURES) {
    const found = readiness(facts('claude', {...computer, settings: {claudeCode: {authenticated: false, login: '', checkedAt: 'x', failure}}}));
    assert.ok(STATES.includes(found), `${failure} -> ${found}`);
  }
  assert.deepEqual([...new Set(['checking', 'ready', 'limit', 'sign-in', 'needs-git', 'app-only', 'nothing', 'elsewhere', 'broken', 'check-failed'])].sort(), [...STATES].sort());
});

test('failureOf maps what the CLIs say to one kind: sign-out, limit, git-bash, did not start, anything else', () => {
  assert.equal(failureOf({kind: 'signed-out', text: 'x'}), 'signed-out');
  assert.equal(failureOf({kind: 'limit', text: 'x'}), 'limit');
  assert.equal(failureOf({kind: 'failed', text: 'Claude Code on Windows requires git-bash (https://git-scm.com/downloads/win)'}), 'needs-git');
  assert.equal(failureOf({kind: 'missing', text: 'spawn ENOENT'}), 'did-not-start');
  assert.equal(failureOf({kind: 'timeout', text: 'did not answer within 90 s'}), 'failed');
  assert.equal(failureOf(null), '');
});

test('the facts read only what is given: a path is a string in the fake computer\'s own style', () => {
  const found = facts('claude', {...pc(WIN, {has: [CLAUDE_EXE]})});
  assert.equal(path.win32.basename(found.path), 'claude.exe');
});

test('a record saved before the CLI\'s own answer existed (no login key) is checked again, never trusted: it was the tester\'s "Not signed in" after a restart', () => {
  const computer = pc(WIN, {has: [CLAUDE_EXE]});
  assert.equal(state('claude', computer, {claudeCode: {installed: true, authenticated: false, checkedAt: '2026-10-30T10:00:00Z'}}), 'checking');
  assert.equal(state('openai', pc(WIN, {has: [CODEX_EXE]}), {codex: {authenticated: false, checkedAt: 'x'}}), 'checking');
});
