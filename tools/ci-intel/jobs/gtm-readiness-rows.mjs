// The pure part of the GTM readiness collector (tools/ci-intel/jobs/gtm-readiness.mjs): the registry's journeys, a run's step results -> Tier 1 rows, integration results -> Tier 2 tallies, the merge into the stored snapshot.
// Tier 1 source: each e2e run's artifacts e2e-view-<suite>[-<n>of<m>] and e2e-view-windows-<suite> (steps.json: {suite, results: [{name, status}]}). The e2e store keeps reds only (e2e_fails), no green and no step.
// Row = [runId, day, kind, os, journey, seen, failed, cut] (jobadabra-web admin/gtm-intel.js): seen = the journey's registry steps found in the run's steps.json; failed = how many of them failed;
// cut = 1 when a suite holding the journey's steps went red and fewer steps ran than in an earlier green run (the suite died before them). Guard: jobadabra-web test/admin/gtm-readiness-collector.test.js.
// Why (1 Nov 2026 measurement): steps.json cuts a long step name (the registry has it whole), so a name matches by prefix from 60 characters; a step added or renamed later is no cut (expected comes from earlier green runs).
export const KEPT = {id: 'K', name: 'Kept safety and data steps'};
export const BIG = 5e6;   // an e2e-view artifact over 5 MB (older runs held traces: 130-170 MB) is skipped, never downloaded
const KINDS = ['after-merge', 'nightly', 'beta'];
export const kindsRead = KINDS;
const base = key => String(key).replace(/-\d+of\d+$/, '');

/** The registry -> {journeys: [{id, name, tier}], steps: Tier 1 [{journey, suite, name, parts}], tests: Tier 2 [{journey, file, name, parts}]}; the kept steps are journey K. */
export function registryParts(registry) {
  const journeys = [...registry.journeys.map(item => ({id: item.id, name: item.name, tier: item.tier})), {...KEPT, tier: 1}];
  const steps = [], tests = [];
  for (const item of registry.journeys) for (const step of item.steps) (step.suite ? steps : tests).push(step.suite ? {journey: item.id, suite: step.suite, name: step.step, parts: step.parts} : {journey: item.id, file: step.integration, name: step.test, parts: step.parts});
  for (const step of registry.kept || []) steps.push({journey: KEPT.id, suite: step.suite, name: step.step, parts: step.parts});
  return {journeys, steps, tests};
}

/** Does a result's name (steps.json cuts long names) belong to the registry step? */
export const sameStep = (step, name) => (step.parts ? step.parts.every(part => name.includes(part)) : name === step.name || (name.length >= 60 && step.name.startsWith(name)) || (step.name.length >= 60 && name.startsWith(step.name)));

/** What a journey normally shows on one OS: the most steps seen in an earlier run with no red and no cut (0 when there is none). */
export const expectedSeen = (rows, journey, os) => rows.filter(row => row[3] === os && row[4] === journey && row[6] === 0 && row[7] === 0).reduce((most, row) => Math.max(most, row[5]), 0);

/**
 * One run's e2e results -> its Tier 1 rows.
 * @param {{runId: number, day: string, kind: string}} run
 * @param {{suite: string, os: 'mac'|'windows', results: {name: string, status: string}[]}[]} views one per downloaded steps.json (the suite without its -NofM)
 * @param {{suite: string, platform: 'mac'|'windows'}[]} redSuites the run's red suite jobs (tools/ci-intel/jobs/e2e-intel-rows.mjs redJobs)
 * @param {(journey: string, os: string) => number} expected expectedSeen over the rows before this run
 */
export function runRows(run, steps, views, redSuites, expected) {
  const rows = [];
  for (const journey of [...new Set(steps.map(step => step.journey))]) {
    const own = steps.filter(step => step.journey === journey), suites = new Set(own.map(step => step.suite));
    for (const os of ['mac', 'windows']) {
      const found = new Set(), failed = new Set();
      for (const view of views.filter(item => item.os === os && suites.has(base(item.suite)))) for (const step of own.filter(item => item.suite === base(view.suite))) {
        const hit = view.results.find(result => sameStep(step, result.name));
        if (hit) { found.add(step.name); if (hit.status === 'failed') failed.add(step.name); }
      }
      const red = redSuites.some(item => item.platform === os && suites.has(base(item.suite)));
      const cut = !failed.size && red && expected(journey, os) > found.size ? 1 : 0;
      if (found.size || failed.size || cut) rows.push([run.runId, run.day, run.kind, os, journey, found.size, failed.size, cut]);
    }
  }
  return rows;
}

/** One integration run's results -> per journey {tests, red}: a journey is red in a run when any of its registry tests failed in any result (Linux or Windows). Absent tests are no observation. */
export function runTests(tests, results) {
  const out = new Map();
  for (const result of results) for (const test of tests) {
    const hits = result.tests.filter(item => item.file === test.file && (test.parts ? test.parts.every(part => item.name.includes(part)) : item.name === test.name || (item.name.length >= 50 && test.name.startsWith(item.name))));
    if (!hits.length) continue;
    const one = out.get(test.journey) || {names: new Set(), red: false};
    for (const hit of hits) { one.names.add(`${test.file}:${test.name}`); one.red = one.red || !hit.ok; }
    out.set(test.journey, one);
  }
  return [...out].map(([journey, one]) => ({journey, tests: one.names.size, red: one.red}));
}

/** Add one integration run's per-journey outcome to the day's tallies {day, journey, tests, runs, red}. */
export function tally(tallies, day, outcomes) {
  const next = tallies.map(row => ({...row}));
  for (const item of outcomes) {
    let row = next.find(entry => entry.day === day && entry.journey === item.journey);
    if (!row) next.push(row = {day, journey: item.journey, tests: 0, runs: 0, red: 0});
    row.tests = Math.max(row.tests, item.tests); row.runs += 1; row.red += item.red ? 1 : 0;
  }
  return next;
}

/** The snapshot to send: stored + new rows, only the last `keepDays` days, the newest `max` Tier 1 rows, the ids of runs read. */
export function snapshotOf({journeys, stored = {}, tier1 = [], tier2 = stored.tier2 || [], read = {}}, now = new Date(), keepDays = 28, max = 9000) {
  const from = new Date(now.getTime() - (keepDays - 1) * 86400000).toISOString().slice(0, 10);
  const ids = (list, more) => [...new Set([...(list || []), ...(more || [])])].slice(-4000);
  return {journeys, tier1: [...(stored.tier1 || []), ...tier1].filter(row => row[1] >= from).sort((a, b) => a[0] - b[0]).slice(-max), tier2: tier2.filter(row => row.day >= from),
    read: {e2e: ids(stored.read?.e2e, read.e2e), integration: ids(stored.read?.integration, read.integration)}};
}

/**
 * What the stored-snapshot GET answered -> {stored} to go on from, or {stop: reason} to publish nothing this hour.
 * Only a confirmed empty store (404 "no snapshot yet") is a first run; any other failure (network, 5xx, a body that is not a snapshot) would make the PUT replace 28 days with one pass (Gitar, #257).
 */
export function storedFrom(status, body) {
  if (status === 200 && body && Array.isArray(body.tier1)) return {stored: body};
  if (status === 404 && body?.error === 'no snapshot yet') return {stored: {}};
  return {stop: `GTM snapshot unreadable (HTTP ${status ?? 'none'})`};
}
