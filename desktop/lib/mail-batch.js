// The one batching window the app's own mail senders share (lib/waiting-message.js, lib/applied-message.js; Gitar on #3614: the window was copied, so a fix such as #3008's re-arm race would have been made twice).
// `add(item)` queues an item by id; `delay()` after the first one, `send(items)` gets everything queued meanwhile as one batch. Invariants: at most one send in flight; an item that comes while a send is in flight
// waits for the next window, armed with the fresh `delay()` once the send ends (Why (#3008, Gitar, 2 Nov 2026): arming during a send counted from stale state and sent a second message ~60 s later); a send that throws is logged and dropped, never unhandled.
const unref = timer => { timer?.unref?.(); return timer; };

/** The default timer: a real one that never keeps the app alive. Tests inject their own. */
export const defaultTimer = (fn, ms) => unref(setTimeout(fn, ms));

/** -> {add(item)}: `item.id` keys the queue (an id queued twice before the window ends is one item, the later wins). `send(items)` may be async; `log(area, message, fields)` hears a failed send. */
export function createBatchWindow({delay, send, log, setTimer = defaultTimer}) {
  const pending = new Map();
  let timer = null, sending = false;
  const arm = () => { if (!timer && !sending && pending.size) timer = setTimer(flush, delay()); };
  async function flush() {
    timer = null; sending = true;
    const items = [...pending.values()];
    pending.clear();
    try { if (items.length) await send(items); } catch (error) { log('apply', `mail batch not sent: ${error.message}`); } finally { sending = false; arm(); }
  }
  return {add(item) { pending.set(item.id, item); arm(); }};
}

/** One instance per app profile: `forStorage(storage)` builds with `make(storage)` the first time and returns the same one after. */
export function perStorage(make) {
  const instances = new WeakMap();
  return storage => { if (!instances.has(storage)) instances.set(storage, make(storage)); return instances.get(storage); };
}
