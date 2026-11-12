// The one owner, in the window, of "scores are arriving after a Find jobs run": which found jobs are in the queue, which are being scored now, how many are past it.
// Fed only by the engine's own lines as the app relays them (src/daily_modes.py score_mode: "Check queue: {json}", "Score queue: {json}", "Scoring now: codes"; lib/pipeline-tasks.js
// SCORE_QUEUE_END when the run ended, however it ended; a new search's first line also ends it). The Jobs list READS it to draw a row's circle (queued, scoring) and the bar above the list; nothing else
// keeps a copy. Why (11 Nov 2026, owner, asked via AskUserQuestion: "One by one, row stays (Recommended)" and, on the picture, "Yes, build it (Recommended)").
// Guarded by test/unit/renderer/score-queue.test.js.
let held = null;    // Map(job url -> its place in the list when the queue began): rows keep their place while scores land, until the person re-sorts
let state = null;   // {queue: [job codes, the engine's order], now: [codes in the round asked now], left: jobs past the queue} while a queue runs, else null
let check = null;   // {waiting: jobs the search read and had no time to judge, done: judged so far} while the queue checks them, before its scores, else null
const changed = () => globalThis.document?.dispatchEvent(new Event('score-queue-state'));

/** One line about the check before the scores (src/press/after_search.py) -> true when it changed the state, false when it changed nothing, null for any other line.
 * A count only, never rows (owner, 12 Nov 2026, asked via AskUserQuestion: "Yes, one bar, a count (Recommended)"). */
function checkLine(text) {
  if (text === 'Check queue: done') { if (!check) return false; check = null; changed(); return true; }
  const checking = /^Check queue: (\{.*\})$/.exec(text);
  if (!checking) return null;
  let said;
  try { said = JSON.parse(checking[1]); } catch { return false; }
  const waiting = Number(said.waiting) || 0;
  check = waiting > 0 ? {waiting, done: Math.min(waiting, Number(said.done) || 0)} : null;
  changed();
  return true;
}
/** Take one log line -> true when it changed the queue's state (the caller redraws the list). Any other line changes nothing. */
export function scoreQueueLine(line) {
  const text = String(line);
  if (text === 'Score queue: done') { if (!state && !check) return false; state = null; check = null; changed(); return true; }
  const checked = checkLine(text);
  if (checked !== null) return checked;
  // A new search: whatever queue ran before it is over (lib/pipeline-tasks.js refresh stops it), and its jobs take the order the person chose, not the held one.
  if (/^Searching job boards/.test(text)) { const was = state || held || check; state = null; held = null; check = null; if (was) changed(); return !!was; }
  const told = /^Score queue: (\{.*\})$/.exec(text);
  if (told) {
    let said;
    try { said = JSON.parse(told[1]); } catch { return false; }
    const queue = Array.isArray(said.queue) ? said.queue.map(String) : [];
    state = queue.length ? {queue, now: [], left: Number(said.left) || 0} : null;
    held = null;   // a new queue: the list's order now is the one to keep
    changed();
    return true;
  }
  const round = /^Scoring now: (\S+)$/.exec(text);
  if (round && state) { state = {...state, now: round[1].split(',')}; changed(); return true; }
  return false;
}
/** Whether a queue runs now, in either step (checking, scoring): the list offers no second start meanwhile. */
export function queueRuns() { return !!(state || check); }
/** The check running now -> {waiting, done} for the bar above the list, or null when the queue is not checking. */
export function checkQueue() { return check ? {...check} : null; }
/** The queue running now -> {total, done, left} for the bar above the list, or null when none runs. done: the jobs of the rounds before the one asked now. */
export function scoreQueue() {
  if (!state) return null;
  const at = state.now.length ? state.queue.indexOf(state.now[0]) : 0;
  return {total: state.queue.length, done: Math.max(0, at), left: state.left};
}
/** One unscored job's place -> {state: 'scoring'} | {state: 'queued', place: n (1 = next)} | null (not in the queue, or no queue runs). */
export function queuePlace(code) {
  if (!state || !code) return null;
  const at = state.queue.indexOf(String(code));
  if (at < 0) return null;
  if (state.now.includes(String(code))) return {state: 'scoring'};
  const first = state.now.length ? state.queue.indexOf(state.now[state.now.length - 1]) + 1 : 0;   // the first job after the round asked now
  return at >= first ? {state: 'queued', place: at - first + 1} : null;   // before it: asked in an earlier round, its score is on its way into the list
}
/**
 * The list's rows in the order they had when the queue began, so a row does not jump when its score lands (owner, 11 Nov 2026: "One by one, row stays").
 * Held from the first draw of a running queue until releaseOrder (the person re-sorts), the next queue or the next search; a row that was not listed then goes after the held ones.
 */
export function heldOrder(rows) {
  if (!state && !held) return rows;
  held = held || new Map(rows.map((row, place) => [row.url, place]));
  return [...rows].sort((a, b) => (held.get(a.url) ?? Infinity) - (held.get(b.url) ?? Infinity) || 0);
}
/** The person chose an order (the sort menu): the list is sorted again as they asked. */
export function releaseOrder() { held = null; }
