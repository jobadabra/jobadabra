// A step that hangs says which of its waits ran out and what it last saw, so a "hung" red carries the state it waited for (apply-1of3, run 41412195017).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';

// The runner reads the suite's artifacts folder once, at import: point it at a temp folder first (each test file is its own process).
process.env.E2E_ARTIFACTS = fs.mkdtempSync(path.join(os.tmpdir(), 'hang-names-wait-'));
const {withLimit} = await import('../../lib/runner.mjs');
const {pollUntil, stepTimeLeft} = await import('../../lib/wait-on-state.mjs');
const never = () => new Promise(() => {});

// Run 41412195017: the chip wait ran out 2 s before the step's cap; the step's own message ("the chip never showed the form read | chips…") came after its
// cleanup, so the runner's "it hung: the window answers, the main process answers" was all the red said. The chip had read "Not checked" 556 times.
test('a hang names the step\'s wait that ran out and the last value it read', async () => {
  const step = async () => {
    await pollUntil(async () => 'Not checked', chip => chip !== 'Not checked', {capMs: stepTimeLeft(), tickMs: 5, log: () => {}, what: 'the chip showed the form read'});
    await never();   // the step's failure path and cleanup, still running when its cap ends
  };
  // Started as the runner starts a step (lib/runner.mjs): after withLimit has set its clock.
  await assert.rejects(withLimit(Promise.resolve().then(step), 30, 'x'), error => {
    assert.match(error.message, /^the step did not finish within 0\.03 s \(it hung\): no app session \| its last wait that ran out: the chip showed the form read, last seen "Not checked"$/);
    return true;
  });
});

test('a hang with no wait run out keeps its old message; a wait from the step before is not named', async () => {
  await assert.rejects(withLimit(never(), 30, 'x'), error => { assert.equal(error.message, 'the step did not finish within 0.03 s (it hung): no app session'); return true; });
});
