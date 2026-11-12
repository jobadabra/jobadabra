// Pre-started `claude -p` processes for the app's AI questions: the app mirror of src/ai/providers/warm.py. A `claude -p` takes ~2 s to start
// before it can read a prompt, so a process is started for a question while it waits for its turn, and one more stays ready for the next
// (apply-latency change 2, 11 Oct 2026: 1.1-1.7 s instead of 2.6-3.3 s for a page-kind ask).
// Why (as, 12 Nov 2026; owner: "if no activity at all, we hsould always have 1 session active. if we're getting more and more calls, we add
// 2 .. 3... on the fly" · "And then we downscaling when the load fades away" · "let's make sure we cover all AI calls"): before, only the page's
// questions had one spare per kind of question, started after an answer; every other app ask, and a burst, started cold.
// Invariants:
// - ONE process per question: a spare answers one prompt and exits, it never sees an earlier question (a long-lived process was rejected).
// - A spare is used only for a question with exactly its command line (the key): same model, system prompt, schema, flags.
// - Spares per key: at least 1 for the key asked last, plus one for each question of that key waiting for its process, never more than `max`
//   in all; the others end after `idleMs` without a question. A spare older than `maxAgeMs` is replaced, never used.
// - All are killed when the app exits. Guard: test/unit/main/cli-spares.test.js.
export function sparePool({max = 4, idleMs = 30000, maxAgeMs = 600000, now = Date.now} = {}) {
  const spares = new Map();    // key -> [{child, born}], oldest first
  const waiting = new Map();   // key -> questions asked that have no process yet
  const starts = new Map();    // key -> start(): a new child for that key
  let last = null, timer = null, hooked = false;
  const total = () => [...spares.values()].reduce((sum, list) => sum + list.length, 0);
  const end = spare => { try { spare.child.kill('SIGKILL'); } catch { /* already gone */ } };
  const alive = spare => spare.child.exitCode === null && !spare.child.killed;
  const evict = keep => {   // the oldest spare of another key makes room; false when only `keep`'s are left
    let oldest = null;
    for (const [key, list] of spares) if (key !== keep && list.length && (!oldest || list[0].born < oldest[0].born)) oldest = list;
    if (!oldest) return false;
    end(oldest.shift());
    return true;
  };
  const clear = () => { clearTimeout(timer); for (const list of spares.values()) while (list.length) end(list.pop()); };
  const topUp = (key, want) => {
    const list = spares.get(key) || [];
    spares.set(key, list);
    while (list.length < Math.min(want, max)) {
      if (total() >= max && !evict(key)) return;
      let child;
      try { child = starts.get(key)(); } catch { return; }   // the question starts its own process and says why, as before
      const spare = {child, born: now()};
      if (!alive(spare)) return;   // it died at once: the question starts its own
      const drop = () => { const at = list.indexOf(spare); if (at >= 0) list.splice(at, 1); };
      child.on?.('error', drop);
      child.on?.('exit', drop);
      list.push(spare);
    }
    if (!hooked) { hooked = true; process.once('exit', clear); }
  };
  const trim = () => {   // the load faded: 1 for the key asked last (plus any still waiting), none for the others
    for (const [key, list] of spares) {
      const keep = Math.max(key === last ? 1 : 0, waiting.get(key) || 0);
      while (list.length > keep) end(list.pop());
    }
  };
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(trim, idleMs);
    timer.unref?.();
  };
  return {
    // A question of this key is coming (before it waits for its turn): start the processes it and the others waiting need.
    asked(key, start) {
      starts.set(key, start);
      waiting.set(key, (waiting.get(key) || 0) + 1);
      last = key;
      topUp(key, waiting.get(key));
      arm();
    },
    // The question has its turn: a live, young started process for it, or null (it then starts its own as before). The next one starts now.
    take(key) {
      if (!starts.has(key)) return null;
      waiting.set(key, Math.max(0, (waiting.get(key) || 0) - 1));
      const list = spares.get(key) || [];
      let found = null;
      while (list.length && !found) {
        const spare = list.shift();
        if (alive(spare) && now() - spare.born < maxAgeMs) found = spare.child;
        else end(spare);
      }
      topUp(key, Math.max(1, waiting.get(key)));
      return found;
    },
    // A question that asked but will not take (it failed before its turn).
    gone(key) { waiting.set(key, Math.max(0, (waiting.get(key) || 0) - 1)); },
    size: () => total(),
    trim,
    clear,
  };
}
