// Guard: release — an e2e step a PR adds or edits does not run on that PR.
// The PR check runs only the e2e steps a diff adds or edits (owner, 2 Nov 2026: "A PR adding a new e2e or modifying the e2e.. should have it as a PR CI check" — "the only exception when we run e2e on the PR level").
// Fixture diffs: a new step, an edited step, a lib-only change, a comment-only change, no e2e change at all; plus the Mac, shared-lib and outside-a-step cases.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {NIGHT_REPORT} from '../../lib/plan.mjs';
import {ownSteps, pickChangedSteps} from '../../lib/own-steps.mjs';

const JOBS = `import {x} from '../lib/y.mjs';
const helper = () => 1;
export default async ctx => {
  await ctx.run('first step', async () => {
    await one();
  });

  await ctx.run('second step', async () => {
    await two();
  });
};`;
const JOBS_WITH_NEW = `${JOBS.slice(0, JOBS.lastIndexOf('};'))}
  await ctx.run('a new step', async () => {
    await three();
  });
};`;
const SHARED = `export async function flows(ctx) {
  await ctx.run('shared step', async () => {
    await shared();
  });
}`;
const PLAIN_LIB = 'export const wait = ms => new Promise(done => setTimeout(done, ms));\nexport const other = 1;\n';

// What `git diff -U0` prints for lines [from, to] of a file, new side.
const diffOf = (file, ...ranges) => ranges.map(([from, to]) => `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -${from},${to - from + 1} +${from},${to - from + 1} @@\n+x\n`).join('');
const facts = (over = {}) => ({all: ['jobs', 'settings', 'wizard', 'apply'], cadence: {}, linux: () => true, ...over});
const pick = (changedFiles, diff, sources, extra = {}) => pickChangedSteps({changedFiles, diff, sources, users: extra.users || {}, facts: facts(extra.facts), map: extra.map || {}, ownsStepOf: extra.ownsStepOf});
const JOBS_FILE = 'desktop/e2e/suites/jobs.mjs';

test('a new step: it runs, alone, in its own suite', async () => {
  const lines = JOBS_WITH_NEW.split('\n'), at = lines.findIndex(line => line.includes("'a new step'")) + 1;
  const result = await pick([JOBS_FILE], diffOf(JOBS_FILE, [at, at + 2]), {'suites/jobs.mjs': JOBS_WITH_NEW});
  assert.equal(result.none, false);
  assert.deepEqual(result.suites, ['jobs']);
  assert.deepEqual(result.steps.jobs, ['a new step']);
  assert.ok(result.lines.some(line => line.includes('"a new step" ← its own step changed in this PR')), result.lines.join('\n'));
});

test('an edited step: only that step, not its neighbour and not the suite', async () => {
  const result = await pick([JOBS_FILE], diffOf(JOBS_FILE, [9, 9]), {'suites/jobs.mjs': JOBS});
  assert.deepEqual(result.steps.jobs, ['second step']);
  const both = await pick([JOBS_FILE], diffOf(JOBS_FILE, [5, 5], [9, 9]), {'suites/jobs.mjs': JOBS});
  assert.deepEqual(both.steps.jobs, ['first step', 'second step']);
});

test('a lib-only change with no steps in it runs nothing', async () => {
  const file = 'desktop/e2e/lib/wait.mjs';
  const result = await pick([file], diffOf(file, [1, 2]), {'lib/wait.mjs': PLAIN_LIB});
  assert.deepEqual([result.none, result.suites, result.steps], [true, [], {}]);
  assert.match(result.lines[0], /^no step changed/);
});

test('a comment-only or blank change inside a suite runs nothing', async () => {
  const text = JOBS.replace("    await one();", "    // why this call\n    await one();");
  const result = await pick([JOBS_FILE], diffOf(JOBS_FILE, [5, 5]), {'suites/jobs.mjs': text});
  assert.equal(result.none, true);
  const blank = await pick([JOBS_FILE], diffOf(JOBS_FILE, [7, 7]), {'suites/jobs.mjs': JOBS});
  assert.equal(blank.none, true);
});

test('no e2e file in the diff (the app, the extension, the docs): no step, no job', async () => {
  const files = ['desktop/renderer/jobs.js', 'extension/fill-flow.js', 'docs/ARCHITECTURE.md', 'desktop/e2e/lanes.json'];
  const result = await pick(files, files.map(file => diffOf(file, [1, 3])).join(''), {'suites/jobs.mjs': JOBS});
  assert.deepEqual([result.none, result.suites], [true, []]);
  assert.equal(result.lines.length, 1, 'one line: "no step changed"');
});

test('a change outside a named step (import, helper) is no changed step: it runs after the merge and the log says so', async () => {
  const result = await pick([JOBS_FILE], diffOf(JOBS_FILE, [2, 2]), {'suites/jobs.mjs': JOBS});
  assert.equal(result.none, true);
  assert.ok(result.lines.some(line => line.startsWith('not a step: desktop/e2e/suites/jobs.mjs')), result.lines.join('\n'));
});

// #2976 (2 Nov 2026), the PR check's first real PR: lib/wizard.mjs changed an import and the step "Jobs opens on the Find jobs card…", and the check ran nothing.
test('a step edited beside a change outside any step still runs on the PR; the outside change runs its suite after the merge', async () => {
  const result = await pick([JOBS_FILE], diffOf(JOBS_FILE, [1, 1], [9, 9]), {'suites/jobs.mjs': JOBS});
  assert.equal(result.none, false, result.lines.join('\n'));
  assert.deepEqual(result.steps.jobs, ['second step']);
  assert.ok(result.lines.some(line => line.startsWith('not a step: desktop/e2e/suites/jobs.mjs')), result.lines.join('\n'));
  const out = await ownSteps({changedFiles: [JOBS_FILE], diff: diffOf(JOBS_FILE, [1, 1], [9, 9]), sources: {'suites/jobs.mjs': JOBS}, users: {}, all: ['jobs']});
  assert.deepEqual([[...out.byStep], out.own], [[], {}], 'the after-merge picker still runs the file\'s suites whole');
});

test('a Mac suite, a manual suite and a night-report suite are not run on a PR; the Linux suite beside them is', async () => {
  const sources = {'suites/jobs.mjs': JOBS, 'suites/settings.mjs': JOBS.replace('first step', 'settings first'), 'suites/wizard.mjs': JOBS.replace('first step', 'wizard first'), 'suites/apply.mjs': JOBS.replace('first step', 'apply first')};
  const files = ['jobs', 'settings', 'wizard', 'apply'].map(name => `desktop/e2e/suites/${name}.mjs`);
  const result = await pick(files, files.map(file => diffOf(file, [5, 5])).join(''), sources, {facts: {linux: suite => suite !== 'settings', cadence: {wizard: 'manual', apply: NIGHT_REPORT}}});
  assert.deepEqual(result.suites, ['jobs']);
  assert.ok(result.lines.some(line => line.includes('settings: runs on the Mac')), result.lines.join('\n'));
  assert.ok(result.lines.some(line => line.includes('wizard: manual suite')), result.lines.join('\n'));
  assert.ok(result.lines.some(line => line.includes(`apply: ${NIGHT_REPORT} suite`)), result.lines.join('\n'));
});

test('a shared lib step goes to the suites that own it (ownsStep), not to every suite that imports the file', async () => {
  const file = 'desktop/e2e/lib/shared.mjs';
  const users = {'lib/shared.mjs': ['jobs', 'settings']};
  const sources = {'lib/shared.mjs': SHARED, 'suites/jobs.mjs': "import {flows} from '../lib/shared.mjs';\n", 'suites/settings.mjs': "import {flows} from '../lib/shared.mjs';\n"};
  const result = await pick([file], diffOf(file, [3, 3]), sources, {users, ownsStepOf: async suite => name => suite === 'settings' && name === 'shared step'});
  assert.deepEqual(Object.keys(result.steps).filter(key => !key.startsWith('(')), ['settings']);
  assert.deepEqual(result.steps.settings, ['shared step']);
});

test('the store its steps were recorded on is kept; a step recorded only on the other store is left out and named', async () => {
  const map = {suites: {jobs: {steps: {'first step': {}, 'second step': {}}, stores: {'first step': ['standin'], 'second step': ['sqlite']}}}};
  const result = await pick([JOBS_FILE], diffOf(JOBS_FILE, [5, 5], [9, 9]), {'suites/jobs.mjs': JOBS}, {map});
  assert.equal(result.steps['(stores)']?.jobs, 'sqlite');
  assert.deepEqual(result.steps.jobs, ['second step']);
  assert.ok(result.lines.some(line => line.includes('not run: "first step"')), result.lines.join('\n'));
});

test('ownSteps (the after-merge picker\'s loop, moved) still marks the suite file direct and a step file by step', async () => {
  const out = await ownSteps({changedFiles: [JOBS_FILE], diff: diffOf(JOBS_FILE, [9, 9]), sources: {'suites/jobs.mjs': JOBS}, users: {}, all: ['jobs']});
  assert.deepEqual([[...out.direct], [...out.byStep], out.own], [['jobs'], [JOBS_FILE], {jobs: ['second step']}]);
});
