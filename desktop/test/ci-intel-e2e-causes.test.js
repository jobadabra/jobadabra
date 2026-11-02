// The e2e cause rules (admin/e2e-causes.js), on the real reds of 20-27 Oct 2026 (measured 27 Oct: 220 red suites; rules 1-2 left 49% "unknown"/"not fixed yet" and "test bug" at 0).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {AI_CAUSES, CAUSES, CAUSE_IDS, causeId, causePrompt, changedKinds, factCause, failureLine, groupOf, likelyFixes, prCause, readAnswer, suiteOfJob, trailerCause, trailerCauses} from '../../tools/ci-intel/lib/e2e-causes.mjs';

test('a suite comes from a release run\'s job name, and from a standalone e2e.yml job\'s "Run the X suite (first try)" step (rules 1-2 missed every PR and after-merge red)', () => {
  assert.deepEqual(suiteOfJob('E2E · Windows · apply'), {suite: 'apply', platform: 'windows'});
  assert.deepEqual(suiteOfJob('E2E · Mac + Linux · strategy'), {suite: 'strategy', platform: 'mac'});
  assert.deepEqual(suiteOfJob('quality', [{name: 'Set up job'}, {name: 'Run the quality suite (first try)'}]), {suite: 'quality', platform: 'mac'});
  assert.deepEqual(suiteOfJob('settings', [{name: 'Run the settings suite on Windows'}], true), {suite: 'settings', platform: 'windows'});
  assert.equal(suiteOfJob('plan', [{name: 'Plan the suites'}]), null);
  assert.equal(suiteOfJob('Release · Mac beta'), null);
});

test('the failure line is the runner\'s own "✗ step: reason", never a "not run: over budget" follow-on, else the first error line', () => {
  const log = ['2026-10-27T01:01:39.5Z ✗ through all of it: Submit was never clicked: not run: the suite was over its 7-minute budget',
    '2026-10-27T01:01:39.6Z ✗ a Jobs check on the golden postings finishes and scores them: the suite\'s 7-minute budget ran out during this step', '##[error]Process completed with exit code 1.'].join('\n');
  assert.match(failureLine(log), /^✗ a Jobs check on the golden postings/);
  assert.equal(failureLine("tar: D\\:\\a\\_temp/free-ai-tree: Cannot open: No such file or directory\n##[error]Process completed with exit code 2."), 'tar: D\\:\\a\\_temp/free-ai-tree: Cannot open: No such file or directory');
  assert.equal(failureLine('##[error]Process completed with exit code 1.'), '');
});

test('facts name a red before any fix is read: runner, a CI step before the suite, credit, the PR picker, a green second try, the AI, the budget', () => {
  const red = (extra = {}) => ({jobConclusion: 'failure', rerun: 'failure', failedStep: 'First try failed: the apply suite once more, to tell flaky from real', ...extra});
  assert.equal(factCause(red({jobConclusion: 'cancelled'})), 'runner');
  assert.equal(factCause(red({log: 'npm error code ECONNRESET\nnpm error network aborted'})), 'runner');
  assert.equal(factCause(red({failedStep: "Free AI relay (CI's AI since 26 Oct 2026; the site's handler on this runner, CI's own Workers AI token)"})), 'ci', '26 Oct nightly: 32 Windows suites red on one relay step');
  assert.equal(factCause(red({failedStep: "A virtual display and Electron's libraries (Linux only)"})), 'ci', '26 Oct soak: tools/apt-install.sh missing in the tag\'s checkout');
  assert.equal(factCause(red({log: 'Your credit balance is too low to access the Anthropic API'})), 'ai');
  assert.equal(factCause(red({line: '✗ steps picked for this PR: no step is named "the app is seeded as a set-up install from the existing workspace" (renamed since the coverage map was recorded)'})), 'picker');
  assert.equal(factCause(red({rerun: 'success', line: '✗ anything'})), 'flake');
  assert.equal(factCause(red({rerun: 'success', line: '✗ picked step(s) not found: the app is seeded as a set-up install from the existing workspace'})), 'picker', 'a picker red passes once more (whole suite): still the picker, not a flake');
  assert.equal(factCause(red({line: '✗ scoring the same jobs again gives the same scores (within 8 points): scores are not stable: 3 of 9 jobs moved'})), 'ai');
  assert.equal(factCause(red({line: '✗ a Jobs check: the suite\'s 7-minute budget ran out during this step'})), 'timing');
  assert.equal(factCause(red({line: '✗ Automatic backup: the message does not name the file'})), null, 'a wrong value: only the fix can tell drift, test bug or product bug');
});

test('a fix that names its cause in an "E2E-cause:" trailer decides it; a harness-only fix is no longer "unknown" (rules 1-2 read none)', () => {
  assert.deepEqual(trailerCauses('Expect the backup message to name the file\n\nE2E-cause: drift settings, apply\nE2E-issue: none x'), [{cause: 'drift', suites: ['settings', 'apply']}]);
  assert.deepEqual(trailerCauses('E2E-cause: because settings'), [], 'only cause ids');
  const commits = [{sha: 'a1', message: 'Unrelated\n\nE2E-cause: product quality'}, {sha: 'b2', message: 'Fix the test\n\nE2E-cause: test applyflows'}];
  assert.deepEqual(trailerCause(commits, 'applyflows-2of2'), {cause: 'test', sha: 'b2'}, 'a slice is its suite');
  assert.equal(trailerCause(commits, 'settings'), null);
  assert.deepEqual(trailerCause([{sha: 'c3', message: 'x\n\nE2E-cause: drift'}], 'settings'), {cause: 'drift', sha: 'c3'}, 'no suite listed: every suite the commit fixes');
});

test('the AI sees the failure line and the likely fixes with what each changed, and only a listed cause is kept', () => {
  const commits = [{sha: 'a', message: 'Expect the backup message to name the file, not its folder', files: ['desktop/e2e/suites/settings.mjs']},
    {sha: 'b', message: 'Merge the Jobs filter chips into one multi-select menu', files: ['desktop/renderer/pages/jobs.js']}];
  const fixes = likelyFixes(commits, {suite: 'settings', line: '✗ Automatic backup: Back up now writes a backup: the message does not name the file'});
  assert.deepEqual(fixes.map(fix => fix.sha), ['a']);
  const prompt = causePrompt({suite: 'settings', kind: 'beta', line: '✗ the message does not name the file', fixes});
  assert.match(prompt.user, /1\. Expect the backup message to name the file, not its folder\n   why: \(no body\)\n   files: desktop\/e2e\/suites\/settings\.mjs \[tests\]/);
  const withWhy = causePrompt({suite: 'settings', kind: 'beta', line: 'x', fixes: [{message: 'Follow the new backup wording\n\nThe app now names the file.\n\nE2E-cause: drift settings', files: ['desktop/e2e/suites/settings.mjs'], diff: '-  "folder"\n+  "file"'}]});
  assert.match(withWhy.user, /why: The app now names the file\.\n/, 'the fix\'s body, trailers left out');
  assert.match(withWhy.user, /diff:\n-  "folder"/);
  assert.match(withWhy.system, /a timeout whose fix updates the test to the app's new screen or words is drift/);
  for (const id of AI_CAUSES) assert.match(prompt.system, new RegExp(`"${id}"`));
  assert.deepEqual(readAnswer('<x> {"cause": "drift", "fix": 1}'), {cause: 'drift', fix: 1});
  assert.equal(readAnswer('{"cause": "because"}'), null);
  assert.equal(readAnswer('no json'), null);
  assert.equal(changedKinds(['src/a.py', 'desktop/e2e/lib/x.mjs']), 'app+tests');
});

test('a PR red is judged on the PR: its own app files fixed = a bug caught; its own tests only = drift caught; the same commit green = flake', () => {
  const prFiles = ['desktop/lib/server.js', 'desktop/e2e/suites/wander.mjs'];
  assert.equal(prCause({fixFiles: ['desktop/lib/server.js', 'src/other.py'], prFiles}), 'product');
  assert.equal(prCause({fixFiles: ['desktop/e2e/suites/wander.mjs', 'src/rebased-from-main.py'], prFiles}), 'drift', 'files main brought in by a rebase are not the PR\'s fix');
  assert.equal(prCause({sameCommit: true}), 'flake');
  assert.equal(prCause({fixFiles: ['src/rebased.py'], prFiles}), null);
});

test('every cause has a group, a label, a colour and a hint; old rows read under today\'s ids', () => {
  assert.ok(CAUSES.every(cause => cause.label && cause.color && cause.hint && ['ours', 'tests', 'app', 'none'].includes(cause.group)));
  for (const id of ['ai', 'ci', 'picker', 'runner', 'flake', 'timing', 'drift', 'test', 'product', 'open', 'unknown']) assert.ok(CAUSE_IDS.includes(id), id);
  assert.equal(causeId('credit'), 'ai');
  assert.equal(causeId('infra'), 'runner');
  assert.equal(causeId('nonsense'), 'unknown');
  assert.equal(groupOf('drift'), 'tests');
  assert.equal(groupOf('ci'), 'ours');
});
