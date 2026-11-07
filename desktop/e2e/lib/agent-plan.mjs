// The AI user agent's day plan: a seeded, replayable story of 6 to 10 goals over the moves the app offers, never the same order twice. Pure: vocabulary and history in, plan out.
// Job: report health
// Why (3 Nov 2026, AI user agents 3/7; owner: "as diverse and as creative every time … no order of actions … starting with a strategy, searching for some jobs, then changing the strategy, then
// some filling, then updating the CV…"): the unit of coverage is an ORDERED PAIR, what the person just did and the move that follows (a "state" is the previous move), so the same moves in a new
// order count as new. At least half of a day's pairs must be unseen in the last 7 sessions; an area whose code changed since the last session always gets a goal.
import {makePersona} from './agent-persona.mjs';
import {sequence} from './seeded-random.mjs';

/** How many past sessions "seen before" looks back over. */
export const WINDOW = 7;
/** The share of a plan's pairs that must be new to the last WINDOW sessions (spec: at least half). */
export const MIN_NEW = 0.5;
const TRIES = 60;

/** The seeded generator the harness already has (lib/seeded-random.mjs): the same seed gives the same numbers, so a session is replayable from its seed. */
export const rng = sequence;

/** A shuffled copy (Fisher-Yates) driven by `next`. */
export function shuffle(items, next) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** A move's identity: its ⌘K group and label, e.g. "Strategy: Tune my strategy". */
export const moveKey = move => `${move.group}: ${move.label}`;
/** The coverage unit: the move that came before (or "start") and this one. */
export const pairKey = (previous, move) => `${previous ? moveKey(previous) : 'start'} → ${moveKey(move)}`;

/** The pairs of an ordered list of moves. */
export const pairsOf = moves => moves.map((move, i) => pairKey(moves[i - 1], move));

/** The share of `pairs` not seen in the last WINDOW sessions of `coverage` ([{pairs: [...]}, ...], oldest first). 1 when there is nothing to compare with. */
export function newShare(pairs, coverage = []) {
  const seen = new Set(coverage.slice(-WINDOW).flatMap(session => session.pairs || []));
  return pairs.length ? pairs.filter(pair => !seen.has(pair)).length / pairs.length : 1;
}

/** One goal order: the changed areas first as a group (shuffled among themselves, then spread by a shuffle of everything), filled with other moves up to `count`. */
function draw(moves, changed, count, next, pending = []) {
  const forced = shuffle(moves.filter(move => changed.includes(move.group)), next);
  const chosen = new Map();
  for (const group of changed) { const one = forced.find(move => move.group === group); if (one) chosen.set(moveKey(one), one); }
  for (const move of pending) { if (chosen.size >= count) break; chosen.set(moveKey(move), move); }
  for (const move of shuffle(moves, next)) { if (chosen.size >= count) break; chosen.set(moveKey(move), move); }
  const order = shuffle([...chosen.values()], next), priority = pending.filter(move => chosen.has(moveKey(move)));
  return [...priority, ...order.filter(move => !priority.some(first => moveKey(first) === moveKey(move)))];
}

/**
 * The day's plan. `moves`: [{group, label}] read from the open ⌘K palette; `coverage`: past sessions' {pairs}; `changed`: ⌘K groups whose code changed since the last session.
 * Draws up to TRIES orders from the seed and keeps the one with the most new pairs (the first to reach MIN_NEW wins), so it is replayable and honest: `newShare` is reported even when the
 * vocabulary or history makes MIN_NEW unreachable. Returns {seed, persona, goals: [{n, group, label, pair}], newShare, changedAreas}.
 */
export function planSession({seed, moves, coverage = [], changed = [], pending = [], count, minNew = MIN_NEW}) {
  const next = rng(seed), goalCount = Math.min(count ?? 6 + Math.floor(next() * 5), moves.length);
  const areas = [...new Set(changed)].filter(group => moves.some(move => move.group === group)).slice(0, goalCount);
  const current = new Map(moves.map(move => [moveKey(move), move]));
  const priority = [...new Map(pending.filter(goal => current.has(moveKey(goal))).map(goal => [moveKey(goal), current.get(moveKey(goal))])).values()];
  let best = null;
  for (let attempt = 0; attempt < TRIES; attempt++) {
    const order = draw(moves, areas, goalCount, next, priority), pairs = pairsOf(order), share = newShare(pairs, coverage);
    if (!best || share > best.share) best = {order, pairs, share};
    if (share >= minNew) break;
  }
  const goals = best.order.map((move, i) => ({n: i + 1, group: move.group, label: move.label, pair: best.pairs[i]}));
  return {seed, persona: makePersona(seed), goals, newShare: Number(best.share.toFixed(3)), changedAreas: areas};
}

/** The next night's queue: interrupted goals, unstarted goals, older deferred goals, then actor-declared blockers. Fresh fictional state is used next night; only identities carry over. */
export function pendingGoals(session, previous = []) {
  const rows = session.summary.goals, completed = new Set(session.completed), planned = new Set(rows.map(moveKey));
  const interrupted = rows.filter(goal => goal.verdict === 'could-not-finish' && !completed.has(goal.n));
  const unstarted = rows.filter(goal => goal.verdict === 'not-started');
  const deferred = previous.filter(goal => !planned.has(moveKey(goal)));
  const blockers = rows.filter(goal => goal.verdict === 'could-not-finish' && completed.has(goal.n));
  return [...new Map([...interrupted, ...unstarted, ...deferred, ...blockers].map(({group, label}) => [moveKey({group, label}), {group, label}])).values()];
}

/** What a finished session adds to the coverage record: the pairs it walked, keeping the last WINDOW sessions. */
export function recordSession(coverage, {seed, goals}) {
  return [...coverage, {seed, pairs: goals.map(goal => goal.pair)}].slice(-WINDOW);
}
