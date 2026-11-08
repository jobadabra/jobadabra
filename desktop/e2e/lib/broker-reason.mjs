// The one place that reads WHY the AI broker refused a call on budget, and says it in plain words: reasonOf(note) -> {kind, rank, title, said(what, images)} or null.
//   reasonOf('judge prejudge: broker: budget:own-share 70.0% of 70% (scheduled)') -> {kind: 'own-share', title: 'Scheduled AI used its 70% share of this week', ...}
// Why (8 Nov 2026, owner: alert "AI credit ran out · Codex refused the AI jobs" over "budget:own-share 70.0% of 70% (scheduled)"; "If codex is at limit, which is not true, btw"; 6 fix PRs in 5 days on
// credit-alert.mjs): the caller used to pass one fixed verdict ("Codex refused...") and every `budget:` note got the title "AI credit ran out". The broker has four refusals (jobadabra-web
// workers/ai-broker/lib/budget.mjs `allow`, worker.js fallback-day) and only `budget:week` is "Codex ran out"; own-share is the scheduled lanes' 70% share (Codex keeps the rest for the owner and PRs),
// daily is one lane's call cap, fallback-day is Free AI's $ day cap. The states, their words and their order live here; no caller passes a verdict any more.
// Job: report health

/** The providers' own wordings of an empty balance: Anthropic "Credit balance is too low", OpenAI "insufficient_quota" / "exceeded your current quota". */
export const CREDIT_OUT = /credit balance is too low|insufficient[_ ]quota|exceeded your current quota|plans and billing/i;

const LANES = {scheduled: 'Scheduled AI', bench: 'Benchmark AI', drift: 'Drift-check AI'};
// A reason that lost its "(lane)" (the relay path wraps it) names no lane: never guess "Scheduled".
const lane = word => LANES[word] || (word && word !== 'pr' ? `${word[0].toUpperCase()}${word.slice(1)} AI` : 'Background AI');
const NO_FREE_SCREENSHOTS = ' Screenshots have no free fallback.';
const items = what => (what && what.length ? what.join(', ') : 'AI steps');
const share = m => (m.limit ? ` ${m.limit}%` : '');

// Most severe first: a sentence about one state leads the alert, the others follow as "Also" rows. `said` takes the skipped things ([job names]) and whether a skipped call carried screenshots.
// `week` has two shapes (Why 8 Nov 2026, review of this change): the PR lane stops at 100% of Codex's week (really used up); scheduled, bench and drift stop at the reserve line (70%), so Codex still has the rest for PRs.
const STATES = [
  {kind: 'credit', rank: 0, title: () => 'AI credit ran out', row: 'The AI provider says its credit is used up', said: what => `${items(what)} skipped; the provider says its credit is gone. Top it up, or let the jobs wait.`},
  {kind: 'week', rank: 1, title: m => (Number(m.limit) < 100 ? `${lane(m.lane)} stopped at${share(m)} of Codex's week` : "Codex's week is used up"), row: "Codex's week reached its line",
    said: (what, images, m) => `${items(what)} skipped (grey, nothing paid); ${Number(m.limit) < 100 ? 'Codex keeps the rest for you and PRs; ' : ''}Codex is back with its weekly reset.${images ? NO_FREE_SCREENSHOTS : ''}`},
  {kind: 'fallback-day', rank: 2, title: () => "Free AI's day cap is used", row: "Free AI's day cap is used", said: what => `${items(what)} skipped (grey, nothing paid); Free AI is back tomorrow (UTC).`},
  {kind: 'daily', rank: 3, title: m => `${lane(m.lane)} used its${m.limit ? ` ${m.limit}` : ''} calls for today`, row: 'A lane used its calls for today', said: (what, images) => `${items(what)} skipped (grey, nothing paid); it runs again tomorrow (UTC).${images ? NO_FREE_SCREENSHOTS : ''}`},
  {kind: 'own-share', rank: 4, title: m => `${lane(m.lane)} used its${share(m)} share of this week`, row: m => `${lane(m.lane)} used its share of Codex's week`,
    said: (what, images) => `${items(what)} skipped (grey, nothing paid). Codex keeps the rest for you and PRs; resets with the Codex week.${images ? NO_FREE_SCREENSHOTS : ''}`},
  {kind: 'budget', rank: 5, title: () => 'AI budget used', row: 'The AI broker refused on budget', said: what => `${items(what)} skipped (grey, nothing paid); the AI broker refused on its budget.`},
];
const state = kind => STATES.find(one => one.kind === kind);

// -> {kind, lane, limit} from the broker's own words, or null when the text names no budget. The neuron count is CI's Free AI day cap (lib/ai-cap.mjs), the same state as the broker's fallback-day.
function parse(text) {
  const raw = String(text ?? '');
  const word = raw.match(/budget:([a-z-]+)/i)?.[1];
  if (word) {
    const known = state(word) && !['credit', 'budget'].includes(word) ? word : 'budget';
    const limit = (known === 'daily' ? raw.match(/of (\d+) calls/) : raw.match(/of (\d+)%/))?.[1];
    return {kind: known, lane: raw.match(/budget:[a-z-]+[^()]*\(([a-z-]+)\)/i)?.[1] || '', limit: limit || ''};
  }
  if (/\d+ of \d+ neurons/i.test(raw)) return {kind: 'fallback-day', lane: '', limit: ''};
  // Codex's own "usage limit" is its week really used up (the broker treats it so: lib/fallback.mjs `exhausted`), never a balance to top up.
  if (/usage[ _-]limit/i.test(raw)) return {kind: 'week', lane: '', limit: '100'};
  if (CREDIT_OUT.test(raw)) return {kind: 'credit', lane: '', limit: ''};
  return null;
}

/** The state a refusal note is in: {kind, rank, title, row, said(what, images)} (`row` is the short label for a failure list), or null when the note names no budget, credit or cap. Takes the raw note, returns the state; never throws. */
export function reasonOf(text) {
  const found = parse(text);
  if (!found) return null;
  const one = state(found.kind);
  return {kind: one.kind, rank: one.rank, title: one.title(found), row: typeof one.row === 'function' ? one.row(found) : one.row, said: (what, images) => one.said(what, images, found)};
}

/** The distinct states of several notes, most severe first: [{kind, title, said, what: [job names], images}]. `entries` = [{note, job, images}]. */
export function reasonsOf(entries) {
  const byKind = new Map();
  for (const {note, job, images} of entries) {
    const one = reasonOf(note);
    if (!one) continue;
    const seen = byKind.get(one.kind) || {...one, what: [], images: false};
    if (job && !seen.what.includes(job)) seen.what.push(job);
    seen.images ||= images === true;
    byKind.set(one.kind, seen);
  }
  return [...byKind.values()].sort((a, b) => a.rank - b.rank);
}
