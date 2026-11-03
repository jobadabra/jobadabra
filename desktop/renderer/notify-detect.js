// What the window itself can tell happened while the person was away (spec docs/superpowers/specs/2026-11-02-notify-moments-design.md, 2/2): a strong match from a scheduled search, Gmail updates, a
// recruiter waiting. Pure; each claim is true or not made (no stamps, a search the person ran themselves, a failed check, an older job: null). Guard: test/notify-detect.test.js.

/** Whether something that ended at `endedAt` happened while the person was away: after they left (`seenAt`, lib/window-seen.js) and before they came back (`backAt`). Missing stamps, or a last stamp that is a leave (away right now), claim nothing. */
export function wasAway(seenAt, backAt, endedAt) {
  const left = Date.parse(seenAt), back = Date.parse(backAt), ended = Date.parse(endedAt);
  return [left, back, ended].every(Number.isFinite) && back > left && ended > left && ended < back;
}

export const MATCH_FIT = 85;   // Why (2 Nov 2026, owner: "Build all four"): a strong match; the app's "high" band starts at 70, a pop-up for a match is worth the interruption from 85

const newest = runs => [...(runs || [])].sort((a, b) => Date.parse(b.endedAt || 0) - Date.parse(a.endedAt || 0))[0];
const finished = (runs, wanted) => newest((runs || []).filter(run => wanted(run) && run.ok !== false && !run.off && run.endedAt));

/** -> {fit, title, company, endedAt} of the best new job (fit ≥ MATCH_FIT) of the last scheduled search that ended while the person was away, or null. A job is "new" only when its first-seen time
 *  (a full UTC timestamp, src/store.py _now) is after the run started: a job found earlier the same day, or one with a date alone, is not claimed (Gitar on #3022: each claim is true or not made). */
export function matchWhileAway({runs, jobs, seenAt, backAt, minFit = MATCH_FIT}) {
  const run = finished(runs, item => (!item.kind || item.kind === 'search') && item.trigger === 'schedule');
  if (!run || !wasAway(seenAt, backAt, run.endedAt)) return null;
  const started = Date.parse(run.startedAt || run.endedAt);
  const seenAfter = job => /T/.test(String(job.first_seen_at || '')) && Date.parse(job.first_seen_at) >= started;
  const best = (jobs || []).filter(job => Number.isFinite(job?.fit) && job.fit >= minFit && seenAfter(job)).sort((a, b) => b.fit - a.fit)[0];
  return best ? {fit: best.fit, title: best.title || '', company: best.company || '', endedAt: run.endedAt} : null;
}

/** -> {count, endedAt} of the Gmail check that ended while the person was away, when it found application updates (the count lib/run-history.js notice() uses), or null. */
export function updatesWhileAway({runs, seenAt, backAt}) {
  const run = finished(runs, item => item.kind === 'mail');
  if (!run || !wasAway(seenAt, backAt, run.endedAt)) return null;
  const count = run.updates?.length ?? Number(/(\d+) update/.exec(run.result || run.summary || '')?.[1] || 0);
  return count ? {count, endedAt: run.endedAt} : null;
}

/** -> {count, company} when Focus holds "Reply today" cards (kind reply: a recruiter or employer waits for an answer), or null. */
export function recruiterWaiting(items) {
  const replies = (items || []).filter(item => item?.kind === 'reply');
  return replies.length ? {count: replies.length, company: replies[0].company || ''} : null;
}
