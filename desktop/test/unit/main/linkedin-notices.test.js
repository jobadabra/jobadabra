// Real LinkedIn import callbacks localize authored copy without changing provider parsing, credential contracts or control flags.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test, beforeEach, afterEach} from 'node:test';
import {hostPlatform, pick} from '../../../i18n/platform.js';
import {SUPPORTED_LOCALES, setLocale, t} from '../../../i18n/index.js';
import {ACCOUNT, API, DOMAINS, SERVICE, VERSION, connect, fetchAll, fetchDomain, saveToken, toProfileCv} from '../../../lib/linkedin-import.js';
import {receive, fail} from '../../../lib/oauth-handoff.js';
import {registerLinkedinImportHandlers} from '../../../lib/linkedin-import-handlers.js';

const text = (key, vars) => t(`linkedinNotice.${key}`, vars);
const TOKEN = 'fictional-token {token}';
const NOW = new Date('2026-11-03T09:00:00Z');
const FIXTURE = JSON.parse(fs.readFileSync(new URL('../../fixtures/linkedin-snapshot.json', import.meta.url), 'utf8'));
let defaultFetch;
const liveCalls = [];
beforeEach(() => {
  defaultFetch = globalThis.fetch; liveCalls.length = 0;
  globalThis.fetch = (...args) => {liveCalls.push(args); throw new Error('unexpected default network request');};
});
afterEach(() => {
  globalThis.fetch = defaultFetch; setLocale('en');
  assert.deepEqual(liveCalls, [], 'default network tripwire is checked outside production catches');
});
const json = (body, status = 200) => Response.json(body, {status});

function memory() {
  let settings = {linkedinImport: {connectedAt: NOW.toISOString(), expiresAt: '2026-12-03T09:00:00.000Z'}};
  const writes = [];
  return {writes, settings: () => settings, saveSettings: patch => {writes.push(patch); settings = {...settings, ...patch};}};
}

test('key failure and authored refusals localize at invocation while request and kind contracts stay exact', async () => {
  const kinds = {401: 'unauthorized', 403: 'unauthorized', 429: 'rate', 426: 'version', 503: 'error'};
  const keys = {401: 'unauthorized', 403: 'unauthorized', 429: 'rate', 426: 'version', 503: 'http'};
  for (const locale of SUPPORTED_LOCALES) {
    setLocale(locale);
    const storage = memory(), keysWritten = [];
    const failed = saveToken(storage, {token: TOKEN}, {now: NOW, keychain: {write: (...args) => {keysWritten.push(args); return false;}}});
    assert.deepEqual(failed, {ok: false, error: text(pick('keySaveFailed', 'keySaveFailedWindows', hostPlatform()))});
    if (locale === 'de') assert.notEqual(failed.error, 'The Keychain would not keep the LinkedIn key, so nothing was imported.');
    assert.throws(() => toProfileCv({'Positions.csv': []}), error => error.message === text('noPositions'));
    assert.deepEqual(keysWritten, [[SERVICE, TOKEN, {account: ACCOUNT, label: 'Jobadabra: LinkedIn import'}]]); assert.deepEqual(storage.writes, []);
    for (const [code, kind] of Object.entries(kinds)) {
      const calls = [], raw = 'Fictional {message} Keychain ⌘K';
      const result = await fetchDomain(TOKEN, 'PROFILE', {fetcher: async (url, options) => {calls.push([url, options]); return json({message: raw}, Number(code));}});
      assert.deepEqual(result, {ok: false, kind, error: text(keys[code], {status: Number(code)})});
      assert.equal(calls.length, 1, 'a refusal is not retried');
      assert.equal(calls[0][0], `${API}/rest/memberSnapshotData?q=criteria&domain=PROFILE`);
      assert.deepEqual(calls[0][1].headers, {'Linkedin-Version': VERSION, Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json'});
      assert.ok(calls[0][1].signal instanceof AbortSignal);
    }
    assert.deepEqual(await fetchDomain(TOKEN, 'PROFILE', {fetcher: async () => {throw new Error('Fictional {error}');}}), {ok: false, kind: 'error', error: text('network')});
  }
});

test('failed saves name the Windows credential store in every locale without exposing the key', () => {
  const previousWindow = globalThis.window;
  try {
    globalThis.window = {pilot: {platform: 'win32'}};
    for (const locale of SUPPORTED_LOCALES) {
      setLocale(locale);
      const storage = memory(), calls = [];
      const result = saveToken(storage, {token: TOKEN}, {keychain: {write: (...args) => {calls.push(args); return false;}}});
      assert.deepEqual(result, {ok: false, error: text('keySaveFailedWindows')});
      assert.match(result.error, /Windows/);
      assert.doesNotMatch(result.error, /Keychain|Schlüsselbund|Trousseau|Portachiavi|Llavero|Portchei|Связка ключей/i);
      assert.ok(!JSON.stringify(result).includes(TOKEN), 'the failed-save response never exposes the key');
      assert.deepEqual(calls, [[SERVICE, TOKEN, {account: ACCOUNT, label: 'Jobadabra: LinkedIn import'}]]);
      assert.deepEqual(storage.writes, []);
    }
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('raw provider message/error fields keep their canonical No data found meaning and page-ending behavior', async () => {
  for (const locale of SUPPORTED_LOCALES) {
    setLocale(locale);
    for (const field of ['message', 'error_description', 'error']) {
      const raw = 'No data found for Fictional {message} Keychain ⌘K';
      assert.deepEqual(await fetchDomain(TOKEN, 'SKILLS', {fetcher: async () => json({[field]: raw}, 404)}), {ok: false, kind: 'pending', error: text('pending')});
    }
    let calls = 0;
    const row = {Name: 'Fictional {name} this Mac Keychain ⌘K'};
    const got = await fetchDomain(TOKEN, 'SKILLS', {fetcher: async () => ++calls === 1
      ? json({elements: [{snapshotDomain: 'SKILLS', snapshotData: [row]}], paging: {links: [{rel: 'next', href: '/rest/memberSnapshotData?q=criteria&domain=SKILLS&start=1'}]}})
      : json({message: 'No data found for this memberId'}, 404)});
    assert.deepEqual(got, {ok: true, rows: [row]}); assert.equal(calls, 2);
    const slept = [], domains = [];
    const all = await fetchAll(TOKEN, {fetcher: async url => {domains.push(new URL(url).searchParams.get('domain')); return json({}, 429);}, sleep: async ms => {slept.push(ms);}});
    assert.deepEqual(all, {tables: {}, status: {PROFILE: 'rate'}, stopped: 'rate', error: text('rate')});
    assert.deepEqual(domains, ['PROFILE']); assert.deepEqual(slept, []);
  }
});

test('consent error copy follows invocation locale, retaining state fields and raw upstream token values', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  for (const locale of SUPPORTED_LOCALES) {
    setLocale(locale);
    assert.deepEqual(await connect(() => {throw new Error('Fictional browser error');}, {site: 'https://fictional.example.test'}), {ok: false, error: text('browserOpenFailed')});
    const raw = 'Fictional {error} this Mac Keychain ⌘K';
    assert.deepEqual(await connect(() => fail('linkedin-import', raw), {site: 'https://fictional.example.test'}), {ok: false, error: raw});
    const missing = connect(url => {receive('linkedin-import', new URLSearchParams({state: new URL(url).searchParams.get('state')}));}, {site: 'https://fictional.example.test'});
    assert.deepEqual(await missing, {ok: false, error: text('missingKey')});
    const opened = [];
    const good = connect(url => {opened.push(url); receive('linkedin-import', new URLSearchParams({state: new URL(url).searchParams.get('state'), access_token: TOKEN, expires_in: '123'}));}, {site: 'https://fictional.example.test'});
    assert.deepEqual(await good, {ok: true, token: TOKEN, expiresIn: 123});
    assert.match(opened[0], /^https:\/\/fictional\.example\.test\/api\/linkedin-import\/start\?state=[A-Za-z0-9_-]{43}$/);
    const timeout = connect(() => {}, {site: 'https://fictional.example.test', timeout: 300000});
    t.mock.timers.tick(300000);
    assert.deepEqual(await timeout, {ok: false, error: text('consentTimeout')});
  }
});

test('actual handler preserves provider/profile fields, localized display wrappers and unchanged apply/cancel flags', async () => {
  const raw = 'Fictional {error} this Mac Keychain ⌘K <upstream>';
  for (const locale of SUPPORTED_LOCALES) {
    setLocale(locale);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linkedin-notices-'));
    const storage = memory(); storage.path = name => path.join(dir, name);
    const forbidden = [], trap = name => (...args) => {forbidden.push([name, args]); throw new Error('forbidden live dependency');};
    storage.secret = trap('secret');
    const handlers = {}, reports = [], saved = [], keyOps = [];
    let saveFails = true;
    const keychain = {read: (...args) => {keyOps.push(['read', ...args]); return TOKEN;}, write: trap('unexpected key write'), remove: trap('unexpected key remove')};
    registerLinkedinImportHandlers({DEMO: false, storage, ipcMain: {handle: (name, fn) => {handlers[name] = fn;}},
      deps: {keychain, now: NOW, sleep: trap('unexpected retry'), fetcher: async url => {
        const domain = new URL(url).searchParams.get('domain'), start = Number(new URL(url).searchParams.get('start') || 0);
        return FIXTURE[domain]?.[start] ? json(FIXTURE[domain][start]) : json({message: 'No data found for this memberId'}, 404);
      }}, openExternal: trap('browser'), sendStep: (channel, payload) => reports.push([channel, payload]), aiOf: () => ({}),
      readContact: async () => ({first_name: 'Anna'}), saveContact: async value => {saved.push(value); if (saveFails) throw new Error(raw);}});
    try {
      assert.deepEqual(await handlers.linkedinImportApply(null, []), {ok: false, error: text('nothingToAdd')});
      const imported = await handlers.linkedinImportRun(null, {update: true});
      assert.equal(imported.ok, true); assert.equal(imported.mainless, true);
      assert.deepEqual(Object.keys(imported.status), DOMAINS); assert.ok(Object.values(imported.status).every(value => value === 'ok'));
      assert.ok(imported.review.positions.some(row => row.label.includes('Acme')));
      const details = imported.review.details.find(row => row.field === 'postal_code'); assert.ok(details);
      assert.deepEqual(await handlers.linkedinImportApply(null, [details.id]), {ok: false, error: text('detailsSaveFailed', {error: raw})});
      assert.equal(saved[0].postal_code, '1010');
      saveFails = false;
      const applied = await handlers.linkedinImportApply(null, [details.id]);
      assert.deepEqual([applied.ok, applied.added, applied.positions, applied.details, applied.mainless], [true, 1, 0, 1, true]);
      assert.equal(applied.cv.name, 'Anna Rossi', 'the fixture profile name is never translated');
      assert.deepEqual(await handlers.linkedinImportCancel(), {ok: true});
      assert.deepEqual(storage.writes, []); assert.deepEqual(keyOps, [['read', SERVICE, {account: ACCOUNT}]]);
      assert.deepEqual(forbidden, [], 'tripwires are asserted outside production catches');
      assert.ok(!JSON.stringify(reports).includes(TOKEN));
      assert.deepEqual(reports.map(([, step]) => step.what), ['reading', ...DOMAINS.map(() => 'domain'), 'comparing']);
      fs.mkdirSync(path.join(dir, 'cv'), {recursive: true});
      fs.writeFileSync(path.join(dir, 'cv', 'cv.json'), JSON.stringify({jobs: [], skills: ''}));
      assert.deepEqual(await handlers.linkedinImportRun(null, {update: true}), {ok: false, error: text('chooseAi')});
      assert.deepEqual(forbidden, []); assert.deepEqual(storage.writes, []);
    } finally {fs.rmSync(dir, {recursive: true, force: true});}
  }
});

test('all seven catalogs keep identical keys and interpolation parameters', async () => {
  const english = (await import('../../../i18n/catalogs/linkedin-notices/en.js')).default;
  const params = value => [...value.matchAll(/\{([a-zA-Z][\w]*)\}/g)].map(match => match[1]).sort();
  for (const locale of SUPPORTED_LOCALES) {
    const messages = (await import(`../../../i18n/catalogs/linkedin-notices/${locale}.js`)).default;
    assert.deepEqual(Object.keys(messages).sort(), Object.keys(english).sort());
    for (const [key, value] of Object.entries(messages)) {assert.ok(value.trim()); assert.deepEqual(params(value), params(english[key])); if (locale !== 'en') assert.notEqual(value, english[key]);}
  }
});

test('display-only apply error follows a locale switch after handler registration without touching any dependency', async () => {
  const handlers = {}, forbidden = [];
  const trap = (...args) => {forbidden.push(args); throw new Error('unexpected dependency');};
  setLocale('en');
  registerLinkedinImportHandlers({DEMO: false, ipcMain: {handle: (name, fn) => {handlers[name] = fn;}},
    storage: {settings: trap, path: trap, secret: trap}, openExternal: trap, sendStep: trap, aiOf: trap, readContact: trap, saveContact: trap});
  for (const locale of SUPPORTED_LOCALES) {
    setLocale(locale);
    assert.deepEqual(await handlers.linkedinImportApply(null, []), {ok: false, error: text('nothingToAdd')});
  }
  assert.deepEqual(forbidden, []);
});
