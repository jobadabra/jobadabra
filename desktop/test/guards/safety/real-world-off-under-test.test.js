// Guard: safety — under `node --test` the owner's real app (port 47111), real Chrome and real tabs are off. 7 Nov 2026, two escapes in ten minutes: a test sent fake check-ins to the owner's app
// (it imported lib/server-env.js before setting its port) and then opened 3 tabs in the owner's Chrome (the applyOne handler called lib/apply.js directly, so the test's fake runner never ran).
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {test} from 'node:test';
import {guarded, underTest} from '../../../lib/real-world.js';
import {openBrowser} from '../../../lib/apply.js';
import {openInChrome} from '../../../lib/extension-install.js';
import {registerApplyHandlers} from '../../../lib/apply-handlers.js';

const here = path.resolve(import.meta.dirname, '../../..');

test('a guarded launcher throws under a test, runs outside one, and never touches a fake handed in', () => {
  assert.equal(underTest({NODE_TEST_CONTEXT: 'child-v8'}), true);
  assert.equal(underTest({}), false, 'a person\'s app has no such variable');
  const ran = [];
  const launch = (...args) => { ran.push(args); return 'ran'; };
  assert.throws(() => guarded(launch, 'open a form tab', {NODE_TEST_CONTEXT: '1'})('x'), /open a form tab: refused under a test/);
  assert.deepEqual(ran, [], 'the real launcher did not run');
  assert.equal(guarded(launch, 'open a form tab', {})('y'), 'ran');
  assert.throws(() => openBrowser('open', ['-a', 'Google Chrome', 'https://jobs.example.test/a']), /refused under a test/, 'apply.js\'s default launcher');
});

test('Chrome\'s page opener, left to its default, is refused under a test', async () => {
  await assert.rejects(async () => openInChrome('chrome://extensions', {platform: 'darwin', exists: () => true}), /refused under a test/);
});

// The incident: the handler called the imported module, so the injected runner was never used. Every runner here is a fake that records its call.
test('the applyOne handler uses the injected runner, never the module behind it', async () => {
  const calls = [], handles = new Map();
  registerApplyHandlers({DEMO: false, extensionGate: () => null, allowanceBlock: () => null, needsNotion: () => null, claudeConsent: async () => true, staleNote: () => '',
    applyRunner: {start: async () => { calls.push('start'); return {ok: true}; }, applyOne: async () => { calls.push('applyOne'); return {ok: true, session: {id: 's1'}}; }, openOne: () => { calls.push('openOne'); return {ok: true}; }},
    ipcMain: {handle: (name, fn) => handles.set(name, fn)}, log: () => {}, here, toWindow: () => {}, track: () => {}, prepareKitFor: async () => ({}), startClaude: () => ({}),
    getRecipeReporter: () => null, cloud: {}, storage: {settings: () => ({apply: {mode: 'fill', chosenAt: 'c1'}})}});
  await handles.get('applyOne')({}, 'https://jobs.example.test/a', {});
  assert.deepEqual(calls, ['applyOne']);
});

// The first incident: server-env.js imported before the port was set loaded lib/server.js on 47111. A child process that looks like a `node --test` file plays that order.
const serverUrl = new URL('../../../lib/server.js', import.meta.url).href, envUrl = new URL('../../../lib/server-env.js', import.meta.url).href;
const portInChild = (extra = {}) => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
  await import(${JSON.stringify(envUrl)});
  const server = await import(${JSON.stringify(serverUrl)});
  console.log(JSON.stringify({port: server.PORT}));
  process.exit(0);
`], {encoding: 'utf8', env: {PATH: process.env.PATH, HOME: process.env.HOME, NODE_TEST_CONTEXT: 'child-v8', ...extra}, timeout: 30000}).trim().split('\n').pop());

test('a test with no port of its own gets a port nothing listens on, never the production 47111', () => {
  assert.equal(portInChild().port, 0);
});

test('a test that names its own port keeps it', () => {
  assert.equal(portInChild({JOBADABRA_PORT: '48999'}).port, 48999);
});
