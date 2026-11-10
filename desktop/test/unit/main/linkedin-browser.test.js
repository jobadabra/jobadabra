// The start-up sweep of LinkedIn sessions left in the kept hidden-browser profile: rows go, and their bytes do not stay in the Cookies file (#3711 review).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {KEPT_FOLDER, sweepLinkedinLeftovers} from '../../../lib/linkedin-browser.js';

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
