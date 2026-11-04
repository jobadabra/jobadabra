// When the person was away (spec docs/superpowers/specs/2026-11-02-notify-moments-design.md, 2/2): a pop-up says "while you were away" only for something that ended between the moment they left the app
// (the window lost focus, hid, minimized or closed) and the moment they came back (focus; the judgment is wasAway in renderer/notify-detect.js). `settings.windowSeenAt` (left) and `settings.windowBackAt` (back), written only here, each at most once a
// minute (lib/main-window.js wires the window's events). Guard: test/unit/main/window-seen.test.js.

const MIN_GAP_MS = 60 * 1000;

/** -> {left(), back()}: records that the person just left, or just came back. */
export function createWindowSeen(storage, {now = Date.now} = {}) {
  const lastAt = {};
  const stamp = (key, field) => () => {
    const at = now();
    if (at - (lastAt[key] || 0) < MIN_GAP_MS) return;
    lastAt[key] = at;
    storage.saveSettings({[field]: new Date(at).toISOString()});
  };
  return {left: stamp('left', 'windowSeenAt'), back: stamp('back', 'windowBackAt')};
}
