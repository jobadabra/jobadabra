// Every Keychain read of the app goes through here, and what a test or a live-test twin may reach (8 Oct 2026: a local e2e run that reached
// an account page overwrote the owner's real job-site password, jobadabra.sites.password, because the engine's reads were isolated and its
// writes were not). The rule, shared with src/secret_store.py:
//   - a user's app: this Mac's Keychain, or on Windows the Credential Manager through the engine's own store (src/secret_store.py, keyring): read, write
//     and remove only; an item's comment and the list of items stay Mac-only (empty on Windows);
//   - the end-to-end journey (JOBADABRA_E2E): never the Keychain; a file in the run's own folder (JOBADABRA_USER_DATA/isolated-secrets.json,
//     JOBADABRA_ISOLATED_SECRETS for the engine) holds what the run itself saved;
//   - a live-test twin (JOBADABRA_TWIN, docs/live-test.md): writes to its own file too; it READS that file first, then the real Keychain for the
//     job-site passwords only (jobadabra.sites.password, jobadabra.<host>.password), so it signs in like the real app. Nothing else of the owner's.
// Guards: desktop/test/guards/safety/keychain.test.js (an isolated run never calls `security`), tests/unit/ai/test_secret_store.py.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {writePrivate} from './private-file.js';
import {ROOT} from './root.js';
import {python} from './engine-python.js';

/** True in a test run or the twin (JOBADABRA_E2E or JOBADABRA_TWIN): secrets then come from an isolated file, never the owner's Keychain. */
export const isolated = (env = process.env) => !!(env.JOBADABRA_E2E || env.JOBADABRA_TWIN);
// The run's own secrets file, or null (a user's app; or an isolated run without its own folder, which then reads and keeps nothing).
export const isolatedFile = (env = process.env) => (isolated(env) && env.JOBADABRA_USER_DATA ? path.join(path.resolve(env.JOBADABRA_USER_DATA), 'isolated-secrets.json') : null);
const SITE_PASSWORD = /^jobadabra\.[a-z0-9.-]+\.password$/i;
// The twin may also read the Ready to send owner secret (owner, 17 Oct 2026: "Let the twin read that one item"): it is the same install, so its Send tonight / Run now reach the site as the owner's; read-only, never written.
export const TWIN_OWNER_SECRET = 'jobadabra.ready.owner_secret';
/** True when the twin may read this Keychain service: a job-site password (not the Mac signing one) or the twin owner secret; anything else stays unreadable. */
export const twinMayRead = service => (SITE_PASSWORD.test(String(service)) && service !== 'jobadabra.mac-sign.password') || service === TWIN_OWNER_SECRET;

// {service: {value, account, comment, created}} as the run saved them.
export function isolatedItems(env = process.env) {
  const file = isolatedFile(env);
  if (!file) return {};
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { return {}; }
}

// 24 Oct 2026: a test wrote the owner's real Keychain (Python side, src/secret_store.py). Under `node --test` the genuine execFileSync never changes it: a test passes a spy.
const refuseRealChange = (exec, env) => { if (exec === execFileSync && (env.NODE_TEST_CONTEXT || env.JOBADABRA_UNDER_TEST)) throw new Error('A test tried to change the real Keychain: pass a fake exec or run isolated'); };
// Why (#3711, 10 Nov 2026): a unit test that passed no fake read the owner's real LinkedIn session item; only changes were refused. Under a test the genuine one reads nothing.
const testReadsReal = (exec, env) => exec === execFileSync && Boolean(env.NODE_TEST_CONTEXT || env.JOBADABRA_UNDER_TEST);
const real = (exec, args, timeout) => { try { return exec('security', args, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024, ...(timeout ? {timeout} : {})}); } catch { return null; } };

/** True when this computer has a secret store the app can keep a secret in: the Mac's Keychain or Windows' Credential Manager (not Linux). */
export const hasStore = (platform = process.platform) => platform === 'darwin' || platform === 'win32';

// Why (14 Nov 2026, owner: "Let's store them in Keychain/Credentials Manager (windows)"): Electron has no Credential Manager binding and Windows has no `security` tool, so the
// app asks the engine's own store (src/secret_store.py, keyring, shipped in the Windows app), the one the engine already keeps Windows secrets in. Never a file on disk.
// The secret goes in on stdin and comes back on stdout, never on a command line (other programs can read those). -> its stdout, or null when it failed or found nothing.
const windowsStore = (exec, verb, service, {account, value = '', env}) => {
  try {
    return exec(python('win32'), ['-m', 'src.secret_store', verb, service, ...(account ? ['--account', account] : [])], {
      cwd: ROOT, encoding: 'utf8', input: value, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024,
      env: {...env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', JOBADABRA_RESULT_FILE: ''},   // a hang guard only; no result file: this is no engine run
    });
  } catch { return null; }
};

// Why (rename to Jobadabra, 1 Nov 2026, owner: "small fallbacks"): items an install made before the rename sit under job-pilotto.* with account job-pilotto. A read
// that finds nothing under the new name asks for the old one; a delete takes both; a write only ever makes the new name. Removed 2 stable releases after the rename.
// Same rule in src/secret_store.py (legacyName).
export const legacyName = (service, account) => (String(service).startsWith('jobadabra.')
  ? {service: `job-pilotto.${String(service).slice('jobadabra.'.length)}`, account: account === 'jobadabra' ? 'job-pilotto' : account} : null);
const security = (exec, verb, service, account, tail = []) => real(exec, [verb, ...(account ? ['-a', account] : []), '-s', service, ...tail]);
const securityOrOlder = (exec, verb, service, account, tail) => {
  const found = security(exec, verb, service, account, tail), older = legacyName(service, account);
  return found !== null || !older ? found : security(exec, verb, older.service, older.account, tail);
};

// One item's secret, or null. account: the item's -a (omitted: any account, as `security` matches).
export function read(service, {account, env = process.env, exec = execFileSync, platform = process.platform} = {}) {
  if (isolated(env)) {
    const item = isolatedItems(env)[service];
    if (item) return item.value || null;
    if (!(env.JOBADABRA_TWIN && twinMayRead(service))) return null;
  }
  if (!hasStore(platform) || testReadsReal(exec, env)) return null;
  if (platform === 'win32') return windowsStore(exec, 'get', service, {account, env}) || null;
  return String(securityOrOlder(exec, 'find-generic-password', service, account, ['-w']) || '').trim() || null;
}

/**
 * The password of an item Electron made for its safeStorage ("<app name> Safe Storage"), read once by lib/keychain-migration.js to move the saved tokens to the new item.
 * A REAL item of the person's Keychain, so a test run or the twin never reads it (null), and a test never reaches the genuine `security` (refuseRealChange).
 * @returns {string|null} null when denied, missing, timed out (`timeoutMs`: the macOS prompt waits for a person), isolated, or not macOS
 */
export function readSafeStorage(service, account, {env = process.env, exec = execFileSync, platform = process.platform, timeoutMs = 120000} = {}) {
  if (isolated(env) || platform !== 'darwin') return null;
  refuseRealChange(exec, env);
  return String(real(exec, ['find-generic-password', '-w', '-s', service, '-a', account], timeoutMs) || '').replace(/\r?\n$/, '') || null;
}

// One item's comment ("email=… job=…"), never its secret; '' when there is none.
export function comment(service, {account, env = process.env, exec = execFileSync, platform = process.platform} = {}) {
  if (isolated(env)) {
    const item = isolatedItems(env)[service];
    if (item) return item.comment || '';
    if (!(env.JOBADABRA_TWIN && twinMayRead(service))) return '';
  }
  if (platform !== 'darwin' || testReadsReal(exec, env)) return '';
  return (String(securityOrOlder(exec, 'find-generic-password', service, account) || '').match(/"icmt"<blob>="([^"]*)"/) || [])[1] || '';
}

// The Keychain's item attributes as `security dump-keychain` prints them (never a secret), or null when it can't be read. An isolated run gets its own
// items in the same shape (the twin also the real site-password items, as the twin reads those).
export function dump({env = process.env, exec = execFileSync, platform = process.platform} = {}) {
  const own = Object.entries(isolatedItems(env)).map(([service, item]) => {
    const stamp = String(item.created || '').replace(/[^0-9]/g, '').slice(0, 14).padEnd(14, '0');
    return `keychain: "isolated"\nclass: "genp"\nattributes:\n    0x00000007 <blob>="${service}"\n    "acct"<blob>="${item.account || ''}"\n` +
      `    "cdat"<timedate>=0x00 "${stamp}Z\\000"\n    "icmt"<blob>="${item.comment || ''}"\n    "svce"<blob>="${service}"\n`;
  }).join('');
  if (isolated(env) && !env.JOBADABRA_TWIN) return own;
  if (platform !== 'darwin' || testReadsReal(exec, env)) return isolated(env) ? own : null;
  const text = real(exec, ['dump-keychain']);
  if (text === null) return isolated(env) ? own : null;
  if (!isolated(env)) return text;
  const names = new Set(Object.keys(isolatedItems(env)));   // the twin: its own items, then the real site passwords it did not replace
  const kept = String(text).split(/^(?=keychain: )/m).filter(block => {
    const service = (block.match(/"svce"<blob>="([^"]*)"/) || [])[1] || '';
    return twinMayRead(service) && !names.has(service);
  });
  return own + kept.join('');
}

// Deletes one item (Settings → Credentials, owner 9 Oct 2026). A test run or the twin deletes only from its own file, never a real Keychain item. -> true when it was there.
export function remove(service, {account, env = process.env, exec = execFileSync, platform = process.platform} = {}) {
  if (isolated(env)) {
    const items = isolatedItems(env), file = isolatedFile(env);
    if (!file || !(service in items)) return false;
    delete items[service];
    writePrivate(file, JSON.stringify(items, null, 2));
    return true;
  }
  if (!hasStore(platform)) return false;
  refuseRealChange(exec, env);
  if (platform === 'win32') return windowsStore(exec, 'delete', service, {account, env}) !== null;   // the store also takes the item's name from before the rename
  const older = legacyName(service, account);
  const removed = security(exec, 'delete-generic-password', service, account) !== null;
  return (older && security(exec, 'delete-generic-password', older.service, older.account) !== null) || removed;   // both names: a deleted credential must not come back from the old item
}

// Writes one item (the app moves an account to its profile, Settings → Credentials, 16 Oct 2026). Same isolation as every other call: a test run or the twin
// writes only its own file, never the real Keychain. comment: the "email=… job=…" note. -> true when it was stored.
export function write(service, value, {account, comment = '', label = '', env = process.env, exec = execFileSync, platform = process.platform} = {}) {
  if (isolated(env)) {
    const file = isolatedFile(env);
    if (!file) return false;
    const items = isolatedItems(env), now = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
    items[service] = {value, account: account || '', comment, created: items[service]?.created || now};
    writePrivate(file, JSON.stringify(items, null, 2));
    return true;
  }
  if (!hasStore(platform) || !value) return false;
  refuseRealChange(exec, env);
  if (platform === 'win32') return windowsStore(exec, 'put', service, {account: account || 'jobadabra', value: String(value), env}) !== null;   // no label or comment there
  return real(exec, ['add-generic-password', '-U', '-a', account || 'jobadabra', '-s', service, ...(label ? ['-l', label] : []), ...(comment ? ['-j', comment] : []), '-w', value]) !== null;
}
