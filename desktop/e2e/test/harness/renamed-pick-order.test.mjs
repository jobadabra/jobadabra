// Guard: release — a picked step renamed since the coverage map goes red on main instead of running the whole suite (apply red after #3579, 8 Nov 2026).
// Plays the real order of writes: the file e2e.yml's fallback reads (suite-failures.json) is written when the suite closes, and must already hold the runner's lost-pick record.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createRunner} from '../../lib/runner.mjs';
import {finishSuite} from '../../lib/suite-main.mjs';
import {onlyRenamedPicks} from '../../red-steps.mjs';

test('a pick whose step was renamed leaves the runner record in suite-failures.json, so the whole-suite fallback runs', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'renamed-pick-'));
  const previous = process.env.E2E_STEP_NAMES;
  process.env.E2E_STEP_NAMES = JSON.stringify(['checking jobs before the form read exists reads nothing']);
  t.after(() => { fs.rmSync(dir, {recursive: true, force: true}); if (previous === undefined) delete process.env.E2E_STEP_NAMES; else process.env.E2E_STEP_NAMES = previous; });
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
  const runner = createRunner(() => null);
  await runner.run('checking jobs before the form read guesses no mode', async () => {});   // the renamed step: it exists, under its new name
  assert.deepEqual(runner.results.map(result => result.status), ['passed'], 'positive control: no step failed, the only red is the stale pick, as in run 42451945200');
  const code = finishSuite('apply', {ARTIFACTS: dir, runner}, {});
  assert.equal(code, 1, 'the runner still reports the stale pick as a red');
  const records = JSON.parse(fs.readFileSync(path.join(dir, 'suite-failures.json'), 'utf8'));
  assert.equal(onlyRenamedPicks(records), true, `suite-failures.json held ${JSON.stringify(records)}`);
});
