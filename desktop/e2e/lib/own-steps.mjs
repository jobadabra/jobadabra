// The e2e steps a diff ADDS or EDITS in the files that hold them (suites/*.mjs, a lib file with `ctx.run` calls), and the PR-check plan built from them. Pure; the CLI is desktop/e2e/pr-suites.mjs.
// Job: pick the suites
//   ownSteps          the loop pr-suites.mjs always ran for "a change to a suite runs that suite's affected steps" (owner, 26 Oct 2026), moved here unchanged so a PR check can use it too
//   pickChangedSteps  owner, 2 Nov 2026: "A PR adding a new e2e or modifying the e2e.. should have it as a PR CI check" — "the only exception when we run e2e on the PR level"
import {newSideRanges, ownedStepNames, stepCalls, stepHomes, stepsTouched} from './pr-suites.mjs';
import {NIGHT_REPORT} from './plan.mjs';
import {storeFor} from './coverage-pick.mjs';
import {STORES, WHY, whyLines} from './pick-why.mjs';

const STEP_FILE = /^desktop\/e2e\/(suites|lib)\/[^/]+\.mjs$/;

/**
 * The steps each changed file of steps touches, in the suite that runs them (a file several suites share goes by each suite's `ownsStep`; applyflows runs apply.mjs's 'flows' steps).
 * A line outside a named step (an import, a helper, the suite's frame) is no step: its file lands in `outside`, not in `own`.
 * Invariant: a comment-only or blank changed line touches nothing (stepsTouched); a file with no `ctx.run` is a plain helper and is skipped.
 * changedFiles: repo paths; diff: `git diff -U0` of suites/ and lib/; sources: {'suites/x.mjs': text}; users: suitesUsing(); all: every suite; map: the coverage map;
 * ownsStepOf: async suite => (name => bool). -> {own: {suite: [names]}, direct: Set, byStep: Set, outside: [{file, suites}]}
 */
export async function ownSteps({changedFiles, diff, sources, users, all, map = {}, ownsStepOf = async () => () => true}) {
  const added = newSideRanges(diff), out = {own: {}, direct: new Set(), byStep: new Set(), outside: []};
  for (const file of changedFiles.filter(name => STEP_FILE.test(name))) await ownStepsOfFile({file, ranges: added[file] || [], sources, users, all, map, ownsStepOf, out});
  return out;
}

// One changed file of the loop above, added to `out`. Why (2 Nov 2026, clean-code on #2980): the whole loop in one function had cognitive complexity 25 (limit 20).
async function ownStepsOfFile({file, ranges, sources, users, all, map, ownsStepOf, out}) {
  const rel = file.slice('desktop/e2e/'.length), text = sources[rel] || '';
  const suiteFile = /^suites\/([^/]+)\.mjs$/.exec(rel)?.[1];
  if (suiteFile) out.direct.add(suiteFile);
  if (!stepCalls(text).length) return;   // no steps here: a plain helper
  // A changed file holding steps is stronger reach than a plain imported helper.
  for (const user of users[rel] || []) out.direct.add(user);
  const touched = stepsTouched(text, ranges);
  const suites = [...new Set([...(suiteFile ? [suiteFile] : []), ...(users[rel] || [])])].filter(name => all.includes(name));
  if (touched.whole) { out.outside.push({file, suites}); return; }
  out.byStep.add(file);
  for (const suite of suites) {
    const ownsStep = await ownsStepOf(suite);
    // a step another suite runs (it imports this file) is that suite's (lib/pr-suites.mjs stepHomes)
    for (const name of ownedStepNames({suite, file, names: touched.steps, sources, map, ownsStep})) for (const home of stepHomes(map, suite, name)) if (all.includes(home)) (out.own[home] ||= []).push(name);
  }
}

/**
 * The PR check's plan: only the steps this diff adds or edits, on Linux, in the suites a PR may run. No step changed = `none`, and no e2e job starts.
 * Why (2 Nov 2026, owner): a step that never ran reached a beta (#2954; wizard's step in #2963), yet PRs run no e2e (1 Nov 2026) — the one exception is a PR that touches the e2e itself.
 * A suite on the Mac, a `manual` or night-report suite, and a change outside a named step run after the merge (main-steps.yml), and the log says so.
 * facts: {all, cadence, linux: suite => bool}. -> {none, suites: [suite], steps: {suite: [names], '(stores)', '(why)'}, lines: [log line]}
 */
export async function pickChangedSteps({changedFiles, diff, sources, users, facts, map = {}, ownsStepOf}) {
  const {own, outside} = await ownSteps({changedFiles, diff, sources, users, all: facts.all, map, ownsStepOf});
  const steps = {}, stores = {}, dropped = {}, later = [];
  for (const [suite, names] of Object.entries(own)) {
    const wanted = [...new Set(names)];
    if (facts.cadence?.[suite] === 'manual' || facts.cadence?.[suite] === NIGHT_REPORT) { later.push(`${suite}: ${facts.cadence[suite]} suite, never on a PR (${wanted.map(name => `"${name}"`).join(', ')})`); continue; }
    if (!facts.linux(suite)) { later.push(`${suite}: runs on the Mac, after the merge (${wanted.map(name => `"${name}"`).join(', ')})`); continue; }
    let list = wanted;
    if (map.suites?.[suite]?.stores) {   // the store the steps were recorded on (coverage-pick.mjs storeFor); a new step has no record and goes with the rest
      const chosen = storeFor(map.suites[suite], wanted);
      if (!chosen.steps.length) { later.push(`${suite}: ${wanted.map(name => `"${name}"`).join(', ')} exist on no store a PR runs`); continue; }
      stores[suite] = chosen.store; list = chosen.steps;
      if (chosen.dropped.length) dropped[suite] = chosen.dropped;
    }
    steps[suite] = list;
  }
  const suites = Object.keys(steps);
  const lines = [...whyLines({suites, steps, stores, dropped, own}), ...later.map(line => `not on this PR: ${line}`),
    ...outside.map(({file}) => `not a step: ${file} changed outside a named step; its suites run after the merge`)];
  if (!suites.length) return {none: true, suites: [], steps: {}, lines: [`no step changed${lines.length ? ' on this PR' : ''}`, ...lines]};
  return {none: false, suites, steps: {...steps, ...(Object.keys(stores).length ? {[STORES]: stores} : {}), [WHY]: lines}, lines};
}
