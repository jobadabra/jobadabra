// Actual setup callbacks localize authored failures while preserving diagnostic errors, secrets, OAuth state and Free AI writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {test, beforeEach, afterEach} from 'node:test';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import {setLocale, SUPPORTED_LOCALES, t as translate} from '../../../i18n/index.js';
import {displayText} from '../../../i18n/display-values.js';
import {cleanSecret} from '../../../lib/secrets.js';
import * as free from '../../../lib/ai-free.js';
import {setSiteOff} from '../../../lib/recipes.js';
import * as oauth from '../../../lib/notion-oauth.js';
import {receive, fail} from '../../../lib/oauth-handoff.js';
import {registerSetupHandlers} from '../../../lib/setup-handlers.js';

const text = (key, vars) => translate(`setupNotice.${key}`, vars);
const forbidden = [];
let originalFetch;
beforeEach(t => {
  const blocked = name => () => {forbidden.push([name]); throw new Error('unexpected protected call');};
  for (const name of ['execFile', 'execFileSync', 'spawn', 'spawnSync']) t.mock.method(childProcess, name, blocked('process/Keychain/live-app'));
  syncBuiltinESMExports();
  t.mock.method(Anthropic.Messages.prototype, 'create', blocked('Anthropic generation'));
  t.mock.method(Anthropic.Messages.prototype, 'stream', blocked('Anthropic stream'));
  t.mock.method(OpenAI.Responses.prototype, 'create', blocked('OpenAI generation'));
  originalFetch = globalThis.fetch; forbidden.length = 0;
  globalThis.fetch = (...args) => {forbidden.push(['network', args.length]); throw new Error('unexpected network');};
});
afterEach(t => {
  t.mock.restoreAll(); syncBuiltinESMExports();
  globalThis.fetch = originalFetch; setLocale('en'); oauth.cancel();
  assert.deepEqual(forbidden, [], 'forbidden calls are checked outside production catches');
});
function memory(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-notices-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  let settings = {telemetryId: 'fictional-setup-install'};
  const writes = [], secrets = new Map(), secretWrites = [];
  return {dir, writes, secretWrites, settings: () => settings, saveSettings: patch => {writes.push(patch); settings = {...settings, ...patch};},
    path: name => path.join(dir, name), readText: () => '', secret: name => secrets.get(name) || '',
    setSecret: (name, value) => {secretWrites.push(name); secrets.set(name, value);}, secretsPresent: () => Object.fromEntries([...secrets].map(([name]) => [name, true]))};
}
function setup(t) {
  const storage = memory(t), handlers = new Map(), browser = [], notionCalls = [];
  const no = name => () => {forbidden.push([name]); throw new Error('unexpected dependency');};
  registerSetupHandlers({DEMO: true, storage, ipcMain: {handle: (name, fn) => handlers.set(name, fn)},
    handleImportant: (name, label, fn) => handlers.set(name, fn), toWindow: no('window'),
    shell: {openExternal: url => browser.push(url)}, connectNotion: async (...args) => {notionCalls.push(args); return {ok: true};}, getWindow: () => null, setNotionFrom: () => {},
    trackSetup: no('tracking'), dialog: {showOpenDialog: no('file dialog')}, keepLook: no('CV'), syncCv: no('sync')});
  return {storage, browser, notionCalls, call: (name, ...args) => handlers.get(name)(null, ...args)};
}

test('bad-character errors stay canonical outside UI, localize once at every setup cleaner boundary, and never reveal a full key', async t => {
  const {call, storage} = setup(t), pasted = 'fictional-\u0430-key-tail';
  const clean = cleanSecret(pasted), canonical = clean.error, serialized = JSON.stringify(clean);
  assert.equal(canonical, 'Character 11 ("а", U+0430) can\'t be part of a key: it looks like a letter from another keyboard layout or text editor. Copy the key again with its copy button and paste it here.');
  for (const locale of SUPPORTED_LOCALES) {
    setLocale(locale);
    assert.equal(clean.error, canonical); assert.equal(JSON.stringify(clean), serialized);
    const expected = locale === 'en' ? canonical : text('badCharacter', {position: 11, char: 'а', code: 'U+0430'});
    assert.equal(displayText(clean, canonical), expected);
    for (const name of ['checkOpenAI', 'checkAnthropic', 'notionConnect']) {
      const result = await call(name, pasted);
      assert.deepEqual(result, {ok: false, error: expected});
      assert.ok(!JSON.stringify(result).includes(pasted), 'a full pasted key is never returned');
    }
    assert.throws(() => call('saveSecret', 'OPENAI_API_KEY', pasted), error => error.message === expected && !error.message.includes(pasted));
  }
  assert.deepEqual(storage.writes, []); assert.deepEqual(storage.secretWrites, []);
});

test('actual setup validators use fake SDK models only; 401 copy follows invocation locale while provider errors and success remain exact', async t => {
  const {call, storage} = setup(t), sdkCalls = [];
  let outcome = 'reject';
  const fake = engine => async function (...args) {sdkCalls.push({engine, args}); if (outcome !== 'success') throw Object.assign(new Error(outcome === 'reject' ? 'fictional rejection' : 'Fictional provider {error} this Mac Keychain ⌘K'), {status: outcome === 'reject' ? 401 : 400}); return {data: []};};
  t.mock.method(Anthropic.Models.prototype, 'list', fake('anthropic'));
  t.mock.method(OpenAI.Models.prototype, 'list', fake('openai'));
  for (const locale of SUPPORTED_LOCALES) {
    setLocale(locale); outcome = 'reject';
    assert.deepEqual(await call('checkOpenAI', 'fictional-valid-ascii'), {ok: false, error: text('openaiRejected')});
    assert.deepEqual(await call('checkAnthropic', 'fictional-valid-ascii'), {ok: false, error: text('anthropicRejected')});
    outcome = 'provider';
    for (const name of ['checkOpenAI', 'checkAnthropic']) assert.deepEqual(await call(name, 'fictional-valid-ascii'), {ok: false, error: 'Fictional provider {error} this Mac Keychain ⌘K'});
    outcome = 'success';
    for (const name of ['checkOpenAI', 'checkAnthropic']) assert.deepEqual(await call(name, 'fictional-valid-ascii'), {ok: true});
  }
  assert.equal(sdkCalls.length, 42);
  assert.ok(sdkCalls.filter(c => c.engine === 'anthropic').every(c => JSON.stringify(c.args) === '[{"limit":1}]'));
  assert.ok(sdkCalls.filter(c => c.engine === 'openai').every(c => c.args.length === 0));
  assert.deepEqual(storage.writes, []); assert.deepEqual(storage.secretWrites, []);
  assert.deepEqual(await call('saveSecret', 'OPENAI_API_KEY', ' \nfictional-valid-ascii\u200B '), {OPENAI_API_KEY: true});
  assert.ok(storage.secret('OPENAI_API_KEY') === 'fictional-valid-ascii');
  assert.deepEqual(storage.secretWrites, ['OPENAI_API_KEY']);
});

test('Free AI canonical failures have private invocation-time presentation without changing successful token or credit writes', async t => {
  const storage = memory(t), env = {}, calls = [];
  const failed = await free.start(storage, env, async (url, init) => {calls.push([url, JSON.parse(init.body)]); return Response.json({ok: false}, {status: 503});});
  assert.deepEqual(failed, {ok: false, error: 'Free AI could not start just now. Check your connection and try again.'});
  assert.deepEqual(Reflect.ownKeys(failed), ['ok', 'error']);
  for (const locale of SUPPORTED_LOCALES) {setLocale(locale); assert.equal(displayText(failed, failed.error), locale === 'en' ? failed.error : text('freeStartFailed'));}
  assert.deepEqual(storage.writes, []); assert.deepEqual(storage.secretWrites, []); assert.deepEqual(env, {});
  assert.deepEqual(calls, [['https://www.jobadabra.top/api/install-token', {install: 'fictional-setup-install', purpose: 'ai'}]]);
  const success = await free.start(storage, env, async () => Response.json({token: 'fictional-free-token'}));
  assert.deepEqual(success, {ok: true});
  assert.ok(storage.secret('ANTHROPIC_API_KEY') === 'JPF1.fictional-setup-install.fictional-free-token');
  assert.deepEqual(storage.secretWrites, ['ANTHROPIC_API_KEY']);
  assert.deepEqual(storage.writes, [{siteTokens: {ai: {install: 'fictional-setup-install', value: 'fictional-free-token'}}}, {aiFree: true, aiTrial: false, aiEngine: 'api'}]);
  assert.deepEqual(env, {ANTHROPIC_BASE_URL: free.FREE_BASE});
});

test('Free AI setup callback projects only failures and keeps registration, successful writes and nonregular refusal behavior', async t => {
  for (const locale of SUPPORTED_LOCALES) {
    const {call, storage} = setup(t), calls = [];
    globalThis.fetch = async (url, init) => {
      if (url !== 'https://www.jobadabra.top/api/install-token') {forbidden.push(['unexpected fake endpoint']); throw new Error('unexpected endpoint');}
      calls.push([url, JSON.parse(init.body)]); return Response.json({ok: false}, {status: 503});
    };
    setLocale(locale);
    const failed = await call('startFreeAi');
    const canonical = 'Free AI could not start just now. Check your connection and try again.';
    assert.deepEqual(failed, {ok: false, error: locale === 'en' ? canonical : text('freeStartFailed')});
    assert.deepEqual(storage.writes, []); assert.deepEqual(storage.secretWrites, []);
    assert.equal(calls.length, 1);
    setSiteOff('fictional nonregular install');
    try {
      const refused = await call('startFreeAi');
      assert.deepEqual(refused, {ok: false, error: locale === 'en' ? 'This is not a regular install, so Free AI is not asked.' : text('freeNotRegular')});
      assert.equal(calls.length, 1, 'nonregular installation never requests a token');
    } finally { setSiteOff(''); }
  }
});

test('setup catalogs keep all six translated diagnostic maps and the two UI-only English instructions with exact variables', async () => {
  const en = (await import('../../../i18n/catalogs/setup-notices/en.js')).default;
  const keys = ['anthropicRejected', 'badCharacter', 'freeNotRegular', 'freeStartFailed', 'notionMissingToken', 'notionTimeout', 'openaiRejected'];
  assert.deepEqual(Object.keys(en).sort(), ['anthropicRejected', 'openaiRejected']);
  const parameters = value => [...new Set([...value.matchAll(/\{([a-zA-Z][\w]*)\}/g)].map(match => match[1]))].sort();
  for (const locale of SUPPORTED_LOCALES.filter(l => l !== 'en')) {
    const catalog = (await import(`../../../i18n/catalogs/setup-notices/${locale}.js`)).default;
    assert.deepEqual(Object.keys(catalog).sort(), keys);
    for (const key of keys) {
      assert.deepEqual(parameters(catalog[key]), key === 'badCharacter' ? ['char', 'code', 'position'] : []);
      assert.ok(catalog[key].length > 0);
      if (en[key]) assert.notEqual(catalog[key], en[key]);
    }
  }
});

test('Notion authored failures localize at the returned setup boundary while canonical results, cancellation and OAuth fields stay exact', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const canonicalTimeout = 'Notion didn\'t answer in 5 minutes. Try again, or use "Having trouble? Use a token instead" below.';
  const direct = oauth.connect(() => {}, {site: 'https://fictional.test', timeout: 5});
  t.mock.timers.tick(5);
  const timed = await direct;
  assert.deepEqual(timed, {ok: false, error: canonicalTimeout});
  assert.deepEqual(Reflect.ownKeys(timed), ['ok', 'error']);
  for (const locale of SUPPORTED_LOCALES) {
    setLocale(locale);
    assert.equal(displayText(timed, timed.error), locale === 'en' ? canonicalTimeout : text('notionTimeout'));
    const {call, browser, notionCalls, storage} = setup(t);
    const waiting = call('notionOAuth');
    assert.match(browser[0], /^https:\/\/www\.jobadabra\.top\/api\/notion\/start\?state=[A-Za-z0-9_-]{43}$/);
    t.mock.timers.tick(5 * 60 * 1000);
    assert.deepEqual(await waiting, {ok: false, error: locale === 'en' ? canonicalTimeout : text('notionTimeout')});
    const bare = call('notionOAuth');
    const state = new URL(browser.at(-1)).searchParams.get('state');
    assert.equal(receive('notion-connect', new URLSearchParams({state, workspace_name: 'Fictional {workspace} Keychain ⌘K'})), true);
    assert.deepEqual(await bare, {ok: false, error: locale === 'en' ? 'Notion did not send a token. Try again.' : text('notionMissingToken')});
    const raw = 'Fictional upstream {error} this Mac Keychain ⌘K';
    const refused = call('notionOAuth'); fail('notion-connect', raw);
    assert.deepEqual(await refused, {ok: false, error: raw});
    const cancelled = call('notionOAuth'); oauth.cancel();
    assert.deepEqual(await cancelled, {ok: false, error: 'Cancelled.'});
    const succeeded = call('notionOAuth'), successState = new URL(browser.at(-1)).searchParams.get('state');
    assert.equal(receive('notion-connect', new URLSearchParams({state: 'x'.repeat(43), access_token: 'fictional-token'})), false);
    assert.equal(receive('notion-connect', new URLSearchParams({state: successState, access_token: 'fictional-token', workspace_name: raw})), true);
    assert.deepEqual(await succeeded, {ok: true, workspace: raw});
    assert.equal(notionCalls.length, 1); assert.ok(notionCalls[0][0] === 'fictional-token');
    assert.deepEqual(notionCalls[0][1], {templateRoot: null});
    assert.deepEqual(storage.writes, []); assert.deepEqual(storage.secretWrites, []);
    assert.equal(receive('notion-connect', new URLSearchParams({state: successState})), false, 'accepted exactly once');
    const unopened = await oauth.connect(() => {throw new Error('fictional browser failure');});
    assert.deepEqual(unopened, {ok: false, error: 'Your browser could not be opened.'});
    assert.equal(displayText(unopened, unopened.error), locale === 'en' ? unopened.error : translate('linkedinNotice.browserOpenFailed'));
  }
});

test('reused LinkedIn browser-error catalog keeps seven-language keys and placeholders without duplicate setup copy', async () => {
  const en = (await import('../../../i18n/catalogs/linkedin-notices/en.js')).default;
  const keys = Object.keys(en).sort();
  const params = value => [...new Set([...JSON.stringify(value).matchAll(/\{([a-zA-Z][\w]*)\}/g)].map(match => match[1]))].sort();
  for (const locale of SUPPORTED_LOCALES) {
    const catalog = (await import(`../../../i18n/catalogs/linkedin-notices/${locale}.js`)).default;
    assert.deepEqual(Object.keys(catalog).sort(), keys);
    for (const key of keys) assert.deepEqual(params(catalog[key]), params(en[key]));
    const setup = (await import(`../../../i18n/catalogs/setup-notices/${locale}.js`)).default;
    assert.ok(!Object.hasOwn(setup, 'browserOpenFailed'));
  }
});
