// The AI chooser's Install, Sign in and Cancel buttons, played in the real renderer page (renderer/pages/ai-engine.js) on a tiny DOM with a FAKE window.pilot: what a person sees and what each press calls.
// Why (Gitar on #3018, 2 Nov 2026): the first versions only matched the page's source text; a lost Cancel click or a second concurrent run would have passed them.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

const body = install();
const calls = [], hold = {};
const status = (state, extra = {}) => ({family: 'claude', state, installed: !['nothing', 'app-only'].includes(state), path: '', version: null, authenticated: state === 'ready', checkedAt: null, desktopApp: state === 'app-only', login: '', ...extra});
let now = status('app-only');
globalThis.window.pilot = new Proxy({platform: 'win32',
  claudeCodeStatus: async () => now, codexStatus: async () => status('nothing', {family: 'openai'}), verifyClaudeCode: async () => { calls.push('verify'); return now; },
  planInstall: name => { calls.push(`install:${name}`); return new Promise(resolve => { hold.install = resolve; }); },
  planSignIn: family => { calls.push(`sign-in:${family}`); return new Promise(resolve => { hold.signIn = resolve; }); },
  planCancel: async () => { calls.push('cancel'); return true; }, planOpenGuide: async which => { calls.push(`open:${which}`); return true; },
  planSupportDetails: async () => 'details', planChooseFile: async () => ({ok: false, reason: 'cancelled'}), setAiEngine: async () => ({}), saveSettings: async () => ({})},
{get: (target, key) => target[key] ?? (async () => ({}))});
const document = globalThis.document;
for (const target of [globalThis, document]) { target.addEventListener ??= () => {}; target.removeEventListener ??= () => {}; }
const {shared} = await import('../renderer/pages/shared.js');
const {mountEngine} = await import('../renderer/pages/ai-engine.js');

const tick = () => new Promise(resolve => setImmediate(resolve));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };
const button = (box, action) => box.querySelector(`button[data-action="${action}"]`);
const guideState = box => box.querySelector('.engine-guide')?.dataset.state;

test('Install: a progress card with the seconds and Cancel; a second press starts nothing; Cancel calls planCancel; a failed install shows one sentence and the manual steps', async () => {
  shared.state = {settings: {aiEngine: 'cli'}, secrets: {}, ownSecrets: {}};
  const box = document.createElement('div');
  body.append(box);
  mountEngine(box, {context: 'settings'});
  await settle();
  assert.equal(guideState(box), 'app-only');
  button(box, 'install').click();
  await settle();
  assert.equal(guideState(box), 'running', 'the run card replaces the guide');
  assert.ok(box.querySelector('[data-seconds]'), 'the seconds');
  assert.equal(button(box, 'install'), null, 'no Install button while it runs');
  button(box, 'cancel').click();
  assert.deepEqual(calls.filter(call => call.startsWith('install') || call === 'cancel'), ['install:claude', 'cancel'], 'one install started, Cancel reached main');
  hold.install({ok: false, reason: 'cancelled', status: status('app-only')});
  await settle();
  assert.equal(guideState(box), 'app-only');
  assert.ok(!box.textContent.includes('did not finish'), 'cancelling is silent');
  button(box, 'install').click();
  await settle();
  hold.install({ok: false, reason: 'failed', status: status('app-only')});
  await settle();
  assert.match(box.textContent, /The install did not finish\. Try again, or install it by hand with the steps below\./);
  assert.equal(button(box, 'install').textContent, 'Open the install page', 'the manual button says what it does');
  button(box, 'install').click();
  await settle();
  assert.ok(calls.includes('open:claude'), 'and it opens the page, never the installer again');
  assert.equal(calls.filter(call => call === 'install:claude').length, 2);
  box.remove();
});

test('an installer that ends ok but leaves the program missing is a failure the person can read, not the same card in silence', async () => {
  shared.state = {settings: {aiEngine: 'cli'}, secrets: {}, ownSecrets: {}};
  now = status('app-only');
  const box = document.createElement('div');
  body.append(box);
  mountEngine(box, {context: 'settings'});
  await settle();
  button(box, 'install').click();
  await settle();
  hold.install({ok: true, reason: '', status: status('app-only')});
  await settle();
  assert.match(box.textContent, /did not finish/);
  assert.ok(box.querySelector('.engine-steps'), 'the manual steps are there');
  box.remove();
});

test('Sign in: runs once, shows its own card; after a failed install by hand, Sign in is still offered; its failure never says "install"', async () => {
  shared.state = {settings: {aiEngine: 'cli'}, secrets: {}, ownSecrets: {}};
  now = status('app-only');
  const box = document.createElement('div');
  body.append(box);
  mountEngine(box, {context: 'settings'});
  await settle();
  button(box, 'install').click();
  await settle();
  hold.install({ok: false, reason: 'failed', status: status('app-only')});
  await settle();
  now = status('sign-in', {login: 'signed-out'});   // the person installed it by hand; the files are read again
  const again = box.querySelector('[data-action="check"]');
  assert.ok(again, 'Check again is offered after a failed install');
  again.click();
  await settle();
  const signIn = button(box, 'sign-in');
  assert.ok(signIn, 'the Sign in button is offered (the manual flag ended with the install states)');
  signIn.click();
  await settle();
  assert.equal(guideState(box), 'running');
  hold.signIn({ok: false, reason: 'timeout', status: status('sign-in', {login: 'signed-out'})});
  await settle();
  assert.match(box.textContent, /Sign-in did not finish\. Press Sign in to try again\./);
  assert.doesNotMatch(box.textContent, /install did not finish/i);
  box.remove();
});
