// Guard: release — the actual proof container must reap orphan processes so lifecycle tests do not block an unrelated fix with zombie PIDs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root = path.resolve(import.meta.dirname, '../../..');
const names = ['e2e-runner-watch.test.js', 'kill-tree.test.js'];

test('the proof sandbox fails on orphan PIDs without init and passes the same lifecycle tests with init', {skip: process.platform !== 'linux' && 'Linux Docker is required', timeout: 240000}, t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fixer-sandbox-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const box = path.join(dir, 'box');
  for (const folder of ['box/desktop/test/unit/main', 'fbt', 'pydeps', 'context']) fs.mkdirSync(path.join(dir, folder), {recursive: true});
  fs.cpSync(path.join(root, 'desktop/lib'), path.join(box, 'desktop/lib'), {recursive: true});
  fs.copyFileSync(path.join(root, 'desktop/package.json'), path.join(box, 'desktop/package.json'));
  for (const name of names) fs.copyFileSync(path.join(root, 'desktop/test/unit/main', name), path.join(box, 'desktop/test/unit/main', name));
  const build = spawnSync('docker', ['build', '--quiet', '--tag', 'fd-ai-proof', '--file', path.join(root, 'tools/feedback-ai.Dockerfile'), path.join(dir, 'context')], {encoding: 'utf8', timeout: 180000});
  assert.equal(build.status, 0, `proof image: ${build.error?.message || build.stderr}`);
  const sandbox = path.join(root, 'tools/feedback-ai-sandbox.sh');
  const before = path.join(dir, 'without-init.sh');
  fs.writeFileSync(before, fs.readFileSync(sandbox, 'utf8').replace('--init ', ''));
  const run = script => spawnSync('bash', [script, 'node', '--test', ...names.map(name => `desktop/test/unit/main/${name}`)], {
    encoding: 'utf8', timeout: 30000, env: {...process.env, FBT: path.join(dir, 'fbt'), PYDEPS: path.join(dir, 'pydeps'), BOX: box},
  });
  const old = run(before), oldLog = `${old.stdout}${old.stderr}`;
  assert.notEqual(old.status, 0, 'without init the container must reproduce the red');
  assert.match(oldLog, /the watched app is still alive after its runner was killed/);
  assert.match(oldLog, /the grandchild is gone after the stop/);
  const fixed = run(sandbox);
  assert.equal(fixed.status, 0, `${fixed.error?.message || ''}\n${fixed.stdout}${fixed.stderr}`);
});
