// The daily AI user agent's decisions: the session size from the broker's state (Codex answering, Codex out, refused), the changed-since window, and a night's memory commit round trip on a local bare repo.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
import {capsFor, changedLogArgs, engineState, FULL, lastSessionCommit, memoryCommitFiles, nightWorked} from '../../lib/agent-nightly.mjs';
import {pushMemory} from '../../lib/agent-memory.mjs';

test('the broker\'s answer decides the size of the night: Codex = full, Codex out = half, refused = skip with the reason', () => {
  const codex = {ok: true, engine: 'codex'}, out = {ok: true, engine: 'claude', fellBack: [{engine: 'codex', why: 'ran-out'}]};
  assert.deepEqual([engineState(codex), engineState(out), engineState({ok: true, engine: 'claude'}), engineState({ok: false, status: 'capped'}), engineState(null)], ['codex', 'codex-out', 'other', 'refused', 'refused']);
  assert.deepEqual(capsFor('codex', {}), {skip: false, reason: '', ...FULL, note: 'Codex answers: the full session.'});
  const half = capsFor('codex-out', {});
  assert.deepEqual([half.minutes, half.calls, half.steps], [FULL.minutes / 2, FULL.calls / 2, FULL.steps / 2]);
  assert.match(half.note, /Codex ran out/);
  const refused = capsFor('refused', {}, 'capped: broker: budget');
  assert.equal(refused.skip, true);
  assert.match(refused.note, /No session tonight: capped: broker: budget/);
});

test('the repository variables set the full size; a half session never goes under the floor', () => {
  assert.deepEqual([capsFor('codex', {minutes: '30', calls: '', steps: 'x'}).minutes, capsFor('codex', {minutes: '30', calls: '', steps: 'x'}).calls, capsFor('codex', {minutes: '30', calls: '', steps: 'x'}).steps], [30, FULL.calls, FULL.steps]);
  const tiny = capsFor('codex-out', {minutes: '6', calls: '40', steps: '20'});
  assert.deepEqual([tiny.minutes, tiny.calls, tiny.steps], [5, 30, 30]);
});

test('a repository variable above the step timeout is cut to 35 minutes, so the 45-minute step never kills a working night', () => {
  assert.equal(capsFor('codex', {minutes: '90'}).minutes, 35);
  assert.equal(capsFor('codex-out', {minutes: '90'}).minutes, 17);
  assert.equal(capsFor('codex', {minutes: '35'}).minutes, 35);
});

test('the changed-since window starts at the last session\'s commit, or the last 30 commits on a first night or a damaged record', () => {
  assert.deepEqual(changedLogArgs('abc1234'), ['log', '--format=@@%H%x09%s', '--name-only', 'abc1234..HEAD']);
  assert.equal(changedLogArgs('').at(-1), '-30');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-last-'));
  assert.equal(lastSessionCommit(dir), '');
  fs.writeFileSync(path.join(dir, 'last.json'), '{not json');
  assert.equal(lastSessionCommit(dir), '');
  fs.writeFileSync(path.join(dir, 'last.json'), JSON.stringify({sha: 'abc1234'}));
  assert.equal(lastSessionCommit(dir), 'abc1234');
});

test('a night stopped by a broker error does not count as worked, so the changed-since window stays', () => {
  assert.equal(nightWorked({stopped: 'done'}), true);
  assert.equal(nightWorked({stopped: 'api: 429 broker: budget'}), false);
  assert.equal(nightWorked(null), false);
});

test('a night\'s memory commit: the suite\'s files and last.json go to the branch, a second identical night pushes nothing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-night-')), remote = path.join(root, 'remote.git'), work = path.join(root, 'work'), out = path.join(root, 'out');
  const run = (args, cwd) => execFileSync('git', args, {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
  run(['init', '--bare', '--quiet', '--initial-branch=main', remote]);
  run(['clone', '--quiet', remote, work]);
  fs.mkdirSync(path.join(out, 'notes'), {recursive: true});
  fs.writeFileSync(path.join(out, 'notes/jobs.md'), '# Jobs\n- Board hides the Show menu\n');
  fs.writeFileSync(path.join(out, 'coverage.json'), '[]');
  const files = memoryCommitFiles(out, {sha: 'abc1234', today: '2026-11-04'});
  assert.deepEqual(Object.keys(files).sort(), ['coverage.json', 'last.json', 'notes/jobs.md']);
  assert.deepEqual(pushMemory({dir: work, files, git: args => run(args, work), message: 'night 1'}), {pushed: true});
  assert.equal(JSON.parse(run(['show', 'agent-memory:last.json'], remote)).sha, 'abc1234');
  assert.deepEqual(pushMemory({dir: work, files, git: args => run(args, work), message: 'night 1 again'}), {pushed: false});
  assert.deepEqual(Object.keys(memoryCommitFiles(path.join(root, 'missing'), {sha: 'x', today: 'y'})), ['last.json']);
});
