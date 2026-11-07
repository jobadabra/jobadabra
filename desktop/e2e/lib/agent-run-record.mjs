// The record of one AI persona run for the Admin "AI persona" tab: run.json (goals, steps, notes with where each sits in the video) and one PNG per note, built from a finished session.
// Job: report health
// Why (4 Nov 2026, AI user agents 9/12 part 2b, owner: "a dedicated tab in admin where I'll see all the runs/paths/bugs found… and video recording for each"): the record carries no image bytes, a note names its screenshot (shot-N.png)
// so the page loads pictures one at a time and the record stays far under the store's 1 MiB cap (jobadabra-web shared/agent-runs.js).

export const MAX_SHOTS = 99;   // the store accepts shot-1.png … shot-99.png
const wordsOf = (value, max) => String(value ?? '').slice(0, max);

/** The notes that have a picture, numbered in order: -> [{note, n}] (n = 1..MAX_SHOTS). A note past the cap keeps its words and has no picture. */
function numbered(notes) {
  let n = 0;
  return notes.map(note => ({note, n: note.image && n < MAX_SHOTS ? ++n : 0}));
}

/**
 * run.json for the store. `session`: what runSession returned; `meta`: {run (GitHub run id), at (ISO), kind ('night'|'replay'|'lane'), commit, plan}; `video`: agent-video.json's {secs, bytes, startedAt} or null.
 * -> a plain object: notes carry `shot` (the number of their picture, 0 = none), `videoSec`, `control` (the pressed control's box in the window), `judge`, `filed` and the last steps of their trail; no base64 anywhere.
 */
export function runRecord(session, meta, video = null) {
  const { summary, trace = [], notes = [] } = session;
  const filed = new Set(summary.filed);
  return {
    run: String(meta.run), at: meta.at, kind: meta.kind, commit: wordsOf(meta.commit, 12), plan: wordsOf(meta.plan, 40),
    persona: wordsOf(summary.persona, 80), seed: summary.seed, stopped: wordsOf(session.stopped, 200),
    goals: summary.goals.map(goal => ({n: goal.n, group: wordsOf(goal.group, 60), label: wordsOf(goal.label, 160), verdict: goal.verdict, summary: wordsOf(goal.summary, 240), steps: goal.steps, ...(goal.failover ? {failover: wordsOf(goal.failover, 160)} : {})})),
    notes: numbered(notes).map(({note, n}) => ({
      goal: note.goal, title: wordsOf(note.title, 160), type: note.type, kind: note.kind, severity: note.severity, view: wordsOf(note.view, 40),
      expected: wordsOf(note.expected, 600), observed: wordsOf(note.observed, 600), why: wordsOf(note.why, 600),
      judge: note.judge || '', judgeReason: wordsOf(note.judgeReason, 400), filed: filed.has(note), shot: n, videoSec: note.videoSec ?? null, control: note.control ?? null,
      trail: (note.trail || []).map(step => wordsOf(step, 200)),
    })),
    trace: trace.map(row => ({goal: row.goal, n: row.n, action: wordsOf(row.action, 20), did: wordsOf(row.did, 160), view: wordsOf(row.view, 40), failed: Boolean(row.failed), title: wordsOf(row.title, 160)})),
    cost: {calls: summary.cost.calls, tokens: summary.cost.tokensIn + summary.cost.tokensOut, minutes: Math.round(summary.cost.ms / 6000) / 10,
      ...(Number.isFinite(summary.cost.countedTokens) && Number.isFinite(summary.cost.capTokens) ? {countedTokens: summary.cost.countedTokens, capTokens: summary.cost.capTokens} : {})},
    video: video ? {secs: video.secs, bytes: video.bytes} : null,
  };
}

/** The pictures of a session's notes as [{name: 'shot-N.png', data: Buffer}] in the numbering runRecord uses. */
export function shotFiles(notes) {
  return numbered(notes).filter(({n}) => n).map(({note, n}) => ({name: `shot-${n}.png`, data: Buffer.from(String(note.image).replace(/^data:image\/png;base64,/, ''), 'base64')}));
}
