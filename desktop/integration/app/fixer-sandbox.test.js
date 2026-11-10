// Guard: release — the fixer's proof sandbox must start its container with an init process (orphans reaped) and keep every isolation flag, checked without building an image.
// Why (10 Nov 2026, fx): this file used to run a live `docker build` of the proof image on every PR and timed out in docker build (public #3643): the registry, apt and a shared runner are not ours to time.
// A stub `docker` records the arguments the real tools/feedback-ai-sandbox.sh passes; its `build` sleeps, so a test that builds again hangs here and fails. The real container (orphans reaped, account resolved)
// is proved nightly by desktop/test/nightly/fixer-sandbox-docker.test.js (harness-daily.yml).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root = path.resolve(import.meta.dirname, '../../..');
const sandbox = path.join(root, 'tools/feedback-ai-sandbox.sh');
const command = ['node', '--test', 'desktop/test/unit/main/e2e-runner-watch.test.js'];

/** Run a copy of the sandbox script with a stub `docker` first on PATH; returns the arguments the stub saw (one per line) and the script's exit code. */
function runSandbox(dir, script, exitCode = 0) {
  const bin = path.join(dir, 'bin'), log = path.join(dir, 'docker-args.log');
  fs.mkdirSync(bin, {recursive: true});
  fs.writeFileSync(path.join(bin, 'docker'), `#!/usr/bin/env bash\nif [ "$1" = build ]; then echo build >> "$DOCKER_LOG"; sleep 600; fi\nprintf '%s\\n' "$@" > "$DOCKER_LOG"\nexit ${exitCode}\n`, {mode: 0o755});
  const done = spawnSync('bash', [script, ...command], {
    encoding: 'utf8', timeout: 30000,
    env: {...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, DOCKER_LOG: log, FBT: path.join(dir, 'fbt'), PYDEPS: path.join(dir, 'pydeps'), BOX: path.join(dir, 'box')},
  });
  return {status: done.status, error: done.error, args: fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : []};
}

const skip = process.platform === 'win32' && 'the sandbox script is bash on a Docker host';
const value = (args, flag) => args[args.indexOf(flag) + 1];

/** What the sandbox must pass to docker; throws on the first missing piece. */
function assertSandboxArgs(args) {
  assert.equal(args[0], 'run', `the sandbox only runs the image the workflow built, saw: ${args.join(' ')}`);
  assert.ok(!args.includes('build'));
  assert.ok(args.includes('--init'), 'without --init orphaned children stay as zombies and the lifecycle tests see a live process');
  assert.equal(value(args, '--network'), 'none');
  assert.equal(value(args, '--cap-drop'), 'ALL');
  assert.equal(value(args, '--security-opt'), 'no-new-privileges');
  assert.equal(value(args, '--user'), `${process.getuid()}:${process.getgid()}`);
  assert.deepEqual(args.slice(-1 - command.length), ['fd-ai-proof', ...command], 'the image, then the command, last');
}

test('the proof sandbox starts its container with init and every isolation flag, and never builds', {skip, timeout: 60000}, t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fixer-sandbox-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const {status, error, args} = runSandbox(dir, sandbox);
  assert.equal(error, undefined);
  assert.equal(status, 0);
  assertSandboxArgs(args);
});

test('the same check sees the red when --init is taken out (positive control)', {skip, timeout: 60000}, t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fixer-sandbox-control-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const without = path.join(dir, 'without-init.sh');
  fs.writeFileSync(without, fs.readFileSync(sandbox, 'utf8').replace('--init ', ''));
  const {args} = runSandbox(dir, without);
  assert.ok(!args.includes('--init'));
  assert.throws(() => assertSandboxArgs(args), /--init/);
});

test('the box command\'s exit code is the script\'s exit code', {skip, timeout: 60000}, t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fixer-sandbox-exit-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  assert.equal(runSandbox(dir, sandbox, 7).status, 7);
});


test('the proof image declares the non-root account and home needed by Python', () => {
  const image = fs.readFileSync(path.join(root, 'tools/feedback-ai.Dockerfile'), 'utf8');
  assert.match(image, /ARG PROOF_UID=1001/);
  assert.match(image, /ARG PROOF_GID=1001/);
  assert.match(image, /getent passwd "\$PROOF_UID"/);
  assert.match(image, /usermod --home \/tmp/);
  assert.match(image, /useradd --uid "\$PROOF_UID" --gid "\$PROOF_GID" --home-dir \/tmp/);
  assert.match(image, /USER \$\{PROOF_UID\}:\$\{PROOF_GID\}/);
  assert.match(image, /ENV HOME=\/tmp/);
});
