// Successful e2e suite job timings, retained in the shared snapshot for page and weekly speed reports.
const DAY = 86400000, MAIN_KINDS = ['main', 'after-merge', 'nightly', 'scheduled'];
// Why (30 Oct 2026, owner): public CLAUDE.md gives a PR's own jobs a 10-minute CI budget; this is job time, including setup, not a suite's step cap.
export const PR_JOB_BUDGET_SECONDS = 10 * 60;
// Why (30 Oct 2026, a8): eight minutes is an early split warning before the ten-minute PR job budget; never a red or a status write.
export const PR_SPLIT_SECONDS = 8 * 60;
const suiteName = value => typeof value === 'string' && /^[\w.+-]{1,80}$/.test(value);
const secondsOf = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= DAY / 1000;
const inWindow = (row, now) => { const at = Date.parse(row?.createdAt); return at >= now.getTime() - 30 * DAY && at <= now.getTime(); };
const quantile = (sorted, fraction) => sorted[Math.ceil(sorted.length * fraction) - 1];

/** Keep bounded successful-job observations in the existing snapshot; re-reads replace a run, old rows need no backfill. */
export function speedData(previous = {}, data = {}, now = new Date()) {
  const runs = new Map();
  for (const row of [...(previous.speedRuns || []), ...(Array.isArray(data.runs) ? data.runs.slice(0, 500) : [])]) {
    if (!inWindow(row, now) || !Number.isSafeInteger(row.runId) || row.runId <= 0 || ![...MAIN_KINDS, 'pr'].includes(row.kind) || !Array.isArray(row.suiteJobs)) continue;
    const suiteJobs = row.suiteJobs.slice(0, 300).filter(job => suiteName(job?.suite) && secondsOf(job.seconds)).map(({suite, seconds}) => ({suite, seconds}));
    runs.set(row.runId, {runId: row.runId, createdAt: row.createdAt, kind: row.kind, suiteJobs});
  }
  return {speedRuns: [...runs.values()].filter(row => row.suiteJobs.length).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.runId - a.runId)};
}

function statistics(rows, now, kind) {
  const samples = new Map();
  for (const row of rows || []) {
    if (!inWindow(row, now) || !(kind === 'pr' ? row.kind === 'pr' : MAIN_KINDS.includes(row.kind))) continue;
    for (const job of row.suiteJobs || []) {
      if (!suiteName(job?.suite) || !secondsOf(job.seconds)) continue;
      if (!samples.has(job.suite)) samples.set(job.suite, new Map());
      const runs = samples.get(job.suite);
      // Why (30 Oct 2026, Codex): one workflow run counts once per suite; parallel platforms use the longest successful job, and shard keys stay separate.
      runs.set(row.runId, Math.max(runs.get(row.runId) ?? 0, job.seconds));
    }
  }
  return [...samples].map(([suite, runs]) => {
    const values = [...runs.values()].sort((a, b) => a - b), n = values.length;
    return {suite, median: n < 3 ? null : (values[Math.floor((n - 1) / 2)] + values[Math.floor(n / 2)]) / 2,
      p25: n < 3 ? null : quantile(values, 0.25), p95: n < 3 ? null : quantile(values, 0.95), n, kind};
  }).sort((a, b) => (b.median ?? -1) - (a.median ?? -1) || a.suite.localeCompare(b.suite));
}

/** Main's successful suite jobs in the last thirty days, slowest first; fewer than three distinct runs has no median verdict. */
export function speedOf(rows, now = new Date()) { return statistics(rows, now, 'main'); }

/** PR suites with at least three runs whose median successful job is strictly over the shared eight-minute split warning. */
export function slowPrSuites(rows, now = new Date()) { return statistics(rows, now, 'pr').filter(row => row.median > PR_SPLIT_SECONDS); }

/** Page and weekly share the same thirty-day sample and PR availability, regardless of the page's range/kind filter. */
export function speedSummary(snapshot, now = new Date()) {
  const rows = snapshot?.speedRuns || [], pr = statistics(rows, now, 'pr');
  return {main: speedOf(rows, now), slowPr: slowPrSuites(rows, now), prRead: pr.some(row => row.median !== null)};
}

/** Elapsed job seconds, rounded for display; never rounds the value used for the warning. */
export function speedTime(seconds) {
  const total = Math.round(seconds), minutes = Math.floor(total / 60), rest = total % 60;
  return minutes ? `${minutes}m${String(rest).padStart(2, '0')}s` : `${rest}s`;
}

/** Compact speed lines for the weekly issue and Telegram; absent evidence adds no line and suite lists can be bounded. */
export function speedLines(speed, limit = Infinity) {
  if (!speed) return [];
  const slowest = speed.main.filter(row => row.median !== null).slice(0, 3);
  const slowPr = speed.slowPr.slice(0, limit), more = speed.slowPr.length - slowPr.length;
  return [...(slowest.length ? [`Slowest: ${slowest.map(row => `${row.suite} ${speedTime(row.median)} (${row.n} runs)`).join(', ')}`] : []),
    ...(speed.prRead ? [`PR suites over ${PR_SPLIT_SECONDS / 60} min: ${speed.slowPr.length ? [...slowPr.map(row => `${row.suite} (${speedTime(row.median)}, ${row.n} runs)`), ...(more ? [`…and ${more} more`] : [])].join(', ') : 'none'}`] : [])];
}
