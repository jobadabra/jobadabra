// The PR check's plan: the e2e steps a PR's changed files reach, on Linux, at most PR_STEP_CAP steps. Pure; the CLI is desktop/e2e/pr-suites.mjs --plan --changed-steps.
// Job: pick the suites
// Why (10 Nov 2026, owner, asked via AskUserQuestion: "Yes, affected steps only (Recommended)" — "A PR touching covered files runs only the e2e steps that cover them, on Linux;
// e2e stays off for every other PR"): since 2 Nov, 23 of 44 red apply suites on main were Jobs check steps; each product PR passed and the step pinning the old words went red after
// the merge (#3297, #3300, #3448, #3573, #3630). The PR now runs what the after-merge run (main-steps.yml) would run for its diff, so that red lands on the PR.
import {STORES, WHY} from './pick-why.mjs';
import {NIGHT_REPORT} from './plan.mjs';

/**
 * The most steps one PR's e2e run takes; the rest run after the merge, named in the log. A hang guard on runner time, not a quality bar: no real plan reaches it.
 * Why (10 Nov 2026, measured on the after-merge plans of 2-10 Nov, whole suites counted by their mapped steps): p50 11, p90 39, max 45 over 53 plans, and #3297's plan on 5 Nov
 * was 53 (5 whole suites, apply's 25 among them: an escape this check must catch). The 26 Oct 2026 version of this rule had no cap: #1992 started 16 of 33 suites and waited
 * 15-60 min for runners.
 */
export const PR_STEP_CAP = 60;
const LINUX = 'ubuntu-24.04';

/**
 * {suite: bool}: true for each suite a PR's e2e run plays on Linux. e2e.yml builds a PR's matrix with os(suite, {pr: true}) (plan-run.mjs), where apply and applyflows, the Mac
 * for a release, run on Linux (lib/plan.mjs runnerOf). Why (10 Nov 2026): the PR check asked os(suite) and named every edited apply step "runs on the Mac, after the merge"
 * (#3637's own step never ran on its PR). facts: plan-run.mjs suiteFacts().
 */
export async function prLinux(facts) {
  return Object.fromEntries(await Promise.all(facts.all.map(async suite => [suite, (await facts.os(suite, {pr: true})) === LINUX])));
}
const SETUP = '(setup)';
// A dispatch's inputs are capped (65,535 characters in all): the reasons e2e.yml prints are cut as lib/pick-why.mjs cuts them.
const MAX_LINES = 150, MAX_LINE = 220;

/**
 * The step names a diff removes: named by a `ctx.run` in a file before and by no step file after (a rename or a deletion). The coverage map still holds the old name,
 * which the runner would fail as "not found" and then run the whole suite (#3587, run 42451945200); the PR runs the new name as an edited step instead.
 * before/after: [names] of every step call in the changed step files, before and after the diff (lib/pr-suites.mjs stepCalls). -> Set of names
 */
export function removedStepNames(before = [], after = []) {
  const now = new Set(after.filter(Boolean));
  return new Set(before.filter(name => name && !now.has(name)));
}

/**
 * The PR check's plan from the after-merge plan of the same diff (`full`) and the steps the diff adds or edits (`changed`, lib/own-steps.mjs pickChangedSteps).
 * Invariants: a Mac, manual or night-report suite never runs here (it runs after the merge, and the log says so); a suite the full plan runs whole stays whole; the edited
 * steps always run (the 2 Nov 2026 rule); the other suites fill the cap cheapest first, each whole or not at all, and every one left out is named "after the merge".
 * full: {suites, steps: {suite: [names]} (a suite of `suites` not in it runs whole), stores: {suite: store}, reasons: [whyLines line], parts: {suite: parts}};
 * changed: {suites, steps (with '(stores)'), lines}; linux: suite => bool; cadence: {suite: cadence}; stepTotal: suite => its step count (a whole run);
 * needsOf: (suite, names) => [the stepNeeds words the runner adds]; renamed: Set of removed names (removedStepNames).
 * -> {none, suites, steps: {suite: [names], '(parts)', '(stores)', '(why)'}, lines: [summary line], count}
 */
export function affectedPlan({full, changed, linux, cadence = {}, stepTotal, needsOf = () => [], renamed = new Set(), cap = PR_STEP_CAP}) {
  const later = [], edited = new Set(changed?.suites || []), candidates = [];
  for (const suite of [...new Set([...(full?.suites || []), ...edited])]) {
    if (cadence[suite] === 'manual' || cadence[suite] === NIGHT_REPORT) { later.push(`${suite}: ${cadence[suite]} suite, never on a PR`); continue; }
    if (!linux(suite)) { later.push(`${suite}: runs on the Mac, after the merge`); continue; }
    const whole = full?.suites?.includes(suite) && !full.steps?.[suite];
    const mapped = (full?.steps?.[suite] || []).filter(name => !renamed.has(name)), gone = (full?.steps?.[suite] || []).filter(name => renamed.has(name));
    for (const name of gone) later.push(`${suite}: "${name}" is renamed or removed by this PR; its new name runs as an edited step`);
    let names = whole ? null : [...new Set([...mapped, ...(changed?.steps?.[suite] || [])])];
    // Why (code review, 10 Nov 2026): a suite whose every mapped step was renamed and that has no edited step of its own would run nothing; the whole suite runs, as the runner's own renamed-pick fallback does (#3587).
    if (names && !names.length) { if (!gone.length) continue; names = null; }
    const real = (names || []).filter(name => name !== SETUP), needs = names ? needsOf(suite, real).filter(word => !real.some(name => name.toLowerCase() === word)) : [];
    candidates.push({suite, names, needs, cost: names ? Math.max(real.length, 1) + needs.length : stepTotal(suite), edited: edited.has(suite)});
  }
  // Edited steps first (never dropped), then the cheapest suites: more of the reached suites fit under the cap.
  candidates.sort((a, b) => Number(b.edited) - Number(a.edited) || a.cost - b.cost || (a.suite < b.suite ? -1 : 1));
  const kept = [];
  let count = 0;
  for (const entry of candidates) {
    if (!entry.edited && count + entry.cost > cap) { later.push(`${entry.suite}: ${entry.names ? `${entry.cost} step(s)` : `whole suite, ${entry.cost} steps`} over this PR's cap of ${cap}, after the merge`); continue; }
    kept.push(entry);
    count += entry.cost;
  }
  return planOut({kept, later, full, changed, count, cap});
}

// The plan's output from the kept suites: e2e.yml's pr_steps (a whole suite has no step list) and the summary lines. A pure move out of affectedPlan (clean-code gate).
function planOut({kept, later, full, changed, count, cap}) {
  const steps = {}, stores = {}, lines = [];
  for (const {suite, names, needs, cost} of kept) {
    if (names) steps[suite] = names;
    const store = full?.stores?.[suite] || changed?.steps?.[STORES]?.[suite];
    if (store && names) stores[suite] = store;
    lines.push(`${suite}${store && names ? ` [${store}]` : ''} · ${names ? `${names.length} step(s)` : 'whole suite'}, ${cost} counted${needs.length ? `; needs ${needs.map(word => `"${word}"`).join(', ')}` : ''}`);
    const why = [...new Set([...(full?.reasons || []), ...(changed?.lines || [])])].filter(line => line.startsWith(`${suite} `));
    lines.push(...why.map(line => `  ${line}`));
  }
  lines.push(...later.map(line => `not on this PR: ${line}`));
  const suites = kept.map(entry => entry.suite);
  if (!suites.length) return {none: true, suites: [], steps: {}, count: 0, lines: ['no e2e step covers the files this PR changes', ...lines]};
  lines.unshift(`${count} of at most ${cap} step(s) in ${suites.length} suite(s)`);
  const parts = Object.fromEntries(Object.entries(full?.parts || {}).filter(([suite]) => suites.includes(suite)));
  return {none: false, suites, count, lines, steps: {...steps, '(parts)': parts, ...(Object.keys(stores).length ? {[STORES]: stores} : {}), [WHY]: lines.slice(0, MAX_LINES).map(line => (line.length > MAX_LINE ? `${line.slice(0, MAX_LINE - 1)}…` : line))}};
}
