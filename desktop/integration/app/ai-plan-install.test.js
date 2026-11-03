// The AI chooser's Install, Sign in and Cancel buttons, layer 2: the app's own handlers on a FAKE computer with FAKE installers (never a real installer, login, ~/.claude.json or network).
// Why (2 Nov 2026, owner, Windows testers): a person with only the chat app, or a CLI that is not signed in, is guided to a working setup from inside the app; a stuck or failed install is a state, never a raw error.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {EventEmitter} from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {INSTALLERS, SIGN_IN_ARGS, start} from '../../lib/plan-install.js';
import {registerSetupHandlers} from '../../lib/setup-handlers.js';
import {createStorage} from '../../lib/storage.js';
import {FAMILY, guide} from '../../renderer/ai-plan-guide.js';

const W = 'C:\\Users\\Ann';
const WIN = {platform: 'win32', env: {USERPROFILE: W, LOCALAPPDATA: `${W}\\AppData\\Local`, APPDATA: `${W}\\AppData\\Roaming`, ProgramFiles: 'C:\\Program Files', PATH: 'C:\\Windows\\system32'}, home: W};
const CLAUDE_EXE = `${W}\\.local\\bin\\claude.exe`, CLAUDE_APP = `${W}\\AppData\\Local\\AnthropicClaude`;

/** The handlers on a fake Windows computer. `fake(kind, options)` is the installer's stand-in: it may add files to `has` (what the installer would have put on the disk) and returns {done, cancel}. */
function app(t, {has = [], fake, verified = []} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-install-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const storage = createStorage(dir, {encrypt: value => value, decrypt: value => value});
  const handlers = new Map(), opened = [], started = [];
  registerSetupHandlers({storage, ipcMain: {handle: (name, fn) => handlers.set(name, fn)}, handleImportant: () => {}, toWindow: () => {}, track: () => {}, getWindow: () => null,
    dialog: {showOpenDialog: async () => ({canceled: true, filePaths: []})}, shell: {openExternal: url => opened.push(url)},
    plan: {pc: {...WIN, registry: () => [], exists: file => has.includes(file), list: () => [], read: () => { throw new Error('ENOENT'); }}, platform: 'win32', runVersion: async () => '2.1.7',
      verifyFns: {claude: async () => { verified.push('claude'); storage.saveSettings({claudeCode: {authenticated: true, login: 'signed-in', checkedAt: 'x'}}); }, openai: async () => {}},
      startFn: (kind, options) => { started.push([kind, options.binary || '']); return fake(kind, options, has); }}});
  return {storage, opened, started, verified, has, invoke: (name, ...args) => handlers.get(name)(null, ...args)};
}
const finished = (result, change = () => {}) => (kind, options, has) => { change(has); return {cancel() {}, done: Promise.resolve(result)}; };

test('Install on a PC with only the Claude app: the official installer runs, the new file is found, no text from the installer reaches the window', async t => {
  const pc = app(t, {has: [CLAUDE_APP], fake: finished({ok: true, reason: ''}, has => has.push(CLAUDE_EXE))});
  assert.equal((await pc.invoke('claudeCodeStatus')).state, 'app-only');
  const result = await pc.invoke('planInstall', 'claude');
  assert.deepEqual(pc.started, [['install:claude', '']]);
  assert.equal(result.ok, true);
  assert.equal(result.status.installed, true);
  assert.equal(result.status.state, 'checking', 'found now: the chooser verifies it next (sign-in or ready)');
  assert.deepEqual(Object.keys(result).sort(), ['ok', 'reason', 'status']);
});

test('a failed install, a missing installer and a hang are plain verdicts; the state is unchanged and the manual steps stay', async t => {
  for (const reason of ['failed', 'not-found', 'timeout']) {
    const pc = app(t, {has: [CLAUDE_APP], fake: finished({ok: false, reason})});
    const result = await pc.invoke('planInstall', 'claude');
    assert.equal(result.ok, false);
    assert.equal(result.reason, reason);
    assert.equal(result.status.state, 'app-only');
  }
  assert.ok(guide('app-only', {family: 'claude', platform: 'win32', inApp: false}).steps.length, 'without the in-app button the numbered steps carry the install');
});

test('Cancel ends the run once; a second Install while one runs is refused as busy; nothing else is started', async t => {
  let release, cancelled = 0;
  const hold = new Promise(resolve => { release = resolve; });
  const pc = app(t, {has: [CLAUDE_APP], fake: () => ({cancel: () => { cancelled++; release({ok: false, reason: 'cancelled'}); }, done: hold})});
  const first = pc.invoke('planInstall', 'claude');
  assert.equal((await pc.invoke('planInstall', 'openai')).reason, 'busy');
  assert.equal(await pc.invoke('planCancel'), true);
  assert.equal((await first).reason, 'cancelled');
  assert.equal(cancelled, 1);
  assert.equal(pc.started.length, 1);
  assert.equal(await pc.invoke('planCancel'), false, 'nothing running: nothing to cancel');
});

test('Git for Windows: installed through winget; with no winget the official download page opens', async t => {
  const ok = app(t, {has: [CLAUDE_EXE], fake: finished({ok: true, reason: ''})});
  assert.equal((await ok.invoke('planInstall', 'git')).ok, true);
  assert.deepEqual(ok.started, [['install:git', '']]);
  const none = app(t, {has: [CLAUDE_EXE], fake: finished({ok: false, reason: 'not-found'})});
  assert.equal((await none.invoke('planInstall', 'git')).reason, 'opened-page');
  assert.deepEqual(none.opened, ['https://git-scm.com/downloads/win']);
});

test('Sign in runs the CLI the app found, then the CLI\'s own answer decides; with no CLI there is nothing to sign in to', async t => {
  const pc = app(t, {has: [CLAUDE_EXE], fake: finished({ok: true, reason: ''})});
  const result = await pc.invoke('planSignIn', 'claude');
  assert.deepEqual(pc.started, [['sign-in:claude', CLAUDE_EXE]]);
  assert.deepEqual(pc.verified, ['claude']);
  assert.equal(result.status.state, 'ready');
  const none = app(t, {fake: finished({ok: true, reason: ''})});
  assert.equal((await none.invoke('planSignIn', 'claude')).reason, 'unsupported');
  assert.deepEqual(none.started, []);
  const cancelled = app(t, {has: [CLAUDE_EXE], fake: finished({ok: false, reason: 'cancelled'})});
  await cancelled.invoke('planSignIn', 'claude');
  assert.deepEqual(cancelled.verified, [], 'a cancelled sign-in checks nothing');
});

test('an unknown kind runs nothing, and the end-to-end run can never start a real installer or login', async t => {
  const pc = app(t, {fake: finished({ok: true, reason: ''})});
  assert.equal((await pc.invoke('planInstall', '../../etc')).reason, 'unsupported');
  assert.deepEqual(pc.started, []);
  const before = process.env.JOBADABRA_E2E;
  process.env.JOBADABRA_E2E = '1';
  t.after(() => { if (before === undefined) delete process.env.JOBADABRA_E2E; else process.env.JOBADABRA_E2E = before; });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-install-e2e-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const handlers = new Map();
  registerSetupHandlers({storage: createStorage(dir, {encrypt: v => v, decrypt: v => v}), ipcMain: {handle: (name, fn) => handlers.set(name, fn)}, handleImportant: () => {}, toWindow: () => {}, track: () => {}, getWindow: () => null,
    dialog: {}, shell: {openExternal() {}}, plan: {pc: {...WIN, registry: () => [], exists: () => false, list: () => []}, platform: 'win32'}});
  assert.deepEqual((await handlers.get('planInstall')(null, 'claude')), {ok: false, reason: 'test', status: (await handlers.get('claudeCodeStatus')(null))});
});

// lib/plan-install.js on its own: the lines that run are the official ones the card shows, and a process is ended by Cancel and by the hang guard.
function fakeSpawn() {
  const calls = [];
  const spawnFn = (file, args, options) => {
    const child = Object.assign(new EventEmitter(), {kill() { child.killed = true; setImmediate(() => child.emit('close', null)); }});
    calls.push({file, args, options, child});
    return child;
  };
  return {calls, spawnFn};
}

test('the line that runs is the one the card shows (the official install line, per family and system), nothing else is in the command', () => {
  for (const family of ['claude', 'openai']) {
    for (const platform of ['win32', 'darwin']) {
      const [file, args] = INSTALLERS[family][platform], shown = FAMILY[family].command[platform];
      assert.match(args.join(' '), new RegExp(shown.match(/https:\/\/[^\s"]+/)[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${family} ${platform}: the run line has the address the card shows`);
      assert.ok(file && !/\$|`/.test(file));
    }
  }
  assert.deepEqual(Object.keys(INSTALLERS.git), ['win32']);
  assert.deepEqual(SIGN_IN_ARGS, {claude: ['auth', 'login'], openai: ['login']});
});

test('start: a clean exit is ok, any other is failed, a missing program is not-found, a system without an official line is unsupported', async () => {
  const exits = [[0, true, ''], [1, false, 'failed']];
  for (const [code, ok, reason] of exits) {
    const {calls, spawnFn} = fakeSpawn();
    const run = start('install:claude', {platform: 'win32', spawnFn, env: {ANTHROPIC_API_KEY: 'sk-ant-x', PATH: 'p'}});
    assert.equal(calls[0].file, 'powershell.exe');
    assert.equal(calls[0].options.env.ANTHROPIC_API_KEY, undefined, 'the app\'s own API key never reaches the installer');
    calls[0].child.emit('close', code);
    assert.deepEqual(await run.done, {ok, reason});
  }
  const gone = fakeSpawn(), missing = start('install:git', {platform: 'win32', spawnFn: gone.spawnFn});
  gone.calls[0].child.emit('error', Object.assign(new Error('x'), {code: 'ENOENT'}));
  assert.deepEqual(await missing.done, {ok: false, reason: 'not-found'});
  assert.deepEqual(await start('install:git', {platform: 'darwin', spawnFn: fakeSpawn().spawnFn}).done, {ok: false, reason: 'unsupported'});
  assert.deepEqual(await start('sign-in:claude', {platform: 'win32', spawnFn: fakeSpawn().spawnFn}).done, {ok: false, reason: 'unsupported'}, 'sign-in without a CLI file');
  assert.deepEqual(await start('install:../x', {platform: 'win32', spawnFn: fakeSpawn().spawnFn}).done, {ok: false, reason: 'unsupported'});
});

test('start: Cancel ends the process (cancelled); the hang guard ends a stuck one (timeout)', async () => {
  const a = fakeSpawn(), cancel = start('sign-in:openai', {platform: 'darwin', binary: '/usr/local/bin/codex', spawnFn: a.spawnFn});
  assert.deepEqual(a.calls[0].args, ['login']);
  cancel.cancel();
  assert.deepEqual(await cancel.done, {ok: false, reason: 'cancelled'});
  const b = fakeSpawn(), hang = start('install:openai', {platform: 'darwin', spawnFn: b.spawnFn, guardMs: 20});
  assert.deepEqual(await hang.done, {ok: false, reason: 'timeout'});
});

// Review of [cc] 2/2 (fresh /code-review, 2 Nov 2026): seven defects, each with its test.
test('the Mac installers fail when the download fails (curl | bash exits 0 on empty input without pipefail)', () => {
  for (const family of ['claude', 'openai']) assert.match(INSTALLERS[family].darwin[1][1], /^set -o pipefail; curl -fsSL https:\/\//, family);
  const broken = spawnSync('/bin/bash', ['-c', 'set -o pipefail; curl -fsSL http://127.0.0.1:1/x | bash'], {encoding: 'utf8'});
  assert.notEqual(broken.status, 0, 'a failed download is a failed run');
});

test('what a finished run says: an installer that ends ok but leaves the program missing is a failure; sign-in has its own sentence; quiet endings say nothing', async () => {
  const {runOutcome, INSTALL_STATES} = await import('../../renderer/ai-engine-view.js');
  assert.deepEqual(runOutcome('install', {ok: true}, 'checking'), {problem: '', manual: false, check: true});
  for (const state of ['nothing', 'app-only', 'broken', 'elsewhere']) {
    const out = runOutcome('install', {ok: true, reason: ''}, state);
    assert.equal(out.manual, true, `ok but ${state}: the manual steps`);
    assert.match(out.problem, /did not finish/);
  }
  assert.equal(runOutcome('install', {ok: false, reason: 'not-found'}, 'app-only').problem, 'The install did not finish. Install it by hand with the steps below.');
  assert.deepEqual(runOutcome('install-git', {ok: true}, 'needs-git'), {problem: '', manual: false, check: true}, 'Git added: the CLI is checked again (the saved failure is old)');
  assert.equal(runOutcome('install-git', {ok: false, reason: 'opened-page'}, 'needs-git').manual, true);
  for (const reason of ['failed', 'timeout', 'not-found', 'unsupported']) {
    const out = runOutcome('sign-in', {ok: false, reason}, 'sign-in');
    assert.equal(out.problem, 'Sign-in did not finish. Press Sign in to try again.', `${reason}: never install wording`);
    assert.equal(out.manual, false);
  }
  for (const reason of ['cancelled', 'test', 'busy']) assert.deepEqual(runOutcome('install', {ok: false, reason}, 'app-only'), {problem: '', manual: false, check: false});
  assert.ok(INSTALL_STATES.includes('needs-git') && !INSTALL_STATES.includes('sign-in'));
});

test('a refused sign-in family, a smoke run and a throwing installer never leave the app busy or start a real process', async t => {
  const pc = app(t, {has: [CLAUDE_EXE], fake: finished({ok: true, reason: ''})});
  assert.equal((await pc.invoke('planSignIn', 'constructor')).reason, 'unsupported');
  const throwing = app(t, {has: [CLAUDE_APP], fake: () => { throw new Error('fake spawn failed'); }});
  assert.equal((await throwing.invoke('planInstall', 'claude')).reason, 'failed');
  assert.equal((await throwing.invoke('planInstall', 'claude')).reason, 'failed', 'not stuck busy');
  const before = process.env.JOBADABRA_SMOKE;
  process.env.JOBADABRA_SMOKE = '1';
  t.after(() => { if (before === undefined) delete process.env.JOBADABRA_SMOKE; else process.env.JOBADABRA_SMOKE = before; });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-install-smoke-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const handlers = new Map();
  registerSetupHandlers({storage: createStorage(dir, {encrypt: v => v, decrypt: v => v}), ipcMain: {handle: (name, fn) => handlers.set(name, fn)}, handleImportant: () => {}, toWindow: () => {}, track: () => {}, getWindow: () => null,
    dialog: {}, shell: {openExternal() {}}, plan: {pc: {...WIN, registry: () => [], exists: () => false, list: () => []}, platform: 'win32'}});
  assert.equal((await handlers.get('planInstall')(null, 'claude')).reason, 'test');
});

test('the real-runner job stages the shared app code before it imports the app\'s modules (the window\'s buttons are played in test/unit/renderer/ai-engine-run.test.js)', () => {
  const workflow = fs.readFileSync(new URL('../../../.github/workflows/fresh-install-smoke.yml', import.meta.url), 'utf8');
  const job = workflow.slice(workflow.indexOf('  ai-setup:'));
  assert.ok(job.indexOf('scripts/stage.mjs --files-only') > 0 && job.indexOf('scripts/stage.mjs --files-only') < job.indexOf('scripts/plan-machine.mjs'), 'desktop/shared is git-ignored: stage it first');
  assert.match(job, /permissions:\n      contents: read/);
});
