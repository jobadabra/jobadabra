// The AI user agent's day plan: a seeded, replayable story of 6 to 10 goals over the moves the app offers, never the same order twice. Pure: vocabulary and history in, plan out.
// Job: report health
// Why (3 Nov 2026, AI user agents 3/7; owner: "as diverse and as creative every time … no order of actions … starting with a strategy, searching for some jobs, then changing the strategy, then
// some filling, then updating the CV…"): the unit of coverage is an ORDERED PAIR, what the person just did and the move that follows (a "state" is the previous move), so the same moves in a new
// order count as new. At least half of a day's pairs must be unseen in the last 7 sessions; an area whose code changed since the last session always gets a goal.
import {makePersona} from './agent-persona.mjs';
import {sequence} from './seeded-random.mjs';
import {MAX_GOALS, MIN_GOALS} from './agent-steps.mjs';
import {LANGUAGE_LABEL, OTHER_LANGUAGES, languageGoal, poolLabel} from './agent-moves.mjs';

/** How many past sessions "seen before" looks back over. */
export const WINDOW = 7;
/** The share of a plan's pairs that must be new to the last WINDOW sessions (spec: at least half). */
export const MIN_NEW = 0.5;
const TRIES = 60;
/** The language move is drawn at least once in this many sessions (the two before tonight carry none -> tonight has it). */
export const LANGUAGE_EVERY = 3;
const LANGUAGE_PAIR = `→ App: ${LANGUAGE_LABEL}`;

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

/** Whether tonight must carry the language move: none of the last LANGUAGE_EVERY - 1 sessions walked it (coverage lists only the goals that were completed, so an unfinished one is due again). */
export const languageDue = coverage => !coverage.slice(-(LANGUAGE_EVERY - 1)).some(session => (session.pairs || []).some(pair => pair.endsWith(LANGUAGE_PAIR)));

/** The night's language: the seed picks one of the six other languages, replayable from the seed. */
export const languageOf = seed => { const codes = Object.keys(OTHER_LANGUAGES); return codes[Math.floor(rng(Number(seed) + 11)() * codes.length)]; };

/** The most lanes a batch can start: the move pool is split in this many parts, so each part holds a quarter of it (lanePool says when a part is too small to plan from). */
export const MAX_LANES = 4;

/** The lane a dispatch asked for: '' = 0 (a night), else a whole number 1..MAX_LANES; anything else throws before the app is seeded. */
export function laneOf(raw = '') {
  if (raw === '' || raw === undefined) return 0;
  const lane = /^\d+$/.test(String(raw)) ? Number(raw) : 0;
  if (lane < 1 || lane > MAX_LANES) throw new Error(`AGENT_LANE must be empty or a whole number from 1 to ${MAX_LANES}, got "${raw}"`);
  return lane;
}

/** A lane's own seed (the batch seed + its number): its order, person, data shape and language differ from the other lanes'; lane 0 is a night and keeps the seed. */
export const laneSeed = (seed, lane = 0) => Number(seed) + lane;

/** A 32-bit mix of a text (murmur3's finalizer over FNV-1a): every bit of the text moves every bit of the result, so `% n` splits evenly. */
const mix = text => {
  let h = 2166136261;
  for (const char of text) h = Math.imul(h ^ char.charCodeAt(0), 16777619);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
};

/**
 * Lane n's part of the move pool: the moves whose own key, mixed with the batch seed, falls in part n of MAX_LANES. A move's part depends on that move and the seed ONLY, so two lanes of one seed never share a goal
 * even when their palettes differ by a move (each lane seeds its own data shape, which can show or hide a ⌘K entry), and the batch needs no list of its lanes. Throws when the part holds fewer than MIN_GOALS moves,
 * so a thin plan never runs. Why (7 Nov 2026, pz, owner via mac-50: "several AI persona at the same time, each one on different paths/goals"; code review: slicing a shuffled list by index put 196 of 200 seeds in
 * two lanes' goals once their pools differed by one move): lanes drawn from one pool by their own seeds, or cut by position, would overlap.
 */
export function lanePool(moves, seed, lane) {
  const part = moves.filter(move => mix(`${seed}|${moveKey(move)}`) % MAX_LANES === lane - 1);
  if (part.length < MIN_GOALS) throw new Error(`lane ${lane}: ${part.length} of the pool's ${moves.length} moves fall to this lane with seed ${seed}, fewer than ${MIN_GOALS}: start the batch with another seed`);
  return part;
}

/** One goal order: `must` moves are in it (shuffled with the rest, not first), pending goals lead, with a representative for changed areas, then fresh moves fill the remaining slots. */
function draw(moves, changed, count, next, pending = [], must = []) {
  const forced = shuffle(moves.filter(move => changed.includes(move.group)), next);
  const chosen = new Map(must.map(move => [moveKey(move), move]));
  const groups = [...new Set([...pending.map(move => move.group), ...changed])].slice(0, Math.max(0, count - must.length));
  for (const group of groups) { const one = pending.find(move => move.group === group) || forced.find(move => move.group === group); if (one) chosen.set(moveKey(one), one); }
  for (const move of pending) { if (chosen.size >= count) break; chosen.set(moveKey(move), move); }
  for (const move of shuffle(moves, next)) { if (chosen.size >= count) break; chosen.set(moveKey(move), move); }
  const order = shuffle([...chosen.values()], next), priority = pending.filter(move => chosen.has(moveKey(move)));
  return [...priority, ...order.filter(move => !priority.some(first => moveKey(first) === moveKey(move)))];
}

/**
 * The day's plan. `max`: the most goals the run can pay for (lib/agent-steps.mjs goalCountFor), a hard ceiling: pending goals take its slots first, then one goal per changed area; a changed area with no slot is returned in `deferred` for the next night's queue, never planned beyond the budget (default 10, the old ceiling).
 * `lane`: 0 for a night, n for lane n of a parallel batch (the goals come from that lane's own slice of the pool, `lanePool`; `seed` is the batch's). `moves`: [{group, label}] read from the open ⌘K palette; `coverage`: past sessions' {pairs}; `changed`: ⌘K groups whose code changed since the last session.
 * Draws up to TRIES orders from the seed and keeps the one with the most new pairs (the first to reach MIN_NEW wins), so it is replayable and honest: `newShare` is reported even when the
 * vocabulary or history makes MIN_NEW unreachable. Returns {seed, persona, goals: [{n, group, label, pair}], newShare, changedAreas, deferred: [{group, label}]}.
 */
export function planSession({seed: base, moves: all, lane = 0, coverage = [], changed = [], pending = [], count, max = 10, minNew = MIN_NEW}) {
  const moves = lane ? lanePool(all, base, lane) : all, seed = laneSeed(base, lane);
  // Why (7 Nov 2026, pz): a seeded 3 to 4 goals (MIN_GOALS..MAX_GOALS, was 6-10) and never more than `max`; 31 runs left 43 of 122 goals unstarted because the plan outgrew what the 250k cap pays for.
  const next = rng(seed), targetCount = Math.min(count ?? MIN_GOALS + Math.floor(next() * (MAX_GOALS - MIN_GOALS + 1)), moves.length, max);
  const current = new Map(moves.map(move => [moveKey(move), move]));
  const priority = [...new Map(pending.filter(goal => current.has(moveKey(goal))).map(goal => [moveKey(goal), current.get(moveKey(goal))])).values()];
  const changedAreas = [...new Set(changed)].filter(group => moves.some(move => move.group === group));
  // Why (7 Nov 2026, independent review of #3434): reserving all changed slots first could evict the entire pending queue. One representative per required area fits within the existing ten-goal ceiling and the unchanged run budget.
  const required = new Set([...priority.map(goal => goal.group), ...changedAreas]);
  const goalCount = Math.min(moves.length, max, Math.max(targetCount, Math.min(10, required.size)));
  const areas = changedAreas.slice(0, goalCount);
  // Why (7 Nov 2026, pz, owner via mac-50: "Add a new goal to test the multi language"): the language goal is in the pool like any move and is forced in at least every LANGUAGE_EVERY nights, so each of the 6 languages is met within weeks, not by luck of the draw.
  const must = languageDue(coverage) ? moves.filter(move => moveKey(move) === `App: ${LANGUAGE_LABEL}`) : [];
  let best = null;
  for (let attempt = 0; attempt < TRIES; attempt++) {
    const order = draw(moves, areas, goalCount, next, priority, must), pairs = pairsOf(order), share = newShare(pairs, coverage);
    if (!best || share > best.share) best = {order, pairs, share};
    if (share >= minNew) break;
  }
  const goals = best.order.map((move, i) => ({n: i + 1, group: move.group, label: move.label === LANGUAGE_LABEL ? languageGoal(languageOf(seed)) : move.label, pair: best.pairs[i]}));   // the pair keeps the pool's one label: coverage counts the move, the goal text names the language
  const deferred = changedAreas.filter(group => !goals.some(goal => goal.group === group)).map(group => { const {label} = moves.find(move => move.group === group); return {group, label}; });   // Why (7 Nov 2026, pz): "an area whose code changed always gets a goal" now means a goal tonight or a place in the queue; a night that works every goal moves the changed-since checkpoint past the area.
  return {seed, persona: makePersona(seed), goals, newShare: Number(best.share.toFixed(3)), changedAreas: areas, deferred};
}

/** The next night's queue: interrupted goals, unstarted goals, older deferred goals, then actor-declared blockers. Fresh fictional state is used next night; only identities carry over. */
export function pendingGoals(session, previous = []) {
  const rows = session.summary.goals, completed = new Set(session.completed), planned = new Set(rows.map(({group, label}) => moveKey({group, label: poolLabel(label)})));   // Why (7 Nov 2026, pz, code review): a language goal's row carries the night's rewritten label; the queue holds the pool's, so it matches on the pool's
  const interrupted = rows.filter(goal => goal.verdict === 'could-not-finish' && !completed.has(goal.n));
  const unstarted = rows.filter(goal => goal.verdict === 'not-started');
  const deferred = previous.filter(goal => !planned.has(moveKey(goal)));
  const blockers = rows.filter(goal => goal.verdict === 'could-not-finish' && completed.has(goal.n));
  return [...new Map([...interrupted, ...unstarted, ...deferred, ...blockers].map(({group, label}) => [moveKey({group, label: poolLabel(label)}), {group, label: poolLabel(label)}])).values()];
}

/** The queue to write after a session: `pending` (what tonight started with) and the changed areas the plan had no slot for, then what pendingGoals keeps of them. A named or chained plan has no `deferred`. */
export const queueAfter = (session, pending, plan) => pendingGoals(session, [...pending, ...(plan.deferred || [])]);

/** What a finished session adds to the coverage record: the pairs it walked, keeping the last WINDOW sessions. */
export function recordSession(coverage, {seed, goals}) {
  return [...coverage, {seed, pairs: goals.map(goal => goal.pair)}].slice(-WINDOW);
}
