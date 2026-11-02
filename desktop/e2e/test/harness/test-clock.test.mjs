// A node:test test under one clock (lib/test-clock.mjs): its waits end before it does, and a hang names where it was and the last wait that ran out.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {at, capOf, clocked} from '../../lib/test-clock.mjs';
import {pollUntil, stepTimeLeft} from '../../lib/wait-on-state.mjs';

const never = () => new Promise(() => {});

// Run 41458837502 (integration, extension): "a sign-up page before the form" said only "test timed out after 100000ms"; its waits' own caps (60 + 20 + 30 s)
// outran the test's 100 s, so none of them got to name what it last saw.
test('a hang names the stage it was in and the last wait that ran out, before the runner\'s own timeout', async () => {
  const body = clocked(60, async () => {
    at('waiting for the fill');
    await pollUntil(async () => 'filling', state => state === 'done', {capMs: capOf(1000), tickMs: 5, log: () => {}, what: 'the extension finished filling'});
    at('waiting for the account decisions');
    await never();
  });
  await assert.rejects(body(), error => {
    assert.match(error.message, /^the test did not finish within 0\.06 s \(it hung\) while waiting for the account decisions \| its last wait that ran out: the extension finished filling, last seen "filling"$/);
    return true;
  });
});

test('a hang outside any wait says so; a test that ends in time keeps its own result and leaves no clock behind', async () => {
  await assert.rejects(clocked(30, async () => { at('opening the page'); await never(); })(), /within 0\.03 s \(it hung\) while opening the page \| no wait ran out: a call with no cap of its own hung$/);
  assert.equal(await clocked(5000, async () => 'done')(), 'done');
  await assert.rejects(clocked(5000, async () => { throw new Error('its own failure'); })(), {message: 'its own failure'});
  assert.equal(stepTimeLeft(), undefined, 'the clock ends with the test');
  assert.equal(capOf(60000), 60000, 'with no test clock a wait keeps its own cap');
});

test('a wait\'s own cap is cut to the time the test has left', async () => {
  await clocked(10000, async () => {
    const cap = capOf(60000);
    assert.ok(cap <= 10000 && cap > 5000, `cap ${cap}`);
  })();
});
