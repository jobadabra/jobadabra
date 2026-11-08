// Guard: release — a picked step renamed since the coverage map goes red on main instead of running the whole suite (apply red after #3579, 8 Nov 2026).
// Plays the real order of writes: the file e2e.yml's fallback reads (suite-failures.json) is written when the suite closes, and must already hold the runner's lost-pick record,
// but only when the suite ran to its end (a hang or a crash is no rename), and without a ::error line on a job the fallback turns green.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createRunner} from '../../lib/runner.mjs';
import {finishSuite, stopCode} from '../../lib/suite-main.mjs';
import {onlyRenamedPicks} from '../../red-steps.mjs';

/** A real runner whose pick holds a step name that no step has any more; `after` runs once the renamed step has passed. */
async function renamedPickRun(t, after = async () => {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'renamed-pick-'));
  const previous = process.env.E2E_STEP_NAMES;
  process.env.E2E_STEP_NAMES = JSON.stringify(['checking jobs before the form read exists reads nothing']);
  t.after(() => { fs.rmSync(dir, {recursive: true, force: true}); if (previous === undefined) delete process.env.E2E_STEP_NAMES; else process.env.E2E_STEP_NAMES = previous; });
  const lines = [];
  t.mock.method(console, 'log', line => lines.push(String(line)));
  t.mock.method(console, 'error', () => {});
  const runner = createRunner(() => null);
  await runner.run('checking jobs before the form read guesses no mode', async () => {});   // the renamed step: it exists, under its new name
  assert.deepEqual(runner.results.map(result => result.status), ['passed'], 'positive control: no step failed, the only red is the stale pick, as in run 42451945200');
  await after(runner);
  return {dir, runner, lines, records: () => JSON.parse(fs.readFileSync(path.join(dir, 'suite-failures.json'), 'utf8'))};
}

test('a pick whose step was renamed leaves the runner record in suite-failures.json, so the whole-suite fallback runs', async t => {
  const run = await renamedPickRun(t);
  assert.equal(finishSuite('apply', {ARTIFACTS: run.dir, runner: run.runner}, {}, true), 1, 'the runner still reports the stale pick as a red');
  assert.equal(onlyRenamedPicks(run.records()), true, `suite-failures.json held ${JSON.stringify(run.records())}`);
});

test('the stale-pick record prints no ::error line (the fallback prints its own notice and the job ends green)', async t => {
  const run = await renamedPickRun(t);
  finishSuite('apply', {ARTIFACTS: run.dir, runner: run.runner}, {GITHUB_ACTIONS: 'true'}, true);
  assert.deepEqual(run.lines.filter(line => line.startsWith('::error')), []);
});

test('a suite that stopped early (a quiet stop after a hung suspended step) is no rename: the file stays without the record and the leg stays red', async t => {
  const ctx = {};
  const run = await renamedPickRun(t, async runner => {
    ctx.runner = runner;
    stopCode(Object.assign(new Error('hung'), {suspendedStop: true, stoppedBecause: 'hung'}), 'apply', ctx);
  });
  assert.equal(finishSuite('apply', {ARTIFACTS: run.dir, runner: run.runner}, {}, false), 1, 'summary() still counts the unreached pick as a red');
  assert.equal(onlyRenamedPicks(run.records()), false, `suite-failures.json held ${JSON.stringify(run.records())}`);
});
