// Moves the macOS Keychain item that seals the saved tokens from "Job Pilotto Safe Storage" to "Jobadabra Safe Storage" without losing a token.
// Spec: docs/superpowers/specs/2026-11-03-keychain-jobadabra-design.md. Invariants: nothing is written before every token was re-sealed AND read back equal;
// the old item is never changed or deleted; a value is never logged; any failure leaves secrets.json as it was and the next start tries again.
import {execFileSync} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {readSafeStorage} from './keychain.js';
import {writePrivate} from './private-file.js';

/** The reserved entry of secrets.json that names the Keychain item which sealed the file's values. It is in the same file so values and record are one rename. */
export const SEALED_BY = '__sealedBy';
const BACKUP = 'secrets.before-keychain-move.json';
const IV = Buffer.alloc(16, 0x20);   // Chromium's fixed IV: 16 spaces (components/os_crypt/async/common/encryptor.cc)
/** The Keychain item Electron makes for an app name (electron_browser_main_parts.cc); its account is the app name itself. */
export const itemOf = appName => `${appName} Safe Storage`;

// What Chromium's OSCrypt (macOS) does, read from its source on 3 Nov 2026 (spec "How the key is made"): key = PBKDF2-HMAC-SHA1(password text, "saltysalt", 1003, 16 bytes),
// value = "v10" + AES-128-CBC(PKCS#7, IV of 16 spaces). Same key and IV make the same plaintext seal to the same bytes.
export const osKey = password => crypto.pbkdf2Sync(Buffer.from(password, 'utf8'), 'saltysalt', 1003, 16, 'sha1');
/** @returns {string} base64 of "v10" + ciphertext, what storage.js keeps */
export function sealV10(text, key) {
  const cipher = crypto.createCipheriv('aes-128-cbc', key, IV);
  return Buffer.concat([Buffer.from('v10'), cipher.update(text, 'utf8'), cipher.final()]).toString('base64');
}
// Chromium also opens values sealed while the Keychain gave no password: PBKDF2(1 iteration, "", "saltysalt") (encryptor.cc, crbug.com/40055416).
const EMPTY_KEY = Buffer.from('d0d0ec9c7d77d43ac54187fa4818d17f', 'hex');
function decryptWith(raw, key) {
  const decipher = crypto.createDecipheriv('aes-128-cbc', key, IV);
  const text = Buffer.concat([decipher.update(raw), decipher.final()]).toString('utf8');
  if (text.includes('\uFFFD')) throw new Error('wrong key');   // a wrong key can pass the padding by chance (1 in 256)
  return text;
}
/** @throws when the value is not v10, or neither the key nor Chromium's empty-password fallback opens it */
export function openV10(sealed, key) {
  const raw = Buffer.from(sealed, 'base64');
  if (raw.subarray(0, 3).toString() !== 'v10') throw new Error('not a v10 value');
  try { return decryptWith(raw.subarray(3), key); } catch { return decryptWith(raw.subarray(3), EMPTY_KEY); }
}

// The old item's password: the one prompt (macOS asks `security` for access). Read through lib/keychain.js (the one place that isolates tests and the twin); never logged.
function readOldKey(exec, oldItem, oldAccount) {
  const password = readSafeStorage(oldItem, oldAccount, {exec, platform: 'darwin'});   // keychainSealing is only ever built on macOS (app-identity.js); a test on Linux CI must not skip the read
  if (!password) throw new Error('the old Keychain item could not be read (denied, missing or no answer)');
  return osKey(password);
}

const sealedNames = all => Object.keys(all).filter(name => !name.startsWith('__') && typeof all[name] === 'string' && all[name]);

/** @returns {{state:'migrated'|'fresh'|'not-migrated'|'unreadable', all?:object, sealed?:string[]}} what secrets.json says; 'unreadable' (not JSON) is left alone, as today */
export function readPlan(file, newItem) {
  let all;
  try { all = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}; } catch { return {state: 'unreadable'}; }
  if (!all || typeof all !== 'object' || Array.isArray(all)) return {state: 'unreadable'};
  if (all[SEALED_BY] === newItem) return {state: 'migrated', all};
  const sealed = sealedNames(all);
  return sealed.length ? {state: 'not-migrated', all, sealed} : {state: 'fresh', all};
}

/** The app's name for the Keychain item is fixed by the first seal of the process, so seal once now. No keychain here (CI): nothing to keep. */
export function lockName(safeStorage) {
  try { if (safeStorage.isEncryptionAvailable()) safeStorage.encryptString('keychain-name'); } catch { /* no keychain here */ }
}

// A safeStorage stand-in in pure Node on the OLD key: used for the rest of one run when the move failed after the process had left the old item (spec "Failure rules").
const legacySealer = key => ({
  isEncryptionAvailable: () => true,
  encryptString: text => Buffer.from(sealV10(text, key), 'base64'),
  decryptString: buffer => openV10(Buffer.from(buffer).toString('base64'), key),
});

function openAll(all, sealed, key) {
  const plain = {};
  for (const name of sealed) { try { plain[name] = openV10(all[name], key); } catch { /* unreadable before, unreadable after (same as today) */ } }
  if (!Object.keys(plain).length) throw new Error(`none of ${sealed.length} saved values opens with the old key`);
  return plain;
}

// Seals each plaintext under the process's CURRENT item and proves it: read back equal, and not the old bytes (equal bytes = Electron is still on the old item).
function sealAll(plain, oldSealed, safeStorage) {
  const blobs = {};
  for (const [name, text] of Object.entries(plain)) {
    const blob = safeStorage.encryptString(text).toString('base64');
    if (blob === oldSealed[name]) throw new Error('safeStorage is still on the old Keychain item');
    if (safeStorage.decryptString(Buffer.from(blob, 'base64')) !== text) throw new Error(`a re-sealed value reads back different (${name})`);
    blobs[name] = blob;
  }
  return blobs;
}

function commit(file, all, blobs, item) {
  const backup = path.join(path.dirname(file), BACKUP);
  if (!fs.existsSync(backup)) writePrivate(backup, fs.readFileSync(file, 'utf8'));
  if (writePrivate(file, JSON.stringify({...all, ...blobs, [SEALED_BY]: item}, null, 2) + '\n') !== 'saved') throw new Error('secrets.json could not be saved');
}

const why = error => String(error?.code || error?.status || String(error?.message || error).split('\n')[0]).slice(0, 120);

/**
 * macOS: decides the Keychain item for this start and, for an install sealed under the old name, moves it.
 * The plan is read in atReady(), not at load: a Reset or Import applies after load (main.js applyPending) and changes secrets.json (review of 3 Nov 2026, data loss).
 * @param {{app, safeStorage, names:{legacy:string, current:string}, log?:Function, exec?:Function}} args
 * @returns {{sealer, atReady:Function}} sealer: what storage.js seals with (the real safeStorage, or the Node stand-in after a failed move); atReady(): once, in the FIRST copy of the app
 *   only (a second copy quits at once and must not prompt or rewrite the file), at app ready, after any reset or import and before anything seals
 */
export function keychainSealing({app, safeStorage, names, log = () => {}, exec = execFileSync}) {
  const newItem = itemOf(names.current);
  let active = safeStorage;
  const sealer = {isEncryptionAvailable: () => active.isEncryptionAvailable(), encryptString: text => active.encryptString(text), decryptString: buffer => active.decryptString(buffer)};

  function start(file, plan) {   // nothing sealed yet: the new item, recorded at once so a later start never takes the new item's values for old ones
    try {
      fs.mkdirSync(path.dirname(file), {recursive: true});
      if (writePrivate(file, JSON.stringify({...plan.all, [SEALED_BY]: newItem}, null, 2) + '\n') !== 'saved') throw new Error('not saved');
      return true;
    } catch (error) { log(`Keychain: could not record ${newItem} (${why(error)}); staying on ${itemOf(names.legacy)}`); return false; }
  }

  function move(file, plan) {
    let key, plain;
    try {   // nothing has left the old item yet: a failure here is today's behaviour
      if (!safeStorage.isEncryptionAvailable()) throw new Error('no keychain here');
      key = readOldKey(exec, itemOf(names.legacy), names.legacy);
      plain = openAll(plan.all, plan.sealed, key);
    } catch (error) { log(`Keychain: ${itemOf(names.legacy)} kept, move postponed to the next start (${why(error)})`); lockName(safeStorage); return; }
    app.setName(names.current);
    try {
      commit(file, plan.all, sealAll(plain, plan.all, safeStorage), newItem);
      log(`Keychain: ${Object.keys(plain).length} of ${plan.sealed.length} saved values moved to ${newItem}; ${itemOf(names.legacy)} kept untouched as a backup`);
    } catch (error) {   // the process may already use the new item: read and write the old format with the old key for this run
      active = legacySealer(key);
      log(`Keychain: move failed (${why(error)}); this run keeps ${itemOf(names.legacy)}'s values, next start tries again`);
    }
  }

  function atReady() {
    const file = path.join(app.getPath('userData'), 'secrets.json');
    const plan = readPlan(file, newItem);
    if (plan.state === 'not-migrated') move(file, plan);
    else if (plan.state === 'unreadable' || (plan.state === 'fresh' && !start(file, plan))) lockName(safeStorage);
    else app.setName(names.current);   // migrated, or fresh and recorded: the first seal is under the new name
  }
  return {sealer, atReady};
}
