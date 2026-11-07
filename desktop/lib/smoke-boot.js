// How the smoke and probe runs know the window's app has finished starting (JOBADABRA_SMOKE: shot.mjs, integration/app probes): by its own state, never by a clock.
// Guard: test/unit/main/smoke-boot.test.js.

const BOOTED = 'Boolean(window.__jp)';

/**
 * Resolves when the window's app has finished starting: renderer/app.js awaits every page's init (the menu's click handlers among them) and sets `window.__jp` as its last line.
 * Rejects after `hangMs` with the last state seen; that limit is a hang guard (at least 3x a slow runner's boot), never the wait itself.
 * Why (7 Nov 2026, #3409 app (Linux) red twice on code that did not touch it, "hung waiting for the Profile page"): the probe ran 1.5 s after did-finish-load, a clock standing in for
 * "started"; on a loaded runner the menu was drawn (static markup) before its handlers were wired, the probe's click was lost and its wait never ended.
 * @param {{executeJavaScript: (code: string) => Promise<unknown>}} webContents
 * @param {{hangMs?: number, pollMs?: number, now?: () => number, sleep?: (ms: number) => Promise<void>}} [options] now and sleep are injected by the test
 */
export async function whenBooted(webContents, {hangMs = 60000, pollMs = 25, now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms))} = {}) {
  const hang = now() + hangMs;
  for (let last = 'no answer yet'; ;) {
    try { last = await webContents.executeJavaScript(BOOTED); if (last === true) return; } catch (error) { last = `threw ${error.message}`; }
    if (now() > hang) throw new Error(`the app did not finish starting (window.__jp is not set); last state: ${JSON.stringify(last)}`);
    await sleep(pollMs);   // a poll interval for a state that is not here yet, bounded by the hang guard
  }
}
