// The app and the engine agree on the env protocol (src/paths.py ENV_VERSION, desktop/lib/pipeline-env.js ENV_VERSION), and the engine's real refusal line is the one the Jobs read turns into "Restart".
// Why (2 Nov 2026, Gitar on #3015): the first version of the Restart card tested the app side against a made-up line, and no app containing it could ever be refused.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {ENV_VERSION, pipelineEnv} from '../lib/pipeline-env.js';
import {jobs} from '../lib/pipeline-commands.js';
import {install} from './tiny-dom.js';

install();
const {OUTDATED_LINE} = await import('../renderer/errors.js');
const root = fileURLToPath(new URL('../../', import.meta.url));

test('the app sends the number the engine requires', () => {
  const engine = Number(/^ENV_VERSION = (\d+)/m.exec(fs.readFileSync(`${root}src/paths.py`, 'utf8'))?.[1]);
  assert.equal(ENV_VERSION, engine, 'bump src/paths.py ENV_VERSION and lib/pipeline-env.js ENV_VERSION together');
  assert.equal(pipelineEnv({settings: () => ({}), saveSettings: () => ({}), path: name => name, secret: () => ''}, {}).JOBADABRA_ENV_VERSION, String(ENV_VERSION));
});

test('the real engine refuses an app on an older protocol, and the Jobs read turns its real line into the restart line', async () => {
  const env = {PATH: process.env.PATH, JOBADABRA_NO_DOTENV: '1', JOBADABRA_ENV_VERSION: String(ENV_VERSION - 1)};
  const engine = spawnSync('python3', ['-m', 'src.desktop', 'jobs'], {cwd: root, env, encoding: 'utf8'});
  assert.notEqual(engine.status, 0);
  const lines = engine.stderr.split('\n').filter(Boolean);
  const run = async (_storage, _args, onLine) => { lines.forEach(onLine); return {code: engine.status, stdout: ''}; };
  await assert.rejects(jobs({settings: () => ({lastSearchAt: 'x'})}, 7003, run), error => error.message === OUTDATED_LINE);
});
