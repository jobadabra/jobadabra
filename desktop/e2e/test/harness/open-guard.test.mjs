// Guard: safety — without it a test run whose PATH lacks the `open` stand-in passes the guard and a test page opens in the owner's Chrome (#2350, #3028).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {makeOpenShim, opensIntoSpool} from '../../lib/extension.mjs';

const fakeOpen = () => {   // a folder with an `open` that is not ours (what cmux puts first on PATH)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-fake-open-'));
  fs.writeFileSync(path.join(dir, 'open'), '#!/bin/sh\nexit 0\n', {mode: 0o755});
  return dir;
};

test('a run opens into the spool only when the first PATH folder is the shim\'s own bin (#2350, #3028)', () => {
  const shim = makeOpenShim(), owners = process.env.PATH;
  const env = {PATH: `${shim.bin}${path.delimiter}${owners}`, JOBADABRA_E2E_OPEN_DIR: shim.spool, JOBADABRA_E2E_OPENER: shim.script};
  assert.equal(opensIntoSpool(env, 'darwin'), true);
  assert.equal(opensIntoSpool(env, 'win32'), true);
  assert.equal(opensIntoSpool({...env, PATH: owners}, 'darwin'), false, 'the real open first: a page would reach the owner\'s Chrome');
  assert.equal(opensIntoSpool({...env, JOBADABRA_E2E_OPEN_DIR: ''}, 'darwin'), false);
  assert.equal(opensIntoSpool({...env, JOBADABRA_E2E_OPENER: ''}, 'win32'), false);
});

test('a fake `open` first on PATH, or one that is not the shim, is refused', () => {
  const shim = makeOpenShim(), fake = fakeOpen();
  const env = {PATH: `${fake}${path.delimiter}${shim.bin}${path.delimiter}${process.env.PATH}`, JOBADABRA_E2E_OPEN_DIR: shim.spool, JOBADABRA_E2E_OPENER: shim.script};
  assert.equal(opensIntoSpool(env, 'darwin'), false, 'another `open` ahead of the shim');
  fs.writeFileSync(path.join(shim.bin, 'open'), '#!/bin/sh\nexit 0\n');   // the shim's folder, but its `open` replaced
  assert.equal(opensIntoSpool({...env, PATH: `${shim.bin}${path.delimiter}${process.env.PATH}`}, 'darwin'), false, 'the file in the shim folder is not the shim');
});
