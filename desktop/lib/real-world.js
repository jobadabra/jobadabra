// Under `node --test` the real world is off: opening a browser or reading the owner's tabs throws unless the test handed in its own fake (the one place; owner's coordinator, 7 Nov 2026).

/** True in a file run by `node --test` (Node sets NODE_TEST_CONTEXT in it); a person's app and the e2e apps have no such variable. */
export const underTest = (env = process.env) => !!env.NODE_TEST_CONTEXT;

/**
 * -> `run`, except that under a test it throws instead of running: for the DEFAULT of a launcher (a browser, osascript on the owner's Chrome), never for an injected fake.
 * Why (7 Nov 2026, two escapes in 10 minutes): a test of mine drove the applyOne handler, which called the real apply.applyOne, and opened 3 tabs in the owner's real Chrome; earlier the same
 * day a test reached the owner's app on port 47111. `what` names the launch in the error so the test author knows which fake to hand in. Guard: test/guards/safety/real-world-off-under-test.test.js.
 */
export function guarded(run, what, env = process.env) {
  return (...args) => {
    if (underTest(env)) throw new Error(`${what}: refused under a test (it would reach the real browser); hand in a fake`);
    return run(...args);
  };
}
