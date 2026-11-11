// LinkedIn jobs: after the read, the LinkedIn session is nowhere on disk under the app's folder, after a normal end, after an app killed mid-read (at the next start), and
// for what an earlier version left in the kept hidden-browser profile (issue #3711).
// Job: assert state
// Guard: privacy — the copied LinkedIn session is a credential (CLAUDE.md Safety, "Keychain only"); without this the person's sign-in stays in the app folder's browser profile.
// Why (10 Nov 2026, lt's by-hand check of the owner's "never saw a LinkedIn job"): after one press the KEPT profile's Cookies file still held li_at and JSESSIONID on 4 LinkedIn hosts
// (valid until 2027): lib/linkedin-headless.js clearJar expired them only in memory, and lib/browser-reaper.js SIGKILLs the browser before Chrome writes that. linkedin-read.test.js
// checks a stand-in jar in memory, never a file on disk.
// Real: headless Chromium with the app's own start (lib/linkedin-browser.js linkedinReadBrowser over lib/background-browser.js: extension copy, launch, worker), the step
// (linkedinStep), the browser killed the way the reaper does, the start-up sweep (sweepLinkedinLeftovers) and the Cookies files Chrome wrote. Stood in: LinkedIn (its cookies set during
// the "read", as the real site rotates li_at on www/ads/perf hosts), the read itself and the app's port (nothing listens). The session is a FAKE value; nothing reaches LinkedIn,
// the owner's app, profile or Keychain (--use-mock-keychain, --password-store=basic: test-only, they change how values are encrypted, not what is written).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {chromium} from '../../e2e/lib/visit-page.mjs';
import {endBrowser} from '../../e2e/lib/browser-end.mjs';
import {CLOSE_MS, at, capOf, clocked, onHang} from '../../e2e/lib/test-clock.mjs';
import {browserArguments} from '../../lib/background-browser.js';
import {openCdpSession} from '../../lib/cdp-session.js';
import {KEPT_FOLDER, READ_FOLDER, linkedinReadBrowser, sweepLinkedinLeftovers} from '../../lib/linkedin-browser.js';
import {linkedinStep} from '../../lib/linkedin-headless.js';

const TEST_MS = 120000;   // a hang guard: Chrome writes its cookies to disk in batches (about every 30 s), and each read waits for that
const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FAKE = {li_at: 'FAKE-LI-AT-disk-0001', JSESSIONID: '"ajax:FAKE-disk"'};
const YEAR = () => Math.floor(Date.now() / 1000) + 365 * 24 * 3600;   // clock: relative — a real Chromium drops a cookie whose expiry is past by its own clock
// What LinkedIn itself sets during a signed-in read (seen 10 Nov 2026): the session again on its own hosts, valid for a year.
const SITE_SETS = () => ['.www.linkedin.com', '.ads.linkedin.com', '.perf.linkedin.com'].flatMap(domain => ['li_at', 'JSESSIONID'].map(name => ({name, value: `FAKE-rotated-${name}`, domain, path: '/', secure: true, expires: YEAR()})));
const E2E_ENV = {JOBADABRA_E2E: '1', JOBADABRA_E2E_BACKGROUND_BROWSER_ARGS: JSON.stringify(['--no-sandbox'])};
const EXTRA = ['--use-mock-keychain', '--password-store=basic'];

async function until(read, what, ms = 20000) {
  let last = null;
  for (const end = Date.now() + capOf(ms); Date.now() < end;) {
    let value = null;
    try { value = await read(); } catch (error) { last = error; }
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`never happened: ${what}${last ? ` (last error: ${last.message})` : ''}`);
}
/** Every cookie row Chrome wrote under `folder` (any profile below it): [`name@host`] (names only; a value is never read). */
function rowsOnDisk(folder, where = "host_key LIKE '%linkedin.com'") {
  const files = fs.existsSync(folder) ? fs.readdirSync(folder, {recursive: true}).map(String).filter(file => path.basename(file) === 'Cookies') : [];
  return files.flatMap(file => { const db = new DatabaseSync(path.join(folder, file), {readOnly: true}); try { return db.prepare(`SELECT name, host_key AS host FROM cookies WHERE ${where}`).all().map(row => `${row.name}@${row.host}`); } finally { db.close(); } });
}
const killGroup = child => { try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } };
/** One app home: storage.path under a temp folder; the app's own start for the LinkedIn read's browser, with the e2e launch allowance and the test-only keychain flags. */
function home() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-li-disk-')), root = path.join(folder, 'root'), appHome = path.join(folder, 'home');
  fs.mkdirSync(root);
  fs.symlinkSync(DESKTOP, path.join(root, 'desktop'), 'junction');
  fs.cpSync(path.resolve(DESKTOP, '..', 'extension'), path.join(root, 'extension'), {recursive: true});   // a copy, never a link: the app rewrites its copy's port in place
  const storage = {path: name => path.join(appHome, name), settings: () => ({linkedinJobs: {on: true}})};
  const children = [];
  const spawnChild = (file, args, options) => { const child = spawn(file, [...args, ...EXTRA], {...options, env: {...process.env, ...E2E_ENV}}); children.push(child); return child; };
  const read = () => linkedinReadBrowser(storage, {root, find: () => chromium.executablePath(), reaper: () => {}, spawn: spawnChild});
  // Why (#3711): cleanup of both folders; the one this test never started, or a browser the step already disposed, has nothing left to end (logged).
  const close = async () => { for (const name of [READ_FOLDER, KEPT_FOLDER]) await endBrowser({profile: path.join(storage.path(name), 'profile'), launched: true}).catch(error => console.log(`cleanup: endBrowser ${name}: ${error.message}`)); };
  return {folder, appHome, storage, read, children, close, async end() { await close(); fs.rmSync(folder, {recursive: true, force: true, maxRetries: 5, retryDelay: 100}); }};
}
async function withE2eEnv(body) {
  const kept = Object.fromEntries(Object.keys(E2E_ENV).map(key => [key, process.env[key]]));
  Object.assign(process.env, E2E_ENV);
  try { return await body(); } finally { for (const [key, value] of Object.entries(kept)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
}
/** The step with a stand-in read that ends only once Chrome wrote the session to the read profile's disk (a real read lasts minutes: 157 s on 10 Nov). `kill` ends the app there. */
function stepOn(each, browser, {kill = null} = {}) {
  return linkedinStep({storage: each.storage, browser, readSession: () => FAKE, refresh: null, pause: async () => {}, port: 51998, token: 'stand-in-token', end: () => {},
    searches: async () => [{name: 'LinkedIn: stand-in', url: 'https://www.linkedin.com/jobs/search/?keywords=stand-in'}],
    run: async () => {
      await browser.send('Storage.setCookies', {cookies: SITE_SETS()});
      await until(() => rowsOnDisk(each.storage.path(READ_FOLDER)).filter(row => /^li_at@/.test(row)).length >= 4, 'the session reached the read profile on disk during the read', 60000);   // positive control
      if (kill) await kill();
      return [{jobs: 3, answered: true}];   // as runAll returns a read the extension answered
    }});
}

test('a LinkedIn read leaves no LinkedIn session on disk under the app folder once the step ends', {timeout: TEST_MS + CLOSE_MS + 5000}, clocked(TEST_MS, () => withE2eEnv(async () => {
  const each = home();
  onHang(each.close);
  try {
    at('reading LinkedIn (stand-in) in the read\'s own browser');
    const browser = each.read();
    let result;
    try { result = await stepOn(each, browser); } finally { await browser.dispose(); }
    assert.equal(result.state, 'done', `the step ran to its end: ${JSON.stringify(result)}`);
    assert.equal(fs.existsSync(each.storage.path(READ_FOLDER)), false, 'the read\'s own folder is deleted when the step ends');
    assert.deepEqual(rowsOnDisk(each.appHome), [], 'no LinkedIn cookie in any profile under the app folder');
    assert.equal(fs.existsSync(each.storage.path(KEPT_FOLDER)), false, 'the kept, shared profile never saw the session');
  } finally { await each.end(); }
})));

test('an app killed in the middle of a LinkedIn read leaves the session only until its next start', {timeout: TEST_MS + CLOSE_MS + 5000}, clocked(TEST_MS, () => withE2eEnv(async () => {
  const each = home();
  onHang(each.close);
  try {
    at('reading, then the app ends (the reaper SIGKILLs the browser group)');
    const browser = each.read();
    const kill = async () => { for (const child of each.children) killGroup(child); await each.close(); };
    // Why (#3711): the step's browser is killed under it, so the step may throw; the dead app never reaches its finally: no dispose() here.
    await stepOn(each, browser, {kill}).catch(error => console.log(`stepOn after the kill: ${error.message}`));
    assert.ok(rowsOnDisk(each.storage.path(READ_FOLDER)).length > 0, 'positive control: the killed read left its session in its own folder');
    at('the next app start');
    const swept = await sweepLinkedinLeftovers(each.storage);
    assert.equal(swept.readFolder, 'removed', JSON.stringify(swept));
    assert.equal(fs.existsSync(each.storage.path(READ_FOLDER)), false, 'the read\'s folder is gone after the next start');
    assert.deepEqual(rowsOnDisk(each.appHome), [], 'no LinkedIn cookie left under the app folder');
  } finally { await each.end(); }
})));

test('the start-up sweep removes the LinkedIn rows an earlier version left in the kept profile, only those, and opens only files under the app folder', {timeout: TEST_MS + CLOSE_MS + 5000}, clocked(TEST_MS, async () => {
  const each = home();
  const profile = path.join(each.storage.path(KEPT_FOLDER), 'profile'), extension = path.join(each.folder, 'stand-in-extension');
  fs.mkdirSync(extension, {recursive: true});
  fs.writeFileSync(path.join(extension, 'manifest.json'), JSON.stringify({manifest_version: 3, name: 'stand-in', version: '1', background: {service_worker: 'worker.js'}}));
  fs.writeFileSync(path.join(extension, 'worker.js'), 'self.ready = true;');
  const child = spawn(chromium.executablePath(), [...browserArguments(profile, extension, {}), '--no-sandbox', ...EXTRA], {stdio: 'ignore', detached: process.platform !== 'win32'});
  onHang(each.close);
  try {
    at('an earlier version\'s read: a LinkedIn session and another site\'s sign-in in the kept profile');
    const portFile = path.join(profile, 'DevToolsActivePort');
    const port = await until(() => fs.existsSync(portFile) && Number(fs.readFileSync(portFile, 'utf8').split('\n')[0]), 'the browser wrote its port');
    const {webSocketDebuggerUrl} = await until(async () => (await fetch(`http://127.0.0.1:${port}/json/version`)).json(), 'the browser answers');
    const cdp = await openCdpSession(webSocketDebuggerUrl);
    await cdp.send('Storage.setCookies', {cookies: [...SITE_SETS(), {name: 'li_at', value: FAKE.li_at, domain: '.linkedin.com', path: '/', secure: true, expires: YEAR()},
      {name: 'session', value: 'kept', domain: '.boards.example', path: '/', secure: true, expires: YEAR()}]});
    await until(() => rowsOnDisk(each.appHome).length >= 7 && rowsOnDisk(each.appHome, "host_key = '.boards.example'").length === 1, 'the cookies reached the kept profile on disk', 60000);
    await cdp.detach();
    killGroup(child);
    await each.close();
    at('the next app start');
    const opened = [];
    const swept = await sweepLinkedinLeftovers(each.storage, {openDb: file => {
      opened.push(file);
      const db = new DatabaseSync(file);
      return {exec: sql => Number(db.prepare(sql).run().changes), close: () => db.close()};
    }});
    assert.ok(swept.rows >= 7, JSON.stringify(swept));
    const own = path.join(path.resolve(each.storage.path(KEPT_FOLDER)), 'profile') + path.sep;
    assert.ok(opened.length > 0 && opened.every(file => path.resolve(file).startsWith(own)), `only the app's own hidden-browser profile is opened: ${JSON.stringify(opened)}`);
    assert.deepEqual(rowsOnDisk(each.appHome), [], 'no LinkedIn cookie is left in the kept profile');
    assert.deepEqual(rowsOnDisk(each.appHome, "host_key = '.boards.example'"), ['session@.boards.example'], 'another site\'s sign-in stays');
  } finally { await each.end(); }
}));

// Why (#3717 Gitar review, 10 Nov 2026): a read browser that does not close kept its folder (and the session in it) until the next app start, and kept running: the old
// dispose judged a browser gone when its port went quiet, which a hung browser also does.
test('a read browser that hangs is ended by its dispose: no process and no read folder are left', {skip: process.platform === 'win32' && 'SIGSTOP is POSIX only', timeout: TEST_MS + CLOSE_MS + 5000}, clocked(TEST_MS, () => withE2eEnv(async () => {
  const each = home();
  onHang(each.close);
  try {
    at('the read browser starts, then hangs');
    const browser = each.read();
    await browser.start({port: 51998, token: 'stand-in-token'});
    const [child] = each.children;
    assert.ok(child?.pid && fs.existsSync(each.storage.path(READ_FOLDER)), 'positive control: the read browser runs in its own folder');
    process.kill(-child.pid, 'SIGSTOP');
    at('the step ends: dispose');
    assert.equal(await browser.dispose(), true, 'dispose reports the folder gone');
    assert.ok(child.exitCode !== null || child.signalCode !== null, 'the hung browser was ended, not left running');
    assert.equal(fs.existsSync(each.storage.path(READ_FOLDER)), false, 'the read folder is gone at once, not at the next app start');
  } finally {
    for (const child of each.children) if (child.exitCode === null && child.signalCode === null) killGroup(child);
    await each.end();
  }
})));
