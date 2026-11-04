// The one slot for connection pop-ups (owner, 2 Nov 2026: "I don't want to overwhelm the user"; spec docs/superpowers/specs/2026-11-02-notify-moments-design.md): Gmail (pages/gmail-offer.js), Always on
// (pages/hosted-moment.js) and the notification pop-ups offer themselves here; at most ONE opens per app run. Guard: test/unit/renderer/popup-slot.test.js.
// Invariant: a pop-up's "shown once" is written inside its own open(), so one that loses (or does not show) comes back at a later app open, never lost.

export const WINDOW_MS = 5000;   // Why (2 Nov 2026): the moments are noticed within seconds of each other at start (the window asks 3 s after load); wait for all of them, then the highest rank wins

/**
 * -> {offer({id, rank, open})}. `open()` resolves true when it showed its dialog. After a collection window the offers are tried from the highest rank down until one shows; from then on
 * `offer` returns false (no second pop-up this run). A tie in rank goes to the one offered first. Everything else is injectable for tests.
 */
export function createPopupSlot({setTimer = (fn, ms) => setTimeout(fn, ms), windowMs = WINDOW_MS} = {}) {
  let candidates = [], armed = false, used = false;
  async function decide() {
    armed = false;
    const order = candidates.map((candidate, index) => ({...candidate, index})).sort((a, b) => b.rank - a.rank || a.index - b.index);
    candidates = [];
    for (const candidate of order) {
      let shown = false;
      try { shown = await candidate.open(); } catch { shown = false; }
      if (shown) { used = true; return; }
    }
  }
  return {
    offer({id, rank, open}) {
      if (used) return false;
      candidates = candidates.filter(candidate => candidate.id !== id);
      candidates.push({id, rank, open});
      if (!armed) { armed = true; setTimer(decide, windowMs); }
      return true;
    },
  };
}

/** The app's slot: every pop-up page offers itself to this one. */
export const slot = createPopupSlot();
