// One Runtime.evaluate on a page or worker over its debug socket, for tests: resolves the value, rejects with the page's own words when CDP answers an error.
// Job: wait on state
// Why (12 Nov 2026, #3880 run 43219115692): CDP answers an evaluate whose page was replaced mid-measure with {error: "Inspected target navigated or closed"} and no result; reading
// `row.result?.result?.value` turned that into undefined, so a page's `frames` went missing and the assert read it as "not drawing" (measured on a local Chromium, 12 Nov 2026).
// Three tests each kept their own copy of this function; they share this one now.
import {capOf} from './test-clock.mjs';

/**
 * Evaluate `expression` (awaiting a promise) in the target behind `socketUrl` -> its value. A socket that closes or says nothing for 15 s rejects (a hang guard, never a verdict),
 * and so does a CDP error or an exception in the page: the message names it. Invariant: never resolves undefined for an error.
 */
export function evaluate(socketUrl, expression) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(socketUrl);
    const fail = why => { clearTimeout(guard); socket.close(); reject(new Error(`${why}: ${socketUrl}`)); };
    const guard = setTimeout(() => fail('no answer in time'), capOf(15000));
    socket.onerror = () => fail('no connection');
    socket.onclose = () => fail('closed before answering');
    socket.onopen = () => socket.send(JSON.stringify({id: 1, method: 'Runtime.evaluate', params: {expression, awaitPromise: true, returnByValue: true}}));
    socket.onmessage = event => {
      const row = JSON.parse(event.data);
      if (row.id !== 1) return;
      clearTimeout(guard); socket.onclose = null; socket.close();
      const failure = row.error?.message || row.result?.exceptionDetails?.exception?.description || row.result?.exceptionDetails?.text;
      if (failure) reject(new Error(`the page said "${String(failure).split('\n')[0]}": ${socketUrl}`));
      else resolve(row.result?.result?.value);
    };
  });
}
