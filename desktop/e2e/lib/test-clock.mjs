// A node:test test under one clock: its waits end before it does, and a hang names the stage it was in and the last wait that ran out.
// Job: wait on state
import {lastWaitRunOut, stepClock, stepTimeLeft} from './wait-on-state.mjs';

// Why (2 Nov 2026, a8; integration run 41458837502): "a sign-up page before the form" said only "test timed out after 100000ms". Its waits' own caps (60 + 20 + 30 s)
// outran the test's 100 s, so node:test's timeout fired first and none of them named what it last saw. The e2e runner gives each step this clock (lib/runner.mjs
// withLimit); this gives an integration test the same one, without the runner's suite artifacts.
let stage = '';

/** Names what the running test does now ("opening the page", "waiting for the fill"); a hang reports the last one. */
export const at = what => { stage = what; };

/** A wait's cap, cut to the time the running test has left (its own cap when no test clock runs). */
export const capOf = ms => Math.min(ms, stepTimeLeft() ?? ms);

/**
 * Wraps a test body: its waits run on a clock that ends at `ms`, and at `ms` it rejects with the stage and the last wait that ran out. Give node:test a timeout
 * above `ms` (a backstop only). A hung body keeps running after the reject, as an e2e step's does; its file's `after` closes what the run opened.
 */
export function clocked(ms, body) {
  return async (...args) => {
    let timer;
    stepClock(ms);
    stage = 'starting';
    // Why: a hang guard, not a wait; it ends the test at its cap with the evidence (e2e-harness rule 1).
    const cap = new Promise((_, fail) => { timer = setTimeout(() => {
      const ran = lastWaitRunOut();
      fail(new Error(`the test did not finish within ${ms / 1000} s (it hung) while ${stage} | ${ran ? `its last wait that ran out: ${ran.what || 'a state wait'}, last seen ${JSON.stringify(ran.value).slice(0, 400)}` : 'no wait ran out: a call with no cap of its own hung'}`));
    }, ms); });
    try { return await Promise.race([body(...args), cap]); } finally { clearTimeout(timer); stepClock(null); }
  };
}
