// Guard: release — the real proof container must reap orphans and supply account metadata so unrelated lifecycle and Python tests can run.
// Why (10 Nov 2026, fx): this builds the proof image with a live `docker build` (registry pull, apt), so it runs nightly in harness-daily.yml, never on a PR: on public #3643 "Integration app (Linux)"
// timed out in docker build in this file, unchanged since 5 Nov (flaky: the outside world). The PR layer keeps desktop/integration/app/fixer-sandbox.test.js, which reads the same
// sandbox script through a stub `docker`. Run by hand on Linux with Docker: node --test desktop/integration/nightly/fixer-sandbox-docker.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root = path.resolve(import.meta.dirname, '../../..');
const names = ['e2e-runner-watch.test.js', 'kill-tree.test.js'];

/** Build the real proof image for the same UID/GID the sandbox uses, before running any test code in it. */
function buildImage(context) {
  const build = spawnSync('docker', ['build', '--quiet', '--build-arg', `PROOF_UID=${process.getuid()}`, '--build-arg', `PROOF_GID=${process.getgid()}`, '--tag', 'fd-ai-proof', '--file', path.join(root, 'tools/feedback-ai.Dockerfile'), context], {encoding: 'utf8', timeout: 180000});
  assert.equal(build.status, 0, `proof image: ${build.error?.message || build.stderr}`);
}

test('the proof sandbox fails on orphan PIDs without init and passes the same lifecycle tests with init', {skip: process.platform !== 'linux' && 'Linux Docker is required', timeout: 240000}, t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fixer-sandbox-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const box = path.join(dir, 'box');
  for (const folder of ['box/desktop/test/unit/main', 'fbt', 'pydeps', 'context']) fs.mkdirSync(path.join(dir, folder), {recursive: true});
  fs.cpSync(path.join(root, 'desktop/lib'), path.join(box, 'desktop/lib'), {recursive: true});
  fs.copyFileSync(path.join(root, 'desktop/package.json'), path.join(box, 'desktop/package.json'));
  for (const name of names) fs.copyFileSync(path.join(root, 'desktop/test/unit/main', name), path.join(box, 'desktop/test/unit/main', name));
  buildImage(path.join(dir, 'context'));
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

test('Python can resolve its non-root account and home after clearing the environment', {skip: process.platform !== 'linux' && 'Linux Docker is required', timeout: 240000}, t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fixer-account-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  for (const folder of ['box', 'fbt', 'pydeps', 'context']) fs.mkdirSync(path.join(dir, folder), {recursive: true});
  buildImage(path.join(dir, 'context'));
  // The observed failures clear USER/HOME before getpass.getuser() or Path.home(); environment defaults alone cannot fix them.
  const code = 'import os, getpass; from pathlib import Path; os.environ.clear(); assert os.getuid() != 0; assert getpass.getuser(); assert Path.home() == Path("/tmp")';
  const done = spawnSync('bash', [path.join(root, 'tools/feedback-ai-sandbox.sh'), 'python3', '-c', code], {
    encoding: 'utf8', timeout: 30000, env: {...process.env, FBT: path.join(dir, 'fbt'), PYDEPS: path.join(dir, 'pydeps'), BOX: path.join(dir, 'box')},
  });
  assert.equal(done.status, 0, `${done.error?.message || ''}\n${done.stdout}${done.stderr}`);
});
