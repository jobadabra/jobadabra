// Suite job medians use successful observations from the shared thirty-day e2e snapshot.
import assert from 'node:assert/strict';
import {test} from 'node:test';

const now = new Date('2026-10-30T12:00:00Z');
const run = (runId, seconds, extra = {}) => ({runId, createdAt: '2026-10-29T12:00:00Z', kind: 'scheduled', suiteJobs: [{suite: 'jobs', seconds}], ...extra});
const api = () => import('../../tools/ci-intel/lib/e2e-speed.mjs');

test('odd and even medians, nearest-rank spread, and slowest-first order', async () => {
  const {speedOf} = await api();
  const rows = [run(1, 100), run(2, 300), run(3, 200), run(4, 400),
    ...[6, 7, 9].map((seconds, i) => run(10 + i, seconds, {suiteJobs: [{suite: 'updates', seconds}]}))];
  assert.deepEqual(speedOf(rows, now), [
    {suite: 'jobs', median: 250, p25: 100, p95: 400, n: 4, kind: 'main'},
    {suite: 'updates', median: 7, p25: 6, p95: 9, n: 3, kind: 'main'}]);
});

test('two runs show their count without a median; legacy rows and invalid durations add no observation', async () => {
  const {speedOf} = await api();
  assert.deepEqual(speedOf([run(1, 10), run(2, 20), run(3, 90, {suiteJobs: undefined}),
    ...[-1, Infinity, NaN, null, true, '40', 86401].map((s, i) => run(i + 10, s))], now),
  [{suite: 'jobs', median: null, p25: null, p95: null, n: 2, kind: 'main'}]);
});

test('only main kinds inside the exact thirty-day window count, including its edge and excluding the future', async () => {
  const {speedOf} = await api();
  const rows = [run(1, 10, {kind: 'nightly', createdAt: '2026-09-30T12:00:00Z'}), run(2, 20, {kind: 'after-merge'}), run(3, 30),
    run(4, 900, {createdAt: '2026-09-30T11:59:59.999Z'}), run(5, 900, {createdAt: '2026-10-30T12:00:00.001Z'}),
    ...['pr', 'beta', 'soak', 'canary', 'harness'].map((kind, i) => run(i + 6, 900, {kind}))];
  assert.equal(speedOf(rows, now)[0].median, 20);
  assert.equal(speedOf(rows, now)[0].n, 3);
});

test('PR split warning is strictly over eight minutes, needs three runs, and excludes old and main jobs', async () => {
  const {slowPrSuites} = await api();
  const rows = [480, 481, 600].flatMap((seconds, j) => [1, 2, 3].map(i => run(j * 10 + i, seconds,
    {kind: 'pr', suiteJobs: [{suite: `suite-${seconds}`, seconds}]})));
  rows.push(run(40, 900, {kind: 'pr'}), run(41, 900, {kind: 'pr'}), run(42, 900), run(43, 900, {kind: 'pr', createdAt: '2026-09-01T12:00:00Z'}));
  assert.deepEqual(slowPrSuites(rows, now).map(r => [r.suite, r.median, r.n, r.kind]), [['suite-600', 600, 3, 'pr'], ['suite-481', 481, 3, 'pr']]);
});

test('a repeated run counts once; parallel jobs use the longest successful duration and shards keep their names', async () => {
  const {speedOf} = await api();
  const rows = [1, 2, 3].map(i => run(i, 10, {suiteJobs: [{suite: 'jobs', seconds: 10}, {suite: 'jobs', seconds: 20}, {suite: 'apply-1of2', seconds: 5}]}));
  const result = speedOf([...rows, rows[0]], now);
  assert.deepEqual(result.map(r => [r.suite, r.median, r.n]), [['jobs', 20, 3], ['apply-1of2', 5, 3]]);
});

test('collector job observations keep a failed job cap out of the main median', async () => {
  const {suiteJobTimes} = await import('../../tools/ci-intel/jobs/e2e-intel-rows.mjs');
  const {speedOf} = await api();
  const job = (seconds, conclusion) => ({name: 'jobs', conclusion,
    started_at: '2026-10-29T12:00:00Z', completed_at: new Date(Date.parse('2026-10-29T12:00:00Z') + seconds * 1000).toISOString(),
    steps: [{name: 'Run the jobs suite (first try)', conclusion}]});
  const rows = [304, 307, 310].map((seconds, i) => run(i + 1, seconds, {suiteJobs: suiteJobTimes({kind: 'scheduled', headBranch: 'main',
    jobs: [job(seconds, 'success'), job(900, 'failure'), job(1000, 'cancelled'), job(1100, 'skipped')]})}));
  assert.deepEqual(speedOf(rows, now), [{suite: 'jobs', median: 307, p25: 304, p95: 310, n: 3, kind: 'main'}]);
});
