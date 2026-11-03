// Our AI and its lines, as the Anthropic API engine (anthropic-api.js) meets them on a Free AI key: before a call, a line already reached (the gate main sets,
// lib/ai-caps.js) stops it at once; a refused call (429/503) is heard. The listeners (main: lib/app-allowance.js) open the top-up dialog or ask the site which line.
// Nothing else here: no retry, no wording. Guard: test/ai-caps.test.js.
const listeners = new Set();
let gate = () => null;

export const onRefused = listener => { listeners.add(listener); return () => listeners.delete(listener); };
export const setGate = fn => { gate = typeof fn === 'function' ? fn : () => null; };

// The line reached now -> {capped, message, resetsAt} or null; never throws.
export function capNow() {
  try { return gate() || null; } catch { return null; }
}

// A call refused by the site ({status}) or stopped here by a known line ({status: 429, cap}).
export function heard(error, cap = null) {
  if (!cap && ![429, 503].includes(error?.status)) return;
  for (const listener of listeners) { try { listener({status: error?.status || 429, cap}); } catch { /* a listener never breaks the caller's error */ } }
}

// The user's OWN API key, as the provider answered it: a 401 means "this key does not work", a good answer means it does. One owner for that verdict
// (lib/ai-key-health.js listens): every AI step goes through an adapter, so one rejected call tells Settings → Connections and the window, not each card.
const verdicts = new Set();
/** Listens for the user's own key verdicts: listener({engine, apiKey, ok}). Returns the stop function. */
export const onKeyVerdict = listener => { verdicts.add(listener); return () => verdicts.delete(listener); };
const tell = verdict => { for (const listener of verdicts) { try { listener(verdict); } catch { /* a listener never breaks the caller's error */ } } };
/** An adapter's failed call: a 401 on a key means the provider refused it (other errors say nothing about the key). Never throws. */
export function keyHeard(engine, apiKey, error) {
  if (error?.status === 401 && apiKey) tell({engine, apiKey, ok: false});
}
/** An adapter's good answer with this key: the provider accepts it. Never throws. */
export const keyWorked = (engine, apiKey) => { if (apiKey) tell({engine, apiKey, ok: true}); };
