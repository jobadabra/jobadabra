// The macOS Keychain item that seals the saved tokens becomes "Jobadabra Safe Storage" and every token survives the move (fake keychain, fake safeStorage; never the real Keychain).
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {DATA_NAME, keepLegacyIdentity, LEGACY_NAME, userDataTime} from '../../../lib/app-identity.js';
import {readSafeStorage} from '../../../lib/keychain.js';
import {openV10, osKey, SEALED_BY, sealV10} from '../../../lib/keychain-migration.js';
import {adoptBackupKeys, exported} from '../../../lib/reset.js';
import {createStorage, safeStorageCrypto} from '../../../lib/storage.js';

const OLD = `${LEGACY_NAME} Safe Storage`, NEW = `${DATA_NAME} Safe Storage`;
const TOKENS = {NOTION_TOKEN: 'ntn_owner_token', ANTHROPIC_API_KEY: 'sk-ant-owner', EXTENSION_TOKEN: 'ext-123'};
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'keychain-migration-'));
const tick = () => new Promise(resolve => setImmediate(resolve));

// The Keychain: service -> password. The fake `security` serves it; the fake safeStorage reads/creates its item.
const fakeKeychain = () => ({items: new Map(), securityCalls: []});

// Electron fixes the item at the process's first seal or open, from app.name (electron_browser_main_parts.cc); `ignoreName` models "the name did not take".
function fakeElectron(keychain, {ignoreName = false, failEncryptAt = 0, deny = false} = {}) {
  const log = [];
  let ready, item = null, encrypts = 0;
  const app = {name: 'Jobadabra', paths: {}, setName(name) { app.name = name; log.push(`name:${name}`); }, getPath: kind => app.paths[kind], setPath(kind, value) { app.paths[kind] = value; }, whenReady: () => new Promise(resolve => { ready = resolve; })};
  const key = () => {
    item ??= ignoreName ? OLD : `${app.name} Safe Storage`;
    if (!keychain.items.has(item)) keychain.items.set(item, crypto.randomBytes(16).toString('base64'));
    return osKey(keychain.items.get(item));
  };
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: text => { encrypts++; if (failEncryptAt && encrypts === failEncryptAt) throw new Error('keychain went away'); return Buffer.from(sealV10(text, key()), 'base64'); },
    decryptString: buffer => openV10(buffer.toString('base64'), key()),
  };
  const exec = (command, args) => {
    keychain.securityCalls.push(args[args.indexOf('-s') + 1]);
    if (deny) throw Object.assign(new Error('User canceled the operation'), {status: 128});
    const password = keychain.items.get(args[args.indexOf('-s') + 1]);
    if (!password) throw Object.assign(new Error('could not be found'), {status: 44});
    return `${password}\n`;
  };
  return {app, log, safeStorage, exec, ready: async () => { ready(); await tick(); }, usedItem: () => item, encrypts: () => encrypts};
}

// A start of the app on the given Mac. -> {storage, app, ...}
async function start(appData, keychain, options = {}) {
  const electron = fakeElectron(keychain, options);
  electron.app.paths.appData = appData;
  const messages = [];
  const sealer = keepLegacyIdentity({app: electron.app, safeStorage: electron.safeStorage, platform: 'darwin', exec: electron.exec, log: text => messages.push(text), isFirstCopy: () => options.firstCopy !== false});
  options.beforeReady?.(electron.app.getPath('userData'));   // what main.js does between load and ready: reset.applyPending (a Reset or an Import)
  await electron.ready();
  const storage = createStorage(electron.app.getPath('userData'), safeStorageCrypto(sealer));
  return {...electron, storage, messages, dir: electron.app.getPath('userData')};
}

// What the build before this change did: the old app name at the first seal, tokens saved under it.
async function seedOldBuild(appData, keychain, tokens = TOKENS) {
  const dir = path.join(appData, DATA_NAME);
  const electron = fakeElectron(keychain);
  electron.app.paths.appData = appData;
  electron.app.paths.userData = dir;
  keepLegacyIdentity({app: electron.app, safeStorage: electron.safeStorage, userDataOverride: dir, platform: 'darwin'});
  await electron.ready();
  const storage = createStorage(dir, safeStorageCrypto(electron.safeStorage));
  for (const [name, value] of Object.entries(tokens)) storage.setSecret(name, value);
  assert.equal(electron.usedItem(), OLD);
  return dir;
}
const readAll = (storage, tokens = TOKENS) => Object.fromEntries(Object.keys(tokens).map(name => [name, storage.secret(name)]));

test('known answer: a value sealed by OpenSSL opens with the key made from the Keychain password, and sealing gives the same bytes', () => {
  // Made with python hashlib.pbkdf2_hmac('sha1', pw, b'saltysalt', 1003, 16) and `openssl enc -aes-128-cbc -K <key> -iv 2020…20`, independent of this code.
  const key = osKey('dGVzdC1wYXNzd29yZC0x'), blob = 'djEwrZiIG0Wq/R8tDhiOSOTXiiJM6ozHGLNl3+/c/xNGSE0=';
  assert.equal(key.toString('hex'), '8ad68bd346af3bdc5b3fa95e1e870704');
  assert.equal(openV10(blob, key), 'ntn_known_answer_token');
  assert.equal(sealV10('ntn_known_answer_token', key), blob);
  assert.throws(() => openV10(blob, osKey('another password')));
});

test('the update: every token of an install sealed under "Job Pilotto Safe Storage" reads back under "Jobadabra Safe Storage", the old item is untouched', async () => {
  const appData = tmp(), keychain = fakeKeychain();
  const dir = await seedOldBuild(appData, keychain);
  const oldPassword = keychain.items.get(OLD), before = fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8');
  const run = await start(appData, keychain);
  assert.deepEqual(readAll(run.storage), TOKENS);
  assert.equal(run.usedItem(), NEW);
  assert.equal(run.app.name, DATA_NAME);
  assert.deepEqual(keychain.securityCalls, [OLD], 'one read of the old item');
  assert.equal(keychain.items.get(OLD), oldPassword, 'the old item is kept as it was');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8'))[SEALED_BY], NEW);
  assert.equal(fs.readFileSync(path.join(dir, 'secrets.before-keychain-move.json'), 'utf8'), before, 'the old file is kept for a release');
  assert.match(run.messages.join('\n'), /3 saved values moved/);
  assert.ok(!run.messages.join('\n').includes('ntn_owner_token'), 'no value in a log');
  // A Mac whose keychain holds only the new item (what the person has once the old one is retired) still reads every token.
  const newOnly = fakeKeychain(); newOnly.items.set(NEW, keychain.items.get(NEW));
  assert.deepEqual(readAll((await start(appData, newOnly)).storage), TOKENS);
  assert.deepEqual(newOnly.securityCalls, []);
});

test('the second start does nothing: no read of the old item, nothing re-sealed', async () => {
  const appData = tmp(), keychain = fakeKeychain();
  await seedOldBuild(appData, keychain);
  const first = await start(appData, keychain);
  const text = fs.readFileSync(path.join(first.dir, 'secrets.json'), 'utf8');
  keychain.securityCalls.length = 0;
  const second = await start(appData, keychain);
  assert.deepEqual(readAll(second.storage), TOKENS);
  assert.deepEqual(keychain.securityCalls, []);
  assert.equal(second.encrypts(), 0);
  assert.equal(fs.readFileSync(path.join(second.dir, 'secrets.json'), 'utf8'), text);
});

test('Deny on the one prompt: the app runs on the old item exactly as before and asks again next start', async () => {
  const appData = tmp(), keychain = fakeKeychain();
  const dir = await seedOldBuild(appData, keychain);
  const before = fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8');
  const denied = await start(appData, keychain, {deny: true});
  assert.deepEqual(readAll(denied.storage), TOKENS, 'every token still works');
  assert.equal(denied.usedItem(), OLD);
  assert.equal(denied.app.name, DATA_NAME, 'the app still shows Jobadabra');
  assert.equal(fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8'), before);
  assert.ok(!keychain.items.has(NEW), 'no new item was made');
  assert.match(denied.messages.join('\n'), /move postponed/);
  const later = await start(appData, keychain);
  assert.deepEqual(readAll(later.storage), TOKENS);
  assert.equal(later.usedItem(), NEW);
});

// A failure after the process left the old item: nothing may be lost, the file is as it was, and the next start finishes the job.
const failures = {
  'a seal throws half way': () => ({options: {failEncryptAt: 2}}),
  'the new file cannot be saved': () => { const real = fs.renameSync; fs.renameSync = (from, to) => { if (String(to).endsWith('secrets.json')) throw Object.assign(new Error('disk full'), {code: 'ENOSPC'}); return real(from, to); }; return {options: {}, undo: () => { fs.renameSync = real; }}; },
  'the name did not take (still the old item)': () => ({options: {ignoreName: true}}),
};
for (const [title, inject] of Object.entries(failures)) {
  test(`${title}: every token stays readable under the old name and the next start moves them`, async () => {
    const appData = tmp(), keychain = fakeKeychain();
    const dir = await seedOldBuild(appData, keychain);
    const before = fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8');
    const failure = inject();
    let failed;
    try { failed = await start(appData, keychain, failure.options); } finally { failure.undo?.(); }
    assert.deepEqual(readAll(failed.storage), TOKENS);
    assert.equal(fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8'), before, 'the file is untouched');
    assert.match(failed.messages.join('\n'), /move failed/);
    failed.storage.setSecret('OPENAI_API_KEY', 'sk-saved-meanwhile');   // saved in the same run: sealed the old way
    // The build before this change (old name) opens everything, the token saved meanwhile included.
    const oldBuild = fakeElectron(keychain);
    const oldStorage = createStorage(dir, safeStorageCrypto(oldBuild.safeStorage));
    oldBuild.app.setName(LEGACY_NAME);
    assert.deepEqual(readAll(oldStorage, {...TOKENS, OPENAI_API_KEY: ''}), {...TOKENS, OPENAI_API_KEY: 'sk-saved-meanwhile'});
    const next = await start(appData, keychain);
    assert.deepEqual(readAll(next.storage, {...TOKENS, OPENAI_API_KEY: ''}), {...TOKENS, OPENAI_API_KEY: 'sk-saved-meanwhile'});
    assert.equal(next.usedItem(), NEW);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8'))[SEALED_BY], NEW);
  });
}

test('a fresh install starts on "Jobadabra Safe Storage" and never reads or makes the old item', async () => {
  const appData = tmp(), keychain = fakeKeychain();
  const first = await start(appData, keychain);
  assert.equal(userDataTime(first.dir), 0, 'the record alone is not a person\'s data');
  first.storage.setSecret('NOTION_TOKEN', 'ntn_new');
  assert.equal(first.usedItem(), NEW);
  assert.deepEqual([...keychain.items.keys()], [NEW]);
  assert.deepEqual(keychain.securityCalls, []);
  const second = await start(appData, keychain);   // its secrets are sealed and carry the record: not mistaken for an old install
  assert.equal(second.storage.secret('NOTION_TOKEN'), 'ntn_new');
  assert.deepEqual(keychain.securityCalls, []);
  assert.equal(userDataTime(second.dir) > 0, true);
});

test('a secrets file that is not JSON is left alone and the app runs as before', async () => {
  const appData = tmp(), keychain = fakeKeychain();
  fs.mkdirSync(path.join(appData, DATA_NAME), {recursive: true});
  fs.writeFileSync(path.join(appData, DATA_NAME, 'secrets.json'), '{broken');
  const run = await start(appData, keychain);
  assert.equal(run.usedItem(), OLD, 'sealed once under the old name, as before');
  assert.equal(fs.readFileSync(path.join(appData, DATA_NAME, 'secrets.json'), 'utf8'), '{broken');
  assert.deepEqual(keychain.securityCalls, []);
});

test('Windows and Linux have no named item to move: no read, no record, the earlier sequence', async () => {
  for (const platform of ['win32', 'linux']) {
    const appData = tmp(), keychain = fakeKeychain(), electron = fakeElectron(keychain);
    electron.app.paths.appData = appData;
    const sealer = keepLegacyIdentity({app: electron.app, safeStorage: electron.safeStorage, platform, exec: electron.exec});
    assert.equal(sealer, electron.safeStorage);
    await electron.ready();
    assert.deepEqual(electron.log, [`name:${LEGACY_NAME}`, `name:${DATA_NAME}`]);
    assert.deepEqual(keychain.securityCalls, []);
    assert.equal(fs.existsSync(path.join(appData, DATA_NAME, 'secrets.json')), false);
  }
});

// Review of 3 Nov 2026 (data loss): the plan must be read at ready, after a Reset or Import that ran between load and ready.
test('a Reset between load and ready: nothing old is written back, the new folder starts on the new item and keeps the tokens saved next', async () => {
  const appData = tmp(), keychain = fakeKeychain();
  const dir = await seedOldBuild(appData, keychain);
  const reset = await start(appData, keychain, {beforeReady: folder => fs.rmSync(path.join(folder, 'secrets.json'))});   // not yet moved, then a Reset
  assert.deepEqual(keychain.securityCalls, [], 'no read of the old item for an empty folder');
  assert.equal(fs.existsSync(path.join(dir, 'secrets.before-keychain-move.json')), false);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8'))), [SEALED_BY]);
  reset.storage.setSecret('NOTION_TOKEN', 'ntn_after_reset');
  const next = await start(appData, keychain);
  assert.equal(next.storage.secret('NOTION_TOKEN'), 'ntn_after_reset');
  assert.deepEqual(keychain.securityCalls, []);
});

test('a Reset of an install already moved: the next tokens are recorded as sealed by the new item, so the next start does not go back to the old one', async () => {
  const appData = tmp(), keychain = fakeKeychain();
  await seedOldBuild(appData, keychain);
  await start(appData, keychain);
  keychain.securityCalls.length = 0;
  const reset = await start(appData, keychain, {beforeReady: folder => fs.rmSync(path.join(folder, 'secrets.json'))});
  reset.storage.setSecret('NOTION_TOKEN', 'ntn_again');
  const next = await start(appData, keychain);
  assert.equal(next.storage.secret('NOTION_TOKEN'), 'ntn_again');
  assert.equal(next.usedItem(), NEW);
  assert.deepEqual(keychain.securityCalls, []);
});

test('an Import of an export sealed under the old item into a moved install is moved too', async () => {
  const appData = tmp(), keychain = fakeKeychain();
  const dir = await seedOldBuild(appData, keychain);
  const oldFile = fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8');
  await start(appData, keychain);
  keychain.securityCalls.length = 0;
  const imported = await start(appData, keychain, {beforeReady: folder => fs.writeFileSync(path.join(folder, 'secrets.json'), oldFile)});
  assert.deepEqual(readAll(imported.storage), TOKENS);
  assert.deepEqual(keychain.securityCalls, [OLD]);
});

test('a second copy of the app does not read the old item or touch the file', async () => {
  const appData = tmp(), keychain = fakeKeychain();
  const dir = await seedOldBuild(appData, keychain);
  const before = fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8');
  await start(appData, keychain, {firstCopy: false});
  assert.deepEqual(keychain.securityCalls, []);
  assert.equal(fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8'), before);
});

test('Chromium\'s empty-password fallback value opens; one value that opens with no key is left as it was and the others move', async () => {
  const empty = Buffer.from('d0d0ec9c7d77d43ac54187fa4818d17f', 'hex');
  assert.equal(openV10(sealV10('sealed-without-a-password', empty), osKey('whatever')), 'sealed-without-a-password');
  const appData = tmp(), keychain = fakeKeychain();
  const dir = await seedOldBuild(appData, keychain);
  const file = path.join(dir, 'secrets.json'), all = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify({...all, GITHUB_TOKEN: 'djEwbm90LWEtcmVhbC12YWx1ZQ=='}));   // sealed on another computer: opens nowhere
  const run = await start(appData, keychain);
  assert.deepEqual(readAll(run.storage), TOKENS);
  assert.equal(run.storage.secret('GITHUB_TOKEN'), '', 'unreadable before, unreadable after');
  assert.match(run.messages.join('\n'), /3 of 4 saved values moved/);
});

test('an export leaves the old-format backup out, and a backup holding only the record has no keys to adopt', async () => {
  const appData = tmp(), keychain = fakeKeychain();
  const dir = await seedOldBuild(appData, keychain);
  await start(appData, keychain);
  assert.ok(fs.existsSync(path.join(dir, 'secrets.before-keychain-move.json')));
  assert.equal(exported(dir).includes('secrets.before-keychain-move.json'), false);
  assert.equal(exported(dir).includes('secrets.json'), true);
  const run = await start(appData, keychain);
  const mine = JSON.parse(fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8')), notion = mine.NOTION_TOKEN;
  delete mine.NOTION_TOKEN;
  fs.writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify(mine));   // the person lost this key (a Reset), a backup has it
  const parent = path.dirname(dir), profile = {notionIds: {NOTION_PROFILE_PAGE_ID: 'p1'}};
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(profile));
  for (const [name, secrets] of [['(backup 2026-11-01 10.00)', {NOTION_TOKEN: notion}], ['(backup 2026-11-02 10.00)', {[SEALED_BY]: NEW}]]) {
    const backup = path.join(parent, `${DATA_NAME} ${name}`);
    fs.mkdirSync(backup); fs.writeFileSync(path.join(backup, 'settings.json'), JSON.stringify(profile)); fs.writeFileSync(path.join(backup, 'secrets.json'), JSON.stringify(secrets));
  }
  const adopted = adoptBackupKeys(run.storage);
  assert.match(adopted.from, /2026-11-01 10\.00\)$/, 'the newer record-only backup does not hide the older one with keys');
  assert.equal(run.storage.secret('NOTION_TOKEN'), TOKENS.NOTION_TOKEN);
});

// Guard: safety — the one read of a real Keychain item (the old Safe Storage password) must stay out of a test run and the twin (desktop/test/keychain.test.js: every call goes through lib/keychain.js).
test('an isolated run or a test never reads the real item', () => {
  const spy = () => { throw new Error('exec must not be reached'); };
  assert.equal(readSafeStorage(OLD, LEGACY_NAME, {env: {JOBADABRA_E2E: '1'}, exec: spy, platform: 'darwin'}), null);
  assert.equal(readSafeStorage(OLD, LEGACY_NAME, {env: {JOBADABRA_TWIN: '1'}, exec: spy, platform: 'darwin'}), null);
  assert.equal(readSafeStorage(OLD, LEGACY_NAME, {env: {}, exec: spy, platform: 'win32'}), null);
  assert.throws(() => readSafeStorage(OLD, LEGACY_NAME, {env: {NODE_TEST_CONTEXT: 'child'}, platform: 'darwin'}), /real Keychain/);
});

// Gitar on #3096: the live-test twin runs on a CLONE of the real folder (JOBADABRA_USER_DATA); a clone of a moved folder opens with the item that sealed it.
test('a test or twin folder cloned from a moved install opens with the new item; a fresh one keeps the old name', async () => {
  const appData = tmp(), keychain = fakeKeychain();
  const real = await seedOldBuild(appData, keychain);
  await start(appData, keychain);   // the real install moves
  for (const [folderOf, item] of [[() => { const clone = tmp(); fs.copyFileSync(path.join(real, 'secrets.json'), path.join(clone, 'secrets.json')); return clone; }, NEW], [tmp, OLD]]) {
    const dir = folderOf(), electron = fakeElectron(keychain);
    electron.app.paths.userData = dir;
    keepLegacyIdentity({app: electron.app, safeStorage: electron.safeStorage, userDataOverride: dir, platform: 'darwin', exec: electron.exec});
    await electron.ready();
    assert.equal(electron.usedItem(), item);
    if (item === NEW) assert.deepEqual(readAll(createStorage(dir, safeStorageCrypto(electron.safeStorage))), TOKENS);
  }
  assert.deepEqual(keychain.securityCalls, [OLD], 'only the real install\'s move read the old item');
});
