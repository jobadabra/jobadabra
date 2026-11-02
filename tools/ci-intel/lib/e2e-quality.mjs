// How steady and right the AI is in the quality suite, as rates over many nights (owner, 27 Oct 2026: "Code gate + AI rate"): the gate replays recorded answers,
// and the night's live quality run scores the golden jobs twice. tools/ci-intel/jobs/e2e-intel.mjs reads those runs' logs (counts only, never stored), the site keeps one row per
// night (e2e_quality) and /admin/testing/e2e draws the rate over the last 90 score pairs against the owner's bars (jobadabra-web admin/e2e-page.js qualityCard). Guard: desktop/test/ci-intel-e2e-quality.test.js.

// The owner's bars (27 Oct 2026): red below 80% of the last 90 pairs within 8 points ("raised after the wobble fix"); red above 2% of them more than 20 apart.
export const BARS = {pairs: 90, agree: 0.8, jumps: 0.02, within: 8, jump: 20};

const scoresOf = line => Object.fromEntries([...String(line || '').matchAll(/(\d+)=(\d+)\b/g)].map(([, id, score]) => [id, Number(score)]));

// One quality job's log text -> the night's counts, or null when the run scored nothing twice (a replayed gate, a run cut before the second scoring).
// Only the first try counts (its "second scores:" line comes first; a retry repeats the steps that went red, on the same commit).
export function nightOf(text) {
  const log = String(text || ''), second = log.search(/^\S*\s*second scores: /m);
  if (second < 0) return null;
  const before = log.slice(0, second), firstAt = Math.max(...[...before.matchAll(/^\S*\s*scores: /gm)].map(match => match.index), -1);
  if (firstAt < 0) return null;
  const line = from => log.slice(from, log.indexOf('\n', from) < 0 ? undefined : log.indexOf('\n', from));
  const first = scoresOf(line(firstAt).replace(/^.*?scores: /, '')), again = scoresOf(line(second).replace(/^.*?second scores: /, ''));
  const gaps = Object.keys(first).filter(id => id in again).map(id => Math.abs(first[id] - again[id]));
  if (!gaps.length) return null;
  const facts = log.match(/^\S*\s*quality: (\d+)\/(\d+) facts exact/m), judged = log.match(/^\S*\s*judged (\d+) score texts: .*?(\d+) with invented facts/m);
  return {pairs: gaps.length, within8: gaps.filter(gap => gap <= BARS.within).length, over20: gaps.filter(gap => gap > BARS.jump).length,
    factsExact: facts ? Number(facts[1]) : 0, factsTotal: facts ? Number(facts[2]) : 0, judged: judged ? Number(judged[1]) : 0, invented: judged ? Number(judged[2]) : 0};
}

const count = value => (Number.isInteger(value) && value >= 0 && value <= 1000 ? value : null);

// The nightly prompt-case replay of the public repo (tools/prompt-cases-night.mjs, report only) as counts: how many of the live prompt cases are right, how many got worse than last night
// (flipped: wrong twice), how many were model noise (wrong once, right on the re-ask), how many it could not confirm, and the Codex calls it spent. status: asked / first (baseline stored) /
// carried (no live prompt changed: nothing asked, the numbers are the baseline's) / not-asked (the broker said no). Anything that does not add up is dropped, never repaired.
export const PROMPT_STATUS = ['asked', 'first', 'carried', 'not-asked'];
/** Validate a night's prompt-case counts (shape above) into the stored form; null when they do not add up. Unknown fields are dropped. */
export function cleanPrompt(value) {
  if (!value || typeof value !== 'object' || !PROMPT_STATUS.includes(value.status)) return null;
  const fields = ['total', 'right', 'flipped', 'noise', 'newWrong', 'unconfirmed', 'calls'].map(key => count(value[key]));
  if (fields.includes(null) || fields[1] > fields[0] || fields[2] > fields[0] || fields[3] > fields[0]) return null;
  const [total, right, flipped, noise, newWrong, unconfirmed, calls] = fields;
  return {status: value.status, total, right, flipped, noise, newWrong, unconfirmed, calls};
}

// One job log's text -> the night's prompt-case counts from its `PROMPT_CASES_NIGHT {json}` line (counts only, never case texts), or null when the job printed none.
export function promptCasesOf(text) {
  const match = /^\S*\s*PROMPT_CASES_NIGHT (\{.*\})\s*$/m.exec(String(text || ''));
  if (!match) return null;
  try { return cleanPrompt(JSON.parse(match[1])); } catch { return null; }
}

// A night as the collector sends it: {runId, day, pairs, within8, over20, factsExact, factsTotal, judged, invented, promptCases?}; anything else is dropped.
// promptCases is the replay of the same night's run: one that does not add up is left off, the night stays.
export function cleanNight(night) {
  if (!Number.isInteger(night?.runId) || night.runId <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(night.day || '')) return null;
  const fields = ['pairs', 'within8', 'over20', 'factsExact', 'factsTotal', 'judged', 'invented'].map(key => count(night[key]));
  if (fields.includes(null) || !fields[0] || fields[1] > fields[0] || fields[2] > fields[0] || fields[3] > fields[4] || fields[6] > fields[5]) return null;
  const [pairs, within8, over20, factsExact, factsTotal, judged, invented] = fields;
  return {runId: night.runId, day: night.day, pairs, within8, over20, factsExact, factsTotal, judged, invented, promptCases: cleanPrompt(night.promptCases)};
}

// Nights newest first -> the rate over the newest nights that hold the last 90 pairs (fewer while history is short), and whether each bar holds.
export function rateOf(nights = []) {
  const used = [];
  let pairs = 0;
  for (const night of nights) { if (pairs >= BARS.pairs) break; used.push(night); pairs += night.pairs; }
  const sum = field => used.reduce((total, night) => total + night[field], 0);
  const agree = pairs ? sum('within8') / pairs : null, jumps = pairs ? sum('over20') / pairs : null;
  return {nights: used.length, pairs, agree, jumps, factsExact: sum('factsExact'), factsTotal: sum('factsTotal'), judged: sum('judged'), invented: sum('invented'),
    agreeOk: agree == null || agree >= BARS.agree, jumpsOk: jumps == null || jumps <= BARS.jumps};
}
