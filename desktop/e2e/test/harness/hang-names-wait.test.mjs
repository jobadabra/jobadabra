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

test('a hang with no wait run out keeps its old message', async () => {
  await assert.rejects(withLimit(never(), 30, 'x'), error => { assert.equal(error.message, 'the step did not finish within 0.03 s (it hung): no app session'); return true; });
});

// Gitar on #2986: a hung step's promise runs on after its cap (Promise.race cancels nothing), so its wait can run out while the next step runs.
test('a wait of a hung step that runs out during the next step is not named in that step\'s hang', async () => {
  const hungStep = async () => {
    await pollUntil(async () => 'Not checked', chip => chip !== 'Not checked', {capMs: 60, tickMs: 5, log: () => {}, what: 'the hung step\'s chip wait'});
    await never();
  };
  await assert.rejects(withLimit(Promise.resolve().then(hungStep), 30, 'x'), /it hung/);
  // The hung step's wait runs out at 60 ms, inside this step's 120 ms.
  await assert.rejects(withLimit(never(), 120, 'y'), error => { assert.equal(error.message, 'the step did not finish within 0.12 s (it hung): no app session'); return true; });
});

// Gitar on #2986: a read that never answers leaves pollUntil's starting value '', which "no read tab open" (and "not Not checked") would accept.
test('a read that never answers fails the read step, though its starting value would pass the check', async () => {
  const {readState} = await import('../../lib/apply-read-steps.mjs');
  await assert.rejects(readState('the read tab was never closed', never, open => !open.length, {capMs: 20, readGraceMs: 10, log: () => {}}), error => {
    assert.equal(error.message, 'the read tab was never closed');
    return true;
  });
});
