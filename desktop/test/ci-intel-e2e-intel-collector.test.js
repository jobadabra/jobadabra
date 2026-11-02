// tools/ci-intel/jobs/e2e-intel-rows.mjs: from workflow runs of every kind to red suites and their causes, with no network (GitHub and the AI are stubs). Shapes from the runs of 26-27 Oct 2026.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {answerText, jobMinutes, kindOf, namedToRedo, passedFirst, redJobs, rowsOf, runsToRead} from '../../tools/ci-intel/jobs/e2e-intel-rows.mjs';

const step = (name, conclusion) => ({name, conclusion});
const job = (name, conclusion, steps = [], id = 1, at = {}) => ({id, name, conclusion, steps, created_at: '2026-10-26T20:00:00Z', started_at: '2026-10-26T20:02:00Z', completed_at: '2026-10-26T20:12:00Z', ...at});
const first = (suite, conclusion = 'success') => step(`Run the ${suite} suite (first try)`, conclusion);
const once = (suite, conclusion) => step(`First try failed: the ${suite} suite once more, to tell flaky from real`, conclusion);
const run = (databaseId, createdAt, headSha, jobs, extra = {}) => ({databaseId, createdAt, updatedAt: createdAt.replace(':01:', ':27:'), headSha, headBranch: 'main', conclusion: 'failure', kind: 'beta', workflow: 'e2e.yml', jobs, ...extra});
const none = {commitsBetween: async () => [], filesBetween: async () => [], filesOf: async () => [], prFiles: async () => [], ask: async () => null};

test('every run kind is named from its title; bisects, mutants and runs by hand on main are left out', () => {
  const k = (displayTitle, workflow = 'e2e.yml', extra = {}) => kindOf({displayTitle, headBranch: 'main', event: 'workflow_dispatch', ...extra}, workflow);
  assert.equal(k('Release · Build, test, beta · Nightly 0.9.1', 'desktop.yml'), 'nightly');
  assert.equal(k('Release · Build, test, beta · Beta by hand', 'desktop.yml'), 'beta');
  assert.equal(k('E2E for PR · settings · cv-facts-checks'), 'pr');
  assert.equal(k('E2E after merge · abc123 · quality'), 'after-merge');
  assert.equal(k('E2E check · on time (Worker cron)'), 'scheduled');
  assert.equal(k('Night burn-in 2/5 · main'), 'nightly', 'a real title of 31 Oct 2026 (run on main, started by workflow_dispatch): without a kind no night was ever read');
  assert.equal(k('Night burn-in 5/5 · main'), 'nightly');
  assert.equal(k('RC soak v0.9.1-rc.2'), 'soak');
  assert.equal(k('Bisect quality v1'), null);
  assert.equal(k('Mutant m3'), null);
  assert.equal(k('E2E Mac + Linux · all suites · main'), null);
  assert.equal(k('E2E Mac + Linux · all suites · role-kinds-app', 'e2e.yml', {headBranch: 'role-kinds-app'}), 'pr', 'a PR run before 26 Oct');
  assert.equal(k('CI · Harness tests (daily)', 'harness-daily.yml'), 'harness');
});

test('red jobs: standalone e2e.yml jobs by their first-try step, a release run\'s by name; a green second try is a flake; a PR job a newer push cancelled is no red', () => {
  const r = run(1, '2026-10-26T20:01:00Z', 'aaa', [job('plan', 'success'), job('quality', 'failure', [first('quality'), once('quality', 'failure')], 10),
    job('settings', 'success', [first('settings'), once('settings', 'success')], 11), job('E2E · Windows · apply', 'failure', [step('Run the apply suite on Windows', 'failure')], 12),
    job('jobs', 'success', [first('jobs'), once('jobs', 'skipped')], 13)]);
  assert.deepEqual(redJobs(r).map(red => [red.suite, red.platform, red.rerun]), [['quality', 'mac', 'failure'], ['settings', 'mac', 'success'], ['apply', 'windows', undefined]]);
  assert.equal(passedFirst(r, 'jobs', 'mac'), true);
  assert.equal(passedFirst(r, 'settings', 'mac'), false);
  const pr = run(2, '2026-10-26T20:01:00Z', 'bbb', [job('quality', 'cancelled', [first('quality')], 20)], {kind: 'pr'});
  assert.deepEqual(redJobs(pr), []);
});

test('a run\'s minutes split into waiting for a runner and running (6e: #2199 waited 8.5 min, ran 73 s)', () => {
  assert.deepEqual(jobMinutes([job('plan', 'success', [], 1, {created_at: '2026-10-27T01:00:00Z', started_at: '2026-10-27T01:06:00Z', completed_at: '2026-10-27T01:07:00Z'}),
    job('settings', 'success', [], 2, {created_at: '2026-10-27T01:07:00Z', started_at: '2026-10-27T01:09:30Z', completed_at: '2026-10-27T01:10:43Z'})]), {queueMin: 8.5, runMin: 2.2});
});

test('causes: a CI step before the suite is "ci" without reading any fix; a wrong value goes to the fix\'s trailer, then the AI; no next green is "open"', async () => {
  const relay = job('E2E · Windows · apply', 'failure', [step("Free AI relay (CI's AI since 26 Oct 2026)", 'failure')], 10);
  const wrong = job('settings', 'failure', [first('settings'), once('settings', 'failure')], 11), stuck = job('quality', 'failure', [first('quality'), once('quality', 'failure')], 12);
  const green = job('settings', 'success', [first('settings')], 21);
  const runs = [run(1, '2026-10-26T03:01:00Z', 'aaa', [relay, wrong, stuck], {kind: 'nightly'}), run(2, '2026-10-26T09:01:00Z', 'bbb', [green], {kind: 'scheduled', conclusion: 'success'})];
  const logs = {10: 'tar: D\\:\\a\\_temp/free-ai-tree: Cannot open', 11: '✗ Automatic backup: the message does not name the file: "Backed up ✓ ..."', 12: '✗ every enriched fact equals the ground truth: 2 wrong'};
  const asked = [];
  const deps = {...none, commitsBetween: async (a, b) => (a === 'aaa' && b === 'bbb' ? [{sha: 'f1', message: 'Expect the backup message to name the file, not its folder'}] : null),
    filesOf: async () => ['desktop/e2e/suites/settings.mjs'], diffOf: async () => '-  expect(folder)\n+  expect(file)', ask: async prompt => { asked.push(prompt.user); return '{"cause": "drift", "fix": 1}'; }};
  const rows = await rowsOf(runs, {logOf: id => logs[id] ?? '', ...deps});
  assert.deepEqual(rows.fails.map(fail => [fail.suite, fail.platform, fail.kind, fail.cause, fail.fix]), [['apply', 'windows', 'nightly', 'ci', ''], ['settings', 'mac', 'nightly', 'drift', 'f1'], ['quality', 'mac', 'nightly', 'open', '']]);
  assert.match(rows.fails[0].line, /free-ai-tree/);
  assert.equal(asked.length, 1);
  assert.match(asked[0], /files: desktop\/e2e\/suites\/settings\.mjs \[tests\]/);
  assert.match(asked[0], /diff:\n-  expect\(folder\)/, 'the AI reads the likeliest fixes\' diffs (without them it agreed with a hand reading on 13 of 23)');
  const nothing = await rowsOf(runs, {logOf: id => logs[id] ?? '', ...deps, commitsBetween: async () => [{sha: 'z1', message: 'Merge the Jobs filter chips'}], ask: async () => { throw new Error('no fix to judge: no AI'); }});
  assert.equal(nothing.fails[1].cause, 'unknown', 'no likely fix: unknown without asking');
  const trailer = await rowsOf(runs, {logOf: id => logs[id] ?? '', ...deps, commitsBetween: async () => [{sha: 't9', message: 'Fix it\n\nE2E-cause: test settings'}], ask: async () => { throw new Error('the trailer decides; no AI'); }});
  assert.equal(trailer.fails[1].cause, 'test');
  const noAi = await rowsOf(runs, {logOf: id => logs[id] ?? '', ...deps, ask: async () => null});
  assert.equal(noAi.fails[1].cause, 'unknown', 'no AI answer: unknown, never a guess');
  const unread = await rowsOf(runs, {logOf: () => null, ...deps});
  assert.equal(unread.fails[1].cause, 'unknown', 'a log not read this pass is read again later');
});

test('a PR red is judged by its own next push: the PR\'s app files fixed = caught; the PR\'s run row carries its queue and running minutes', async () => {
  const red = job('wander', 'failure', [first('wander'), once('wander', 'failure')], 30), green = job('wander', 'success', [first('wander')], 31);
  const runs = [run(5, '2026-10-26T10:01:00Z', 'p1', [red], {kind: 'pr', headBranch: 'store-setup', pr: 2123}), run(6, '2026-10-26T11:01:00Z', 'p2', [green], {kind: 'pr', headBranch: 'store-setup', pr: 2123, conclusion: 'success'}),
    run(7, '2026-10-26T10:30:00Z', 'm1', [job('wander', 'success', [first('wander')], 40)], {kind: 'after-merge', conclusion: 'success'})].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const rows = await rowsOf(runs, {logOf: () => '✗ [wander] error-shown: Error invoking remote method \'strategyData\'', ...none,
    filesBetween: async () => ['desktop/lib/server.js', 'src/from-main.py'], prFiles: async pr => (pr === 2123 ? ['desktop/lib/server.js'] : [])});
  assert.deepEqual(rows.fails.map(fail => [fail.suite, fail.kind, fail.cause, fail.caught]), [['wander', 'pr', 'product', 1]]);
  assert.deepEqual(rows.runs.find(row => row.runId === 5), {runId: 5, createdAt: '2026-10-26T10:01:00Z', kind: 'pr', conclusion: 'failure', minutes: 26, queueMin: 2, runMin: 10, suiteJobs: [], pr: 2123});
});

test('a cancelled run is a stored try with no reds', async () => {
  const rows = await rowsOf([run(1, '2026-10-17T20:01:00Z', 'aaa', [job('E2E · Mac + Linux · apply', 'cancelled', [], 10)], {conclusion: 'cancelled'})], none);
  assert.deepEqual(rows.runs.map(row => [row.runId, row.conclusion]), [[1, 'cancelled']]);
  assert.deepEqual(rows.fails, []);
});

test('new runs are read newest first, at most a pass\'s worth; with nothing new the pending ones are read again', () => {
  const listed = [1, 2, 3, 4, 5].map(databaseId => ({databaseId}));
  assert.deepEqual(runsToRead(listed, new Set([1]), new Set(), 3).map(r => r.databaseId), [3, 4, 5]);
  assert.deepEqual(runsToRead(listed, new Set([1, 2, 3, 4, 5]), new Set([2])).map(r => r.databaseId), [2]);
});

test('the AI\'s answer is read as text in every shape Workers AI gives: a string, OpenAI-style choices, or the JSON already parsed', () => {
  assert.equal(answerText({result: {response: '{"cause": "drift", "fix": 1}'}}), '{"cause": "drift", "fix": 1}');
  assert.equal(answerText({result: {choices: [{message: {content: '<think>hm</think>\n{"cause": "test", "fix": 2}', reasoning: 'x'}}]}}), '\n{"cause": "test", "fix": 2}');
  assert.equal(answerText({result: {response: {cause: 'product', fix: 1}}}), '{"cause":"product","fix":1}', '27 Oct 2026: 29 of 29 answers read "[object Object]"');
  assert.equal(answerText({errors: [{message: 'no'}]}), '');
});

test('the hourly registry reader pins the public repo to main; a failed read is omitted, not an empty registry', async () => {
  const {readLanes} = await import('../../tools/ci-intel/jobs/e2e-intel.mjs');
  const lanes = {suites: {quality: {lane: 'tolerant', input: 'ai', since: '2026-10-29', why: 'Unkeyed question'}}};
  const calls = [];
  assert.deepEqual(await readLanes(async (...args) => { calls.push(args); return lanes; }), lanes);
  // Why (2 Nov 2026, owner): the job reads the repo it runs in (GITHUB_REPOSITORY), not a name fixed in code; it was GarryOne/jobadabra, which GitHub's search no longer finds since the move to the org.
  assert.equal(calls.length, 1);
  assert.match(calls[0][1], /^repos\/[\w.-]+\/[\w.-]+\/contents\/desktop\/e2e\/lanes\.json\?ref=main$/);
  assert.deepEqual([calls[0][0], ...calls[0].slice(2)], ['api', '-H', 'Accept: application/vnd.github.raw+json']);
  assert.equal(await readLanes(async () => null), undefined);
});

test('night history records observed suite jobs, including first-try reds, never unrelated greens or PRs', async () => {
  const jobs = [job('quality', 'success', [first('quality'), once('quality', 'success')]), job('settings', 'success', [first('settings')]), job('plan', 'success'), job('apply', 'skipped')];
  const rows = await rowsOf([run(90, '2026-10-29T21:01:00Z', 'a', jobs, {kind: 'scheduled'}), run(91, '2026-10-30T21:01:00Z', 'b', jobs, {kind: 'pr'})], none);
  assert.deepEqual(rows.suiteNights.map(row => [row.suite, row.green, row.runId]), [['quality', false, 90], ['settings', true, 90]]);
});

test('a registry arriving after runs were settled still backfills seven nights from their existing GitHub jobs', async () => {
  const {nightRunsToRead} = await import('../../tools/ci-intel/jobs/e2e-intel-rows.mjs');
  const listed = Array.from({length: 9}, (_, i) => ({databaseId: i + 1, kind: 'nightly', conclusion: 'success', createdAt: `2026-10-${20 + i}T21:00:00Z`}));
  assert.deepEqual(nightRunsToRead(listed, new Set([9])).map(row => row.databaseId), [3, 4, 5, 6, 7, 8]);
  assert.deepEqual(nightRunsToRead(listed, new Set(), 2).map(row => row.databaseId), [8, 9]);
});

test('a beta run\'s suite jobs become green / red / not-run counts, red names and a release flag; a run whose jobs were not read gives no row', async () => {
  const {betaRunRow, betaRunsToRead} = await import('../../tools/ci-intel/jobs/e2e-intel-rows.mjs');
  const at = new Date('2026-11-01T12:00:00Z'), e2e = (platform, suite, conclusion) => job(`E2E · ${platform} · ${suite}`, conclusion);
  const jobs = [e2e('Mac + Linux', 'apply', 'success'), e2e('Mac + Linux', 'foryou', 'failure'), e2e('Windows', 'foryou', 'timed_out'), e2e('Windows', 'apply', 'skipped'), e2e('Windows', 'jobs', 'cancelled'), e2e('Mac + Linux', 'quality', null),
    job('Build · Mac', 'success'), job('Release · Mac beta', 'success'), job('Release · Windows beta', 'success')];
  const base = run(7, '2026-10-31T10:01:00Z', 'abcdef1234567890', jobs, {workflow: 'desktop.yml', conclusion: 'failure'});
  assert.deepEqual(betaRunRow(base, at), {runId: 7, createdAt: '2026-10-31T10:01:00Z', sha: 'abcdef1', conclusion: 'failure', green: 1, red: 2, grey: 3, released: true, redSuites: ['Mac + Linux · foryou', 'Windows · foryou']},
    'build and release jobs are not suites; skipped, cancelled and unfinished jobs are grey; timed_out is red');
  assert.equal(betaRunRow({...base, jobs: jobs.slice(0, 6).concat(job('Release · Mac beta', 'success'), job('Release · Windows beta', 'failure'))}, at).released, false, 'one failed Release job = not released');
  assert.equal(betaRunRow({...base, jobs: jobs.slice(0, 6)}, at).released, false, 'no Release job = not released');
  assert.equal(betaRunRow({...base, jobs: undefined}, at), null, 'jobs not read (a failed GitHub call): no row, read again next hour; never zero suites');
  assert.equal(betaRunRow({...base, kind: 'nightly'}, at), null);
  assert.deepEqual(betaRunRow({...base, jobs: []}, at).green, 0, 'a run with no suite jobs at all is a real row of zeros');
  const listed = Array.from({length: 5}, (_, i) => ({databaseId: i + 1, kind: i === 2 ? 'nightly' : 'beta', createdAt: `2026-10-${20 + i}T10:00:00Z`}));
  assert.deepEqual(betaRunsToRead(listed, new Set([1]), 40, at).map(item => item.databaseId), [2, 4, 5], 'beta runs the site lacks, nightlies never');
  assert.deepEqual(betaRunsToRead(listed, new Set(), 2, at).map(item => item.databaseId), [4, 5], 'newest first within a pass\'s cap');
  assert.deepEqual(betaRunsToRead([{databaseId: 8, kind: 'beta', createdAt: '2026-10-02T10:00:00Z'}, {databaseId: 9, kind: 'beta', createdAt: '2026-10-02T12:30:00Z'}], new Set(), 40, at).map(item => item.databaseId), [9],
    'a run past the 30-day keep window is never read (cleanBetaRun would drop its row, so it would be read again every hour)');
});

// Same fixture strings as public desktop/test/owner-report.test.js on branch escapes.
test('escape parser pins the public escapeOf shapes and rejects malformed trailers', async () => {
  const {escapeOf} = await import('../../tools/ci-intel/jobs/e2e-intel.mjs');
  assert.deepEqual(escapeOf('Fix X\n\nEscaped-e2e: apply, jobs — open a job — then fill'),
    {suites: ['apply', 'jobs'], none: false, journey: 'open a job — then fill'});
  assert.deepEqual(escapeOf('Fix X\n\nEscaped-e2e: no suite — enforce a rule'),
    {suites: [], none: true, journey: 'enforce a rule'});
  assert.equal(escapeOf('Fix X'), null);
  for (const value of ['apply', 'apply — ', ' — fill a form', 'apply, — fill a form', 'no suite, apply — fill a form']) {
    assert.equal(escapeOf(`Fix X\n\nEscaped-e2e: ${value}`), null, value);
  }
});

test('the existing main clone supplies weekly escapes as well as work, without another network read', async () => {
  const {readWork} = await import('../../tools/ci-intel/jobs/e2e-intel.mjs');
  const calls = [], a = 'a'.repeat(40), b = 'b'.repeat(40);
  const rows = readWork('2026-10-01', (command, args) => {
    calls.push([command, args]);
    assert.equal(command, 'git');
    if (args[0] === 'clone') return '';
    if (args.includes('--name-only')) return `@@${a} 2026-10-27\n\ndesktop/lib/server.js\n`;
    return `\x1e${a}\0${'2026-10-27'}\0Fix X\n\nEscaped-e2e: apply — fill a form\n\x1e${b}\0${'2026-10-28'}\0Fix X\n\nEscaped-e2e: no suite — enforce a rule\n\x1e${'c'.repeat(40)}\0${'2026-10-29'}\0Escaped-e2e: apply, — broken\n\x1e${'d'.repeat(40)}\0${'2026-10-29'}\0No trailer\n`;
  });
  assert.deepEqual(rows.escapes, [
    {week: '2026-10-26', sha: a, suites: ['apply'], none: false, journey: 'fill a form'},
    {week: '2026-10-26', sha: b, suites: [], none: true, journey: 'enforce a rule'},
  ]);
  assert.equal(rows.work.reduce((n, row) => n + row.commits, 0), 1);
  assert.equal(calls.filter(([, args]) => args[0] === 'clone').length, 1);
  assert.ok(calls[0][1].includes('--branch=main'), 'the clone is public main, never the PR branch');
  const failed = readWork('2026-10-01', () => { throw new Error('offline read failure'); });
  assert.equal(failed.escapes, undefined, 'an unreadable main must not erase the last escapes');
});

test('run rows carry bounded successful suite job seconds, never red/retried jobs or setup jobs', async () => {
  const jobs = [job('plan', 'success'), job('jobs', 'success', [first('jobs')], 1, {started_at: '2026-10-29T20:02:00Z', completed_at: '2026-10-29T20:07:07Z'}),
    job('quality', 'failure', [first('quality')]), job('settings', 'success', [first('settings'), once('settings', 'success')]),
    job('updates', 'success', [first('updates')], 5, {started_at: 'bad'}), job('apply', 'success', [first('apply')], 6, {completed_at: '2026-10-25T20:00:00Z'})];
  const rows = await rowsOf([run(1, '2026-10-29T20:01:00Z', 'a', jobs, {kind: 'scheduled'})], none);
  assert.deepEqual(rows.runs[0].suiteJobs, [{suite: 'jobs', seconds: 307}]);
  const branch = await rowsOf([run(2, '2026-10-29T20:01:00Z', 'b', jobs, {kind: 'nightly', headBranch: 'release-experiment'})], none);
  assert.deepEqual(branch.runs[0].suiteJobs, [], 'main timings never include a release branch');
});

// 2 Nov 2026 (owner: "has this caught bug been counted?"): apply-1of3 went red on main (run 41412195017), came and went; #2982 and #2986 sit between it and its next green, the real fix #2988 after.
const WINDOW = [{sha: '3c7df52c', message: 'Rules say a PR runs the e2e steps it changes (#2982)\n\nE2E-cause: none rule texts only; no suite was red'}, {sha: '0f360260', message: 'A hung step names the wait (#2986)\n\nE2E-cause: runner apply'}];
const REAL_FIX = {sha: '9d511a1c9d511a1c9d511a1c9d511a1c9d511a1c', message: 'Start picks jobs from the kept list only (#2988)\n\nE2E-cause: product apply 41412195017'};
const onlyTry = (suite, conclusion = 'success') => step(`Run the ${suite} suite (the only try)`, conclusion);   // the step's name since 31 Oct 2026 (91976ad7); no second try
const applyRuns = (kind = 'scheduled', second = null) => [
  run(41412195017, '2026-11-02T08:19:00Z', 'cfe7a113', [job('apply-1of3', 'failure', second ? [first('apply-1of3', 'failure'), once('apply-1of3', second)] : [onlyTry('apply-1of3', 'failure')], 30)], {kind}),
  run(41419999999, '2026-11-02T09:19:00Z', '0f360260', [job('apply-1of3', 'success', [onlyTry('apply-1of3')], 31)], {kind, conclusion: 'success'})];
const applyLog = {30: '✗ [apply] Start: it picked jobs from the kept list'};

test('a main red takes the fix that names its run id, not the one the window reads; and it counts as a caught bug whatever the run kind', async () => {
  const deps = {...none, commitsBetween: async () => WINDOW, ask: async () => { throw new Error('a named fix needs no AI'); }};
  const today = await rowsOf(applyRuns(), {logOf: id => applyLog[id] ?? '', ...deps});
  assert.deepEqual([today.fails[0].cause, today.fails[0].fix, today.fails[0].caught], ['runner', '0f360260', 0], 'without the naming commit the window answer stays (the fallback)');
  const named = await rowsOf(applyRuns(), {logOf: id => applyLog[id] ?? '', ...deps, namedCommits: [REAL_FIX]});
  assert.deepEqual([named.fails[0].cause, named.fails[0].fix, named.fails[0].caught, named.fails[0].kind, named.fails[0].named], ['product', REAL_FIX.sha, 1, 'scheduled', 1]);
  for (const kind of ['after-merge', 'nightly', 'beta']) {
    const other = await rowsOf(applyRuns(kind), {logOf: id => applyLog[id] ?? '', ...deps, namedCommits: [REAL_FIX]});
    assert.equal(other.fails[0].caught, 1, `${kind}: caught`);
  }
  const noNext = await rowsOf(applyRuns().slice(0, 1), {logOf: id => applyLog[id] ?? '', ...deps, namedCommits: [REAL_FIX]});
  assert.equal(noNext.fails[0].cause, 'product', 'a named fix needs no later green');
  const flake = await rowsOf(applyRuns('scheduled', 'success'), {logOf: id => applyLog[id] ?? '', ...deps, namedCommits: [REAL_FIX]});
  assert.equal(flake.fails[0].cause, 'product', 'an intermittent bug passes on the second try: the fix that names the run says what it was');
  const hang = await rowsOf(applyRuns(), {logOf: () => '✗ [apply] Start: the suite\'s 7-minute budget ran out during this step', ...deps, namedCommits: [REAL_FIX]});
  assert.equal(hang.fails[0].cause, 'product', 'a hang reads "timing" from its words; the fix that names the run says it was the app (the real red of 2 Nov)');
  const hangUnnamed = await rowsOf(applyRuns(), {logOf: () => '✗ [apply] Start: the suite\'s 7-minute budget ran out during this step', ...deps});
  assert.equal(hangUnnamed.fails[0].cause, 'timing', 'and without a naming fix it stays timing');
  const unread = await rowsOf(applyRuns(), {logOf: () => null, ...deps, namedCommits: [REAL_FIX]});
  assert.equal(unread.fails[0].cause, 'unknown', 'a log not read is still read again later: the failure line is stored with the cause');
  const infra = await rowsOf(applyRuns(), {logOf: () => 'The runner has received a shutdown signal', ...deps, namedCommits: [REAL_FIX]});
  assert.equal(infra.fails[0].cause, 'runner', 'a lost runner is a fact no trailer overrides');
  const other = await rowsOf(applyRuns(), {logOf: id => applyLog[id] ?? '', ...deps, namedCommits: [{...REAL_FIX, message: 'x\n\nE2E-cause: product apply 41400000000'}]});
  assert.equal(other.fails[0].cause, 'runner', 'a trailer naming another run changes nothing');
});

test('a product red on a night or a beta counts as caught; so does a PR\'s; a test-bug red does not', async () => {
  const deps = {...none, commitsBetween: async () => [{sha: 'p1', message: 'Fix the app\n\nE2E-cause: product apply'}]};
  for (const [kind, cause, caught] of [['nightly', 'product', 1], ['beta', 'product', 1], ['scheduled', 'test', 0]]) {
    const rows = await rowsOf(applyRuns(kind), {logOf: id => applyLog[id] ?? '', ...deps, commitsBetween: async () => [{sha: 'p1', message: `Fix\n\nE2E-cause: ${cause} apply`}]});
    assert.equal(rows.fails[0].caught, caught, `${kind} ${cause}`);
  }
});

test('a named run is read again only when one of its stored reds would take the name, so it settles (Gitar on #2995: a run that never takes it looped every hour)', () => {
  const second = {sha: 'b', message: 'x\n\nE2E-cause: product apply 41412195017'};
  const stored = (cause, fix = '', suite = 'apply-1of3', kind = 'scheduled', run = 41412195017) => [[run, suite, cause, fix, kind]];
  assert.deepEqual([...namedToRedo([REAL_FIX], stored('timing'))], [41412195017], 'the real red read as timing: the name changes it');
  assert.deepEqual([...namedToRedo([REAL_FIX], stored('runner', '0f360260'))], [], 'a lost runner is a fact no name changes: never read again');
  for (const hard of ['ci', 'picker', 'ai']) assert.deepEqual([...namedToRedo([REAL_FIX], stored(hard))], [], hard);
  assert.deepEqual([...namedToRedo([REAL_FIX], stored('product', REAL_FIX.sha))], [], 'it took the name: settled');
  assert.deepEqual([...namedToRedo([REAL_FIX], stored('timing', '', 'apply-1of3', 'pr'))], [], 'a pull-request run never takes a main commit\'s name');
  assert.deepEqual([...namedToRedo([REAL_FIX], stored('timing', '', 'quality'))], [], 'the named suite was not the red one: nothing would change');
  assert.deepEqual([...namedToRedo([REAL_FIX], stored('timing', '', 'apply-1of3', 'scheduled', 41400000000))], [], 'another run');
  assert.deepEqual([...namedToRedo([second, REAL_FIX], stored('product', REAL_FIX.sha))], [41412195017], 'a newer commit that names it corrects the older word: read once');
  assert.deepEqual([...namedToRedo([second, REAL_FIX], stored('product', 'b'))], [], 'and then it is settled');
  assert.deepEqual([...namedToRedo([{sha: 'c', message: 'no trailer'}], stored('timing'))], []);
  const listed = [1, 2, 3, 4, 5].map(id => ({databaseId: id}));
  assert.deepEqual(runsToRead(listed, new Set([1, 2, 3, 4, 5]), new Set([2]), 200, new Set([4])).map(r => r.databaseId), [2, 4], 'a named run is read again with the waiting ones');
  assert.deepEqual(runsToRead(listed, new Set([1, 2, 3, 4]), new Set(), 200, new Set([1])).map(r => r.databaseId), [1, 5], 'and with the new ones');
});

test('the newest commit that names a run speaks for all its reds: a suite it does not list keeps its own cause and the run still settles', async () => {
  const other = {sha: 'n1', message: 'x\n\nE2E-cause: drift quality 41412195017'};
  const deps = {...none, commitsBetween: async () => WINDOW};
  const rows = await rowsOf(applyRuns(), {logOf: id => applyLog[id] ?? '', ...deps, namedCommits: [other, REAL_FIX]});
  assert.equal(rows.fails[0].cause, 'runner', 'the newest naming commit lists only quality: the older apply word does not apply to this red');
  assert.deepEqual([...namedToRedo([other, REAL_FIX], [[41412195017, 'apply-1of3', 'runner', '0f360260', 'scheduled']])], [], 'and it is not read again: nothing the name says would change it');
});
