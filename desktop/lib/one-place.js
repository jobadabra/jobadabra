// Whether our servers really run this person's search right now, so this Mac's own scheduled search stands down (owner, 6 Nov 2026: "Yes, one place searches").
// Why not a saved flag: the servers pause (trial over, budget, limit) or cannot be reached, and a Mac that stood down then would lose the person's searches.
// So it is asked at the moment the search is due; no answer, a pause or an error all mean "this Mac searches".
import * as hosted from './hosted-search.js';

let last = null;   // the latest answer, so Activity and Runs show the servers' next search without a network call: {next, at}
const FRESH_MS = 30 * 60 * 1000;
/** When our servers search next (ms), from the latest answer while they run the search; null when they do not, or it is old. Why (6 Nov 2026, review): the Mac's own next time stays at its last search + 4 h, a past time, once it stands down. */
export const serversNextAt = (now = Date.now()) => (last && now - last.at < FRESH_MS && Date.parse(last.next) > 0 ? Date.parse(last.next) : null);
const HANG_MS = 4000;   // Why (6 Nov 2026): hosted-search call() has no timeout and the scheduler awaits this inside its busy lock; a hung answer must not stop Gmail and every later check (isOpen guards the same way)

/** True when Always on "on our servers" is on and its schedule is running (not paused). Guarded by test/unit/main/one-place-searches.test.js. */
export async function serversRunSearch(storage, {schedule = hosted.schedule, hangMs = HANG_MS} = {}) {
  if (!storage.settings().hostedSearch?.on) { last = null; return false; }
  let timer;
  try {
    const got = await Promise.race([schedule(storage), new Promise(resolve => { timer = setTimeout(() => resolve(null), hangMs); })]);
    const covered = !!got && got.state !== 'paused';
    last = covered ? {next: got.next_run_at, at: Date.now()} : null;
    return covered;
  } catch { last = null; return false; } finally { clearTimeout(timer); }
}
