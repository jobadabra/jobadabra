// A node:test test under one clock: its waits end before it does, and a hang names the stage it was in and the last wait that ran out.
// Job: wait on state
import {AsyncLocalStorage} from 'node:async_hooks';
import {lastWaitRunOut, stepClock, stepTimeLeft} from './wait-on-state.mjs';

// Why (2 Nov 2026, a8; integration run 41458837502): "a sign-up page before the form" said only "test timed out after 100000ms". Its waits' own caps (60 + 20 + 30 s)
// outran the test's 100 s, so node:test's timeout fired first and none of them named what it last saw. The e2e runner gives each step this clock (lib/runner.mjs
// withLimit); this gives an integration test the same one, without the runner's suite artifacts.
// Why (2 Nov 2026, Gitar on #2996): each test keeps its own stage and its own list of what it opened, so a hung body that wakes later writes to its own test, never the next one.
const running = new AsyncLocalStorage();

// Why (2 Nov 2026, #2996): the time a hung test gets to close what it opened; a browser's process tree ends in ~3.5 s on a loaded runner (lib/real-extension.mjs close), so 10 s is ~3x.
export const CLOSE_MS = 10000;

/** Names what the running test does now ("opening the page", "waiting for the fill"); a hang reports the last one. Outside a clocked test it does nothing. */
export const at = what => { const test = running.getStore(); if (test) test.stage = what; };

/**
 * Registers how to close something the running test opened (its own browser, a page). On a hang the clock closes them all at once (newest first), so the hung call ends and its
 * browser does not hold the file open until the file's limit; the body's own `finally` may close it again (a close must be safe to repeat). Outside a clocked test it does nothing.
 * Shape: startRealExtension({..., onCleanup: onHang}), or onHang(() => page.close()).
 */
export const onHang = close => { running.getStore()?.closers.push(close); };

/** A wait's cap, cut to the time the running test has left (its own cap when no test clock runs). */
export const capOf = ms => Math.min(ms, stepTimeLeft() ?? ms);

// Why (2 Nov 2026, Gitar on #2996): a wedged browser, the likely reason a test hung, can leave a close that never settles (page.close, context.close have no cap of
// their own), so every close races the one CLOSE_MS deadline; one that runs out is named, and the hang message still reaches the run before node's backstop. They all
// start at once (newest first), so a stuck page close never spends the time the browser's own end needs.
async function closeAll(closers, closeMs) {
  let timer;
  // Why: a hang guard, not a wait (e2e-harness rule 1).
  const late = new Promise(resolve => { timer = setTimeout(resolve, closeMs); }).then(() => `a close did not end within ${closeMs / 1000} s`);
  const ended = [...closers].reverse().map(close => Promise.resolve().then(close).then(() => '', error => error?.message || String(error)));
  try { return (await Promise.all(ended.map(end => Promise.race([end, late])))).filter(Boolean); } finally { clearTimeout(timer); }
}

/**
 * Wraps a test body: its waits run on a clock that ends at `ms`, and at `ms` it closes what the test registered with `onHang` (within CLOSE_MS) and rejects with
 * the stage and the last wait that ran out. Give node:test a timeout above `ms` + CLOSE_MS (a backstop only). A body that ends by itself closes its own things.
 * `closeMs` is injectable for the unit test.
 */
export function clocked(ms, body, {closeMs = CLOSE_MS} = {}) {
  return async (...args) => {
    let timer;
    const test = {stage: 'starting', closers: []};
    stepClock(ms);
    // Why: a hang guard, not a wait; it ends the test at its cap with the evidence (e2e-harness rule 1).
    const cap = new Promise((_, fail) => { timer = setTimeout(async () => {
      const ran = lastWaitRunOut();
      const said = `the test did not finish within ${ms / 1000} s (it hung) while ${test.stage} | ${ran ? `its last wait that ran out: ${ran.what || 'a state wait'}, last seen ${JSON.stringify(ran.value).slice(0, 400)}` : 'no wait ran out: a call with no cap of its own hung'}`;
      stepClock(closeMs);
      const failed = await closeAll(test.closers, closeMs);
      fail(new Error(failed.length ? `${said} | closing what it opened failed: ${failed.join('; ')}` : said));
    }, ms); });
    try { return await Promise.race([running.run(test, () => body(...args)), cap]); } finally { clearTimeout(timer); stepClock(null); }
  };
}
