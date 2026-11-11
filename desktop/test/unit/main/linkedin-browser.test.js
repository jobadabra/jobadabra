// The start-up sweep of LinkedIn sessions left in the kept hidden-browser profile: rows go, and their bytes do not stay in the Cookies file (#3711 review).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import net from 'node:net';
import {createBackgroundBrowser, holdStartsUntil} from '../../../lib/background-browser.js';
import {KEPT_FOLDER, READ_FOLDER, sweepBeforeAnyStart, sweepLinkedinLeftovers} from '../../../lib/linkedin-browser.js';

const FAKE_LI_AT = 'FAKE-LI-AT-sweep-0123456789abcdef';

// Why (#3711 review, 10 Nov 2026): a plain DELETE left li_at's bytes in the file's free pages; the sweep must leave nothing a reader of the file finds.
test('the sweep removes LinkedIn rows from the kept profile and leaves none of their bytes in the file; other sites stay', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-li-sweep-'));
  try {
    const storage = {path: name => path.join(folder, name)};
    const file = path.join(storage.path(KEPT_FOLDER), 'profile', 'Default', 'Network', 'Cookies');
    fs.mkdirSync(path.dirname(file), {recursive: true});
    const {DatabaseSync} = process.getBuiltinModule('node:sqlite');
    const db = new DatabaseSync(file);
    db.exec('CREATE TABLE cookies (host_key TEXT, name TEXT, value TEXT)');
    const add = db.prepare('INSERT INTO cookies VALUES (?, ?, ?)');
    for (const host of ['.linkedin.com', '.www.linkedin.com', 'linkedin.com']) add.run(host, 'li_at', FAKE_LI_AT);
    add.run('.boards.example', 'session', 'kept-value');
    db.close();
    assert.ok(fs.readFileSync(file).includes(FAKE_LI_AT), 'positive control: the value is in the file before the sweep');
    const swept = await sweepLinkedinLeftovers(storage, {fetchImpl: async () => { throw new Error('no browser runs'); }});
    assert.deepEqual(swept, {readFolder: 'none', rows: 3});
    assert.ok(!fs.readFileSync(file).includes(FAKE_LI_AT), 'no byte of the LinkedIn value is left in the file');
    const left = new DatabaseSync(file);
    assert.deepEqual(left.prepare('SELECT host_key, value FROM cookies').all().map(row => ({...row})), [{host_key: '.boards.example', value: 'kept-value'}]);
    left.close();
  } finally {
    fs.rmSync(folder, {recursive: true, force: true});
  }
});

// A port nothing listens on: the sweep's "is a browser still using this profile" question waits on the network, as after a killed app.
const deadPort = () => new Promise(resolve => { const server = net.createServer().listen(0, '127.0.0.1', () => { const {port} = server.address(); server.close(() => resolve(port)); }); });
/** An app folder holding a read folder a killed app left; -> {storage, startNow() -> was the leftover still there when the browser's start reached its launch}. */
async function leftoverHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-li-hold-'));
  t.after(() => { holdStartsUntil(Promise.resolve()); fs.rmSync(home, {recursive: true, force: true}); });
  const storage = {path: name => path.join(home, name)};
  const profile = path.join(storage.path(READ_FOLDER), 'profile');
  fs.mkdirSync(profile, {recursive: true});
  fs.writeFileSync(path.join(profile, 'DevToolsActivePort'), `${await deadPort()}\n/devtools/browser/stand-in`);
  const startNow = async () => {
    let leftover = null;
    const browser = createBackgroundBrowser(storage, {find: () => { leftover = fs.existsSync(storage.path(READ_FOLDER)); return null; },
      fetchImpl: async () => { throw new Error('no browser in a unit test'); }, reaper: () => {}, spawn: () => { throw new Error('no spawn in a unit test'); }});
    await assert.rejects(browser.start({port: 47999, token: 'stand-in'}), /Download the optional background browser first/);
    return leftover;
  };
  return {storage, startNow};
}

// Why (#3773 review, 10 Nov 2026): the sweep and the hold were two calls that could come apart; the app start now calls one step, and this plays a browser started at once.
test('at app start a hidden browser that starts at once finds the LinkedIn leftovers already swept; without the hold it would not (positive control)', async t => {
  const bare = await leftoverHome(t);
  const sweptBare = sweepLinkedinLeftovers(bare.storage);
  assert.equal(await bare.startNow(), true, 'positive control: a sweep with no hold is still running when a browser starts');
  await sweptBare;
  const held = await leftoverHome(t);
  const lines = [];
  const swept = sweepBeforeAnyStart(held.storage, (...line) => lines.push(line));
  assert.equal(await held.startNow(), false, 'the browser started only after the leftover read folder was removed');
  assert.equal((await swept).readFolder, 'removed');
  assert.deepEqual(lines.map(line => line[1]), ['leftover session removed']);
});
