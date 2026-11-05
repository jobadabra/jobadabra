// The suite's side of a chain (SC 2/2): read and restore the link before, choose the state and plan of this link, pack and write the state after it. Keeps suites/agent.mjs's run() small.
// Job: report health
import fs from 'node:fs';
import path from 'node:path';
import {linkEnd, linksAsked, packSnapshot, restoreSnapshot, resumePlan, startChain, STATE_FILE} from './agent-chain.mjs';

/**
 * The state the previous link left in `dir` (null = this run starts a chain or is no link), and why this link cannot go on if it cannot: {prev, ended}.
 * Why (5 Nov 2026, code review): the workflow starts the next link on the branch tip, and main moves between links; a snapshot of another build is not restored, and that ends the chain quietly (no tokens spent) instead of failing the run.
 */
export function previousLink(dir, commitNow) {
  if (!dir) return {prev: null, ended: ''};
  const prev = JSON.parse(fs.readFileSync(path.join(dir, STATE_FILE), 'utf8'));
  if (prev.ended) throw new Error(`the chain ${prev.chain} had already ended (${prev.ended}): there is no link to run`);
  const ended = prev.commit && prev.commit !== commitNow ? `the app commit changed (${prev.commit} → ${commitNow}): a snapshot of another build is not restored` : '';
  return {prev, ended};
}

/** Writes the state of a chain that ended before this link ran, so the workflow says why and starts nothing. */
export function endBeforeRun({ctx, prev, ended}) {
  fs.writeFileSync(path.join(ctx.ARTIFACTS, STATE_FILE), JSON.stringify({...prev, ended}, null, 1));
  console.log(`  chain ${prev.chain} ended before link ${prev.link + 1}: ${ended}`);
}

/** Quits the app, puts the previous link's data in its profile and starts it again. -> {restored: the restored hash, page: the new window (ctx.page is replaced by the relaunch: the old one is closed)}. */
export async function restoreLink(ctx, dir, prev) {
  let restored = '';
  await ctx.relaunch({}, profile => { restored = restoreSnapshot({dir, snapshot: prev.snapshot, profile}); }, {how: 'quit'});
  console.log(`  chain ${prev.chain}: link ${prev.link + 1} restored ${prev.snapshot.file} (${restored.slice(0, 12)})`);
  return {restored, page: ctx.page};
}

/** The chain state and the plan this link works: the previous state with its remaining goals, a new chain when links are asked (2-4), else none (a single run). */
export function chainFor({prev, links, fresh, tier, commitNow, runId}) {
  if (prev) return {state: prev, plan: resumePlan(prev)};
  const maxLinks = linksAsked(links);
  return {state: maxLinks > 1 ? startChain({runId, plan: fresh, tier, commit: commitNow, maxLinks}) : null, plan: fresh};
}

/** The pointer a finding of this link carries: which snapshot (the one the link before saved) and its run. */
export const pointerOf = state => (state ? {chain: state.chain, link: state.link + 1, snapshot: state.snapshot?.file || '', run: state.links.at(-1)?.run || ''} : null);

/**
 * After the session: quits the app (a SQLite store is whole only once it is down), packs its data as this link's snapshot, writes the new state beside it and in the artifact's root (the workflow reads it to start the next link).
 * Why (5 Nov 2026, SC 2/2): the next link restores exactly these bytes, and the state says why a chain stops.
 */
export async function endLink({ctx, state, session, restored, tokens, runId, commitNow}) {
  const dir = path.join(ctx.ARTIFACTS, 'agent-chain-out');
  let snapshot = null;
  await ctx.relaunch({}, profile => { snapshot = packSnapshot({profile, dir, chain: state.chain, link: state.link + 1}); }, {how: 'quit'});
  const next = linkEnd({prev: state, session, runId, commitNow, snapshot, restored, tokens});
  fs.writeFileSync(path.join(dir, STATE_FILE), JSON.stringify(next, null, 1));
  fs.copyFileSync(path.join(dir, STATE_FILE), path.join(ctx.ARTIFACTS, STATE_FILE));
  console.log(`  chain ${next.chain}: link ${next.link} of at most ${next.maxLinks} ${next.ended ? `ended the chain: ${next.ended}` : `goes on with goal ${next.next.n}`}; snapshot ${snapshot.file} ${snapshot.sha256.slice(0, 12)} (${(snapshot.bytes / 1e6).toFixed(1)} MB)`);
  return next;
}
