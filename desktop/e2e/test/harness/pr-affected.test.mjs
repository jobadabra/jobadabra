// Guard: release — a PR that changes what an e2e step covers merges without running that step, and main goes red after the merge (#3297, #3573, #3630).
// The PR check's plan (owner, 10 Nov 2026, asked via AskUserQuestion: "Yes, affected steps only (Recommended)"): fixture diffs through the real chain (hunksFromDiff → stepsCovering
// → affectedPlan), with apply's real stepNeeds and the runner's real wantedWords. Cases: a renderer line the Jobs check runs, a docs file, a step's prerequisite, a renamed step,
// the Mac-for-release suite, the cap, a manual suite.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {hunksFromDiff, stepNamesFor, stepsCovering} from '../../lib/coverage-pick.mjs';
import {LOAD, pythonSteps, SETUP as SETUP_KEY, WHOLE} from '../../lib/coverage.mjs';
import {PR_STEP_CAP, affectedPlan, prLinux, removedStepNames} from '../../lib/pr-affected.mjs';
import {stepCalls} from '../../lib/pr-suites.mjs';
import {ensureStaged} from '../../lib/ensure-staged.mjs';

// Suite imports need generated shared/ even when this test runs alone in a fresh worktree.
ensureStaged(fileURLToPath(new URL('../../..', import.meta.url)));
const {stepNeeds} = await import('../../suites/apply.mjs');
const {wantedWords} = await import('../../lib/runner.mjs');

const CHECK = 'checking jobs before the form read exists guesses no mode: a job whose kit cannot be drafted says "Couldn\'t read" with its reason, no session starts, nothing is filled or sent';
const SETUP = 'the app has an applicant, jobs with drafted kits for every fixture form, and an AI that answers only what the kits do not';
const TRIAGE = 'desktop/renderer/pages/jobs-triage.js';
const map = {suites: {
  apply: {sha: 'aaa', files: {[TRIAGE]: {lines: [[1, 200]]}, 'desktop/lib/apply.js': {lines: [[1, 400]]}}, steps: {
    [SETUP]: {'desktop/lib/apply.js': {lines: [[10, 20]]}},
    [CHECK]: {[TRIAGE]: {lines: [[150, 170]]}},
  }},
  settings: {sha: 'aaa', files: {'desktop/lib/apply.js': {lines: [[1, 30]]}}, steps: {'the app is set up': {'desktop/lib/apply.js': {lines: [[1, 30]]}}}},
}};
const diffOf = (file, line) => `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -${line} +${line} @@\n-  toast(old);\n+  toast(renamed);\n`;
// The after-merge plan of a fixture diff, as pr-suites.mjs's mergePlan builds it from the coverage picks (no quotes or pointed files here).
const fullOf = diff => {
  const picked = stepsCovering(map, {aaa: hunksFromDiff(diff)});
  return {suites: Object.keys(picked), steps: stepNamesFor(picked), stores: {}, reasons: Object.entries(picked).map(([suite, pick]) => `${suite} · ${pick.reason}`)};
};
const base = {linux: () => true, stepTotal: suite => Object.keys(map.suites[suite]?.steps || {}).length || 25, needsOf: (suite, names) => wantedWords(names, suite === 'apply' ? stepNeeds : {})};

test('a renderer line the Jobs check runs picks that step, and its prerequisite is named and counted', () => {
  const plan = affectedPlan({...base, full: fullOf(diffOf(TRIAGE, 160)), changed: {suites: [], steps: {}}});
  assert.deepEqual(plan.suites, ['apply']);
  assert.deepEqual(plan.steps.apply, [CHECK]);
  assert.equal(plan.count, 2, 'the step and the setup step it needs');
  assert.ok(plan.lines.some(line => line.includes('needs "the app has an applicant"')), plan.lines.join('\n'));
});

test('a docs file reaches no step: nothing runs', () => {
  const plan = affectedPlan({...base, full: fullOf(diffOf('docs/rules/applying.md', 3)), changed: {suites: [], steps: {}}});
  assert.equal(plan.none, true);
  assert.deepEqual(plan.lines, ['no e2e step covers the files this PR changes']);
});

test('a step this PR renames runs by its new name, never the map\'s old one (no "picked step(s) not found")', () => {
  const before = `await ctx.run('old words', async () => {});\nawait ctx.run('kept', async () => {});`, after = `await ctx.run('new words', async () => {});\nawait ctx.run('kept', async () => {});`;
  const renamed = removedStepNames(stepCalls(before).map(call => call.name), stepCalls(after).map(call => call.name));
  assert.deepEqual([...renamed], ['old words']);
  const plan = affectedPlan({...base, renamed, full: {suites: ['settings'], steps: {settings: ['old words', 'kept']}}, changed: {suites: ['settings'], steps: {settings: ['new words']}}});
  assert.deepEqual(plan.steps.settings, ['kept', 'new words']);
  assert.ok(plan.lines.some(line => line.includes('"old words" is renamed or removed by this PR')));
});

test('apply, the Mac for a release, runs on Linux on a PR: the check asks the OS the PR dispatch uses', async () => {
  const facts = {all: ['apply', 'updates'], os: async (suite, {pr = false} = {}) => (suite === 'updates' || !pr ? 'macos-latest' : 'ubuntu-24.04')};
  const linux = await prLinux(facts);
  assert.deepEqual(linux, {apply: true, updates: false});
  const plan = affectedPlan({...base, linux: suite => linux[suite], full: {suites: ['apply', 'updates'], steps: {apply: [CHECK], updates: ['x']}}, changed: {suites: [], steps: {}}});
  assert.deepEqual(plan.suites, ['apply']);
  assert.ok(plan.lines.includes('not on this PR: updates: runs on the Mac, after the merge'));
});

test('over the cap: the cheapest suites run, a whole suite that does not fit waits for the merge, an edited step always runs', () => {
  const full = {suites: ['big', 'small', 'edited'], steps: {small: ['a', 'b']}};
  const plan = affectedPlan({...base, cap: 35, stepTotal: suite => ({big: 25, edited: 30})[suite], full, changed: {suites: ['edited'], steps: {edited: ['mine']}}});
  assert.deepEqual(plan.suites, ['edited', 'small']);
  assert.equal(plan.steps.edited, undefined, 'a suite the after-merge plan runs whole stays whole');
  assert.ok(plan.lines.includes('not on this PR: big: whole suite, 25 steps over this PR\'s cap of 35, after the merge'));
  assert.ok(PR_STEP_CAP >= 53, 'the cap fits #3297\'s plan (53 steps): an escape this check exists to catch');
});

test('a manual or night-report suite never runs on a PR', () => {
  const plan = affectedPlan({...base, cadence: {pool: 'manual'}, full: {suites: ['pool'], steps: {pool: ['x']}}, changed: {suites: [], steps: {}}});
  assert.equal(plan.none, true);
  assert.ok(plan.lines.includes('not on this PR: pool: manual suite, never on a PR'));
});

test('every mapped step of a suite renamed and none edited: the suite runs whole, never nothing', () => {
  const plan = affectedPlan({...base, renamed: new Set(['old a', 'old b']), stepTotal: () => 7, full: {suites: ['settings'], steps: {settings: ['old a', 'old b']}}, changed: {suites: [], steps: {}}});
  assert.deepEqual(plan.suites, ['settings']);
  assert.equal(plan.steps.settings, undefined, 'no step list: the whole suite');
  assert.equal(plan.count, 7);
});

test('a prerequisite already in the pick counts once toward the cap, not twice (Gitar on #3651)', () => {
  // stepNeeds names the setup step by a prefix; the pick holds its full name. wantedWords adds the prefix again, which is the same step.
  const full = {suites: ['apply'], steps: {apply: [CHECK, SETUP]}};
  const plan = affectedPlan({...base, full, changed: {suites: [], steps: {}}});
  assert.equal(plan.count, 2, 'the check and its setup step, each once');
  assert.ok(!plan.lines.some(line => line.includes('needs "the app has an applicant"')), plan.lines.join('\n'));
  const alone = affectedPlan({...base, full: {suites: ['apply'], steps: {apply: [CHECK]}}, changed: {suites: [], steps: {}}});
  assert.equal(alone.count, 2, 'without the setup in the pick it is still added and counted');
});

// #3973 (13 Nov 2026, run 43362599539): a Python-only PR ran apply, jobs and strategy whole because its changed lines (a def line, a docstring)
// were import-time lines, which the map filed under WHOLE beside real cross-step lines. Now they are LOAD: a step that only imports the file is not reached by them.
const PY = 'src/sources/careers.py';
const pyMap = {suites: {apply: {sha: 'aaa', files: {[PY]: {lines: [[1, 17], [150, 150], [313, 313], [323, 323], [330, 340]]}}, steps: {   // files: the union of every line it ran
  'a fill': {[PY]: {lines: [[330, 340]]}},
  [SETUP_KEY]: {},
  [WHOLE]: {[PY]: {lines: [[150, 150]]}},   // a body line a process ran across steps
  [LOAD]: {[PY]: {lines: [[1, 17], [313, 313], [323, 323]]}},   // import time: docstring, def lines
}}}};
const pyPick = (line, count = 1) => stepsCovering(pyMap, {aaa: hunksFromDiff(`diff --git a/${PY} b/${PY}\n--- a/${PY}\n+++ b/${PY}\n@@ -${line},${count} +${line},${count} @@\n-  old()\n+  new()\n`)});

test('a def line or docstring only the import ran picks no apply step, and the suite is not whole: one setup proves the file loads', () => {
  for (const line of [3, 313]) {
    const picked = pyPick(line);
    assert.equal(picked.apply.whole, false, `line ${line}: ${picked.apply.reason}`);
    assert.deepEqual(picked.apply.steps, [], `line ${line}`);
    assert.deepEqual(stepNamesFor(picked), {apply: [SETUP_KEY]}, `line ${line}: only the setup`);
  }
});

test('a changed line a step ran picks that step; a line a process ran across steps still runs the suite whole', () => {
  assert.deepEqual(pyPick(335).apply.steps, ['a fill']);
  assert.equal(pyPick(335).apply.whole, false);
  assert.equal(pyPick(150).apply.whole, true, 'cross-step body lines stay WHOLE');
});

test('the Python recorder files import-time lines under LOAD and a step\'s body lines under the step, never import lines under WHOLE', () => {
  const files = {'src/x.py': {body: [[20, 22]], load: [[1, 5]]}};
  const steps = pythonSteps({}, [{start: 'a fill', end: 'a fill', files}, {start: 'a fill', end: 'next', files: {'src/x.py': {body: [[30, 31]], load: [[1, 5]]}}}]);
  assert.deepEqual(steps['a fill']['src/x.py'].lines, [[20, 22]]);
  assert.deepEqual(steps[WHOLE]['src/x.py'].lines, [[30, 31]]);
  assert.deepEqual(steps[LOAD]['src/x.py'].lines, [[1, 5]]);
});
