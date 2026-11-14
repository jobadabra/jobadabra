// Guard: safety — the installed app can never read another run's pages or AI answers (the by-hand same-inputs pair shares them through JOBADABRA_TAPE_SHARED*, src/same_inputs.py).
// Why (14 Nov 2026, owner via sa: "let's commit it open a PR and get this merged"): the engine env is a prefix allowlist for the tape flags; the installed build drops the same-inputs ones, so a leaked variable in the shell the app started from cannot make a search read a folder.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as pipeline from '../../../lib/pipeline.js';
import {createStorage} from '../../../lib/storage.js';

const fakeCrypto = {encrypt: v => Buffer.from(v).reverse().toString('base64'), decrypt: s => Buffer.from(s, 'base64').reverse().toString()};
const storage = () => createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-')), fakeCrypto);
const SHARED = {JOBADABRA_TAPE_SHARED: '/tmp/x', JOBADABRA_TAPE_SHARED_AI: '1', JOBADABRA_TAPE_SHARED_REPLAY: '1', JOBADABRA_TAPE_SHARED_REPLAY_SCALE: '0'};

test('an installed build never passes the same-inputs flags to the engine; a source run (the by-hand tool) does', () => {
  try {
    pipeline.setInstalledBuild(true);
    const installed = pipeline.pipelineEnv(storage(), {PATH: '/usr/bin', ...SHARED, JOBADABRA_TAPE_WAIT_SCALE: '0'});
    for (const name of Object.keys(SHARED)) assert.equal(installed[name], undefined, name);
    assert.equal(installed.JOBADABRA_TAPE_WAIT_SCALE, '0', 'the other tape flags are unchanged');
    pipeline.setInstalledBuild(false);
    const source = pipeline.pipelineEnv(storage(), {PATH: '/usr/bin', ...SHARED});
    for (const [name, value] of Object.entries(SHARED)) assert.equal(source[name], value, name);
  } finally {
    pipeline.setInstalledBuild(false);
  }
});
