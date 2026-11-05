// A chain of AI user agent runs: each run ends with a summary and a snapshot of the app's data folder, the next restores both and goes on with the goal (SC 2/2).
// Job: report health
// Owner (5 Nov 2026): "Both: summary loop + chained runs"; a run is capped at 250k tokens, so a flow of 40 steps is reached over a few runs. Spec: docs/superpowers/specs/2026-11-05-ai-agent-summary-and-chains.md.
// The chain state (agent-chain.json) is owned by this file: only linkEnd() writes it, the suite only reads and stores it. The snapshot is a plain tar (not compressed) so the artifact scan sees its bytes.
import {execFileSync} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const MAX_LINKS = 4;
export const MARKER = 'agent-chain-marker.json';
export const STATE_FILE = 'agent-chain.json';
// Why (5 Nov 2026, spec "The snapshot"): caches, logs and the browser's locks are rebuilt by the app; the store, settings and seeded data are what a link hands on.
const SKIP = ['Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'Crashpad', 'logs', 'SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile'];
const goalDone = end => end.stopped === 'done';

const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const snapshotName = (chain, link) => `agent-chain-${chain}-${link}.tar`;

/** How many links a chain may have: the asked number, at least 1, at most MAX_LINKS (an unreadable ask = 1: no chain). */
export const linksAsked = text => Math.min(MAX_LINKS, Math.max(1, Math.floor(Number(text)) || 1));

/** Packs the app's data folder into `dir` as the snapshot of this link; the folder gets the marker first. -> {file, sha256, bytes}. */
export function packSnapshot({profile, dir, chain, link}) {
  fs.writeFileSync(path.join(profile, MARKER), JSON.stringify({chain, link}));
  fs.mkdirSync(dir, {recursive: true});
  const file = path.join(dir, snapshotName(chain, link));
  execFileSync('tar', ['-cf', file, ...SKIP.map(name => `--exclude=${name}`), '-C', profile, '.'], {stdio: ['ignore', 'ignore', 'pipe']});
  return {file: path.basename(file), sha256: sha256(file), bytes: fs.statSync(file).size};
}

/**
 * Puts a snapshot's files in `profile` (emptied first). Refuses a snapshot that is not the one the state names (hash) or that does not carry the suite's marker (a folder of anything else), before it touches the profile.
 * -> the hash it restored.
 */
export function restoreSnapshot({dir, snapshot, profile}) {
  const file = path.join(dir, snapshot.file), found = sha256(file);
  if (found !== snapshot.sha256) throw new Error(`the snapshot ${snapshot.file} is not the one the chain saved (hash ${found.slice(0, 12)}, expected ${snapshot.sha256.slice(0, 12)})`);
  const members = execFileSync('tar', ['-tf', file], {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024}).split('\n').map(line => line.replace(/^\.\//, ''));
  if (!members.includes(MARKER)) throw new Error(`the snapshot ${snapshot.file} has no ${MARKER}: it is not a folder this suite made, so it is not restored`);
  for (const entry of fs.readdirSync(profile)) fs.rmSync(path.join(profile, entry), {recursive: true, force: true});
  execFileSync('tar', ['-xf', file, '-C', profile], {stdio: ['ignore', 'ignore', 'pipe']});
  return found;
}

/** The state a chain starts with (link 0: nothing run yet): the plan is kept whole so a later link never plans again. */
export function startChain({runId, plan, tier, commit, maxLinks}) {
  return {chain: String(runId), link: 0, maxLinks: linksAsked(maxLinks), tier, commit, plan: {seed: plan.seed, persona: plan.persona, goals: plan.goals}, done: [], next: null, ended: '', snapshot: null, links: []};
}

/** The plan the next link works: the goals not done, the first one told where the earlier runs stopped. */
export function resumePlan(state) {
  const total = state.plan.goals.length, goals = state.plan.goals.filter(goal => !state.done.includes(goal.n));
  if (!state.next || !goals.length) return {...state.plan, goals};
  const {steps, stopped, n} = state.next, first = goals.find(goal => goal.n === n) || goals[0];
  const line = `Continue: this is goal ${first.n} of ${total}. Earlier runs already did ${state.next.stepsTotal} steps on it and the last stopped on ${stopped}. The app's data is as that run left it. Its last steps:\n${steps.map((step, i) => `${i + 1}. ${step}`).join('\n')}\nPick up from there; do not repeat what was done.`;
  return {...state.plan, goals: goals.map(goal => (goal === first ? {...goal, label: `${goal.label}\n\n${line}`} : goal))};
}

/** Why a chain stops after this link, or '' when it goes on. */
export function endReason({state, session, commitNow, doneAll}) {
  if (doneAll) return 'every goal is done';
  if (state.link >= state.maxLinks) return `link ${state.maxLinks} (the last) is done`;
  if (String(session.stopped).startsWith('api:')) return `a broker failure: ${String(session.stopped).slice(0, 120)}`;
  if (commitNow && state.commit && commitNow !== state.commit) return `the app commit changed (${state.commit} → ${commitNow})`;
  const steps = session.ends.reduce((sum, end) => sum + end.steps.length, 0);
  if (!steps && !session.notes.length) return 'this link made no progress (no step, no note)';
  if (String(session.stopped).startsWith('repeat') && !session.ends.some(goalDone) && !session.notes.length) return 'this link made no progress (it repeated itself)';
  return '';
}

/**
 * The state after a link ran: `prev` is the state it started from (or startChain's), `session` what runSession returned, `snapshot` what packSnapshot saved, `restored` the hash it restored (or '').
 * Why (5 Nov 2026, spec "Chain states"): new → running(n) → ended; a chain never starts a 5th link; a goal's steps carry over until it is done.
 */
export function linkEnd({prev, session, runId, commitNow, snapshot, restored = '', tokens = 0}) {
  const state = {...prev, link: prev.link + 1, done: [...prev.done], snapshot};
  for (const end of session.ends) if (goalDone(end) && !state.done.includes(end.n)) state.done.push(end.n);
  const left = state.plan.goals.filter(goal => !state.done.includes(goal.n)), stuck = session.ends.find(end => !goalDone(end));
  const carried = stuck && prev.next?.n === stuck.n ? prev.next.stepsTotal : 0;
  state.next = left.length ? {n: stuck?.n ?? left[0].n, stepsTotal: carried + (stuck?.steps.length || 0), steps: (stuck?.steps || []).slice(-12), stopped: stuck ? (String(stuck.stopped).startsWith('api:') ? String(session.stopped) : stuck.stopped) : 'it was not reached'} : null;
  const steps = session.ends.reduce((sum, end) => sum + end.steps.length, 0);
  state.links = [...prev.links, {link: state.link, run: String(runId), steps, tokens, view: session.trace.at(-1)?.view || '', saved: snapshot.sha256, restored}];
  state.ended = endReason({state, session, commitNow, doneAll: !left.length});
  return state;
}

/**
 * The line a finding carries (spec "A note names its snapshot"): which snapshot to restore, the artifact it is in, and that the steps listed above it reach the note.
 * `at`: {chain, link, snapshot, run} of the link the note was made in (snapshot and run are those of the link before; empty on link 1).
 */
export const pointerLine = at => (at.link <= 1 ? `Chain ${at.chain}, link 1: starts from the seeded app, then do the steps above.`
  : `Chain ${at.chain}, link ${at.link}: restore ${at.snapshot} (artifact agent-replay-${at.run}), then do the steps above.`);
