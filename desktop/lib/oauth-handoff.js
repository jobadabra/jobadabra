// The one place the app takes a sign-in or connect result from the website (Connect with Notion, Sign in with LinkedIn, Import from LinkedIn): the app makes a random `state`,
// opens the website with it, and waits; after the person consented, the website answers THEIR browser with a form that POSTs the result to this app's own socket (POST /<flow>/callback,
// lib/oauth-handoff-route.js; in the body, never in an address, so it stays out of the browser history) and receive() hands the fields to the waiting call, only for that `state`, once. Nothing is polled and the website keeps nothing.
// Why (3 Nov 2026, Gitar on web#336; owner: "Both now"): these flows used to poll the website with an id the app chose, and the website gave the result to whoever asked with that id, so a link
// carrying someone else's id could make a person's consent deliver their key (or name and e-mail) to that someone. A result that can only arrive on the consenting person's own machine, for a
// state only this app knows, has no one else to go to. Guard: test/unit/main/oauth-handoff.test.js (every flow).
import crypto from 'node:crypto';

export const FLOWS = ['notion-connect', 'linkedin-signin', 'linkedin-import'];   // the website's shared/oauth-handoff.js FLOWS: the same names
const MAX_FIELDS = 12, MAX_VALUE = 4096;

const waiting = new Map();   // flow -> {state, done, timer}: one consent per flow at a time; a new one cancels the old

/** Stop waiting for a flow (the person cancelled, or started again). */
export function cancel(flow) {
  const mine = waiting.get(flow);
  if (!mine) return;
  waiting.delete(flow);
  mine.done({ok: false, error: 'Cancelled.'});
}

/**
 * Start waiting for a flow. -> {state, result}: open the website with `state`; `result` resolves to {ok: true, fields} (the website's fields, without `state`) or {ok: false, error}
 * after `timeout` (`timeoutError` says what to do then) or a cancel. Optional synchronous `onFailureResult(answer, reason)` privately observes timeout/open failures only; its return is ignored.
 */
export function begin(flow, {timeout = 5 * 60 * 1000, timeoutError = 'The website didn\'t answer in 5 minutes. Try again.', onFailureResult} = {}) {
  if (!FLOWS.includes(flow)) throw new Error(`unknown hand-off flow: ${flow}`);
  cancel(flow);
  const state = crypto.randomBytes(32).toString('base64url');
  const result = new Promise(resolve => {
    const mine = {state, onFailureResult, done: answer => { clearTimeout(mine.timer); resolve(answer); },
      timer: setTimeout(() => { if (waiting.get(flow) === mine) waiting.delete(flow); resolve(failureResult(mine, {ok: false, error: timeoutError}, 'timeout')); }, timeout)};
    waiting.set(flow, mine);
  });
  return {state, result};
}

// Why (7 Nov 2026, multilanguage coordinator): optional presentation metadata must never prevent a canonical failure from resolving; it cannot receive success credentials or cancellation.
function failureResult(mine, answer, reason) {
  try { mine.onFailureResult?.(answer, reason); } catch { /* Private observers are optional; the original answer still resolves. */ }
  return answer;
}

/** Give up on a wait that never started (the browser would not open). */
export function fail(flow, error) {
  const mine = waiting.get(flow);
  if (!mine) return;
  waiting.delete(flow);
  mine.done(failureResult(mine, {ok: false, error}, 'open'));
}

/** The route's call: the form fields of POST /<flow>/callback (a URLSearchParams). -> true when it was the awaited one (taken once); anything else is dropped unread. */
export function receive(flow, query) {
  const mine = waiting.get(flow);
  const given = Buffer.from(String(query?.get?.('state') ?? '')), wanted = mine ? Buffer.from(mine.state) : null;   // bytes, not characters: a non-ASCII state must not make timingSafeEqual throw
  if (!wanted || given.length !== wanted.length || !crypto.timingSafeEqual(given, wanted)) return false;
  const fields = {};
  for (const [key, value] of query.entries()) {
    if (key === 'state') continue;
    if (Object.keys(fields).length >= MAX_FIELDS || value.length > MAX_VALUE) return false;
    fields[key] = value;
  }
  waiting.delete(flow);
  mine.done({ok: true, fields});
  return true;
}
