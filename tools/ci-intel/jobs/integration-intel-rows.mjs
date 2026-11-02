// The pure part of the integration collector (tools/ci-intel/jobs/integration-intel.mjs): read one layer's result file, turn runs into snapshot rows, find flaky tests, pick the slowest.
// A result file is what the "CI · Integration tests" jobs upload as the artifact integration-results-<layer>[-<platform>]: {v: 1, layer, platform, ms, tests: [{name, file, ok, ms, failure?}]}
// (written from node:test's own events by the public repo's desktop/integration/results-reporter.mjs). Guard: desktop/test/ci-intel-integration-intel-collector.test.js.
import {LAYERS} from '../lib/integration-intel.mjs';

const text = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max);

/** One result file -> {layer, platform, ms, tests} or null when it is not one. */
export function parseResult(body) {
  if (!body || body.v !== 1 || !LAYERS.includes(body.layer) || !Array.isArray(body.tests)) return null;
  const tests = body.tests.filter(item => typeof item?.name === 'string' && item.name && typeof item.ok === 'boolean')
    .map(item => ({name: text(item.name, 200), file: text(item.file, 160), ok: item.ok, ms: Math.max(0, Math.round(Number(item.ms) || 0)), failure: item.ok ? '' : text(item.failure, 220)}));
  const ms = Number(body.ms) > 0 ? Math.round(Number(body.ms)) : tests.reduce((sum, item) => sum + item.ms, 0);
  return {layer: body.layer, platform: text(body.platform, 20) || 'linux', ms, tests};
}

/** A workflow run + one result -> the snapshot's run row. `on` is main for a push to main, else pr. */
export function runRow(run, result) {
  const failed = result.tests.filter(item => !item.ok).length;
  return {runId: run.databaseId, layer: result.layer, platform: result.platform, day: run.createdAt.slice(0, 10), on: run.event === 'push' && run.headBranch === 'main' ? 'main' : 'pr', sha: run.headSha,
    conclusion: failed ? 'failure' : 'success', tests: result.tests.length, failed, ms: result.ms};
}

/** The 10 slowest tests over the given newest results (one per layer and platform): one row per layer and test, its slowest time. */
export function slowestOf(results, limit = 10) {
  const rows = new Map();
  for (const result of results) for (const item of result.tests) {
    const key = `${result.layer}|${item.file}|${item.name}`, row = rows.get(key);
    if (!row || item.ms > row.ms) rows.set(key, {layer: result.layer, test: item.name, file: item.file, ms: item.ms, runs: 1});
  }
  return [...rows.values()].sort((a, b) => b.ms - a.ms).slice(0, limit);
}

/** Per layer the newest result's test count and the number of distinct test files. */
export function countsOf(results) {
  return Object.fromEntries(LAYERS.map(layer => { const own = results.filter(result => result.layer === layer), most = own.sort((a, b) => b.tests.length - a.tests.length)[0];
    return [layer, {tests: most ? most.tests.length : 0, files: most ? new Set(most.tests.map(item => item.file).filter(Boolean)).size : 0}]; }));
}

// A GitHub paths: pattern ("desktop/integration/**", "extension/*.js") against a repo path.
export function pathMatches(patterns, file) {
  const regex = pattern => new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\?]/g, '\\$&').replace(/\*\*\//g, '\u0000').replace(/\*\*/g, '\u0001').replace(/\*/g, '[^/]*').replace(/\u0000/g, '(?:.*/)?').replace(/\u0001/g, '.*')}$`);
  return patterns.some(pattern => regex(pattern).test(file));
}

/**
 * Walk the observations oldest first. A red test is kept "open"; a later green of the same test (same layer, platform, file and name) closes it:
 *  - on the same commit            -> flaky "same-commit" (red then green on identical code);
 *  - on another commit of main, with nothing the workflow watches changed in between (changedBetween(redSha, greenSha) -> files, null = unknown, never guessed) -> "unchanged-files";
 *  - otherwise a change in between may have fixed it: closed, not flaky.
 * observations: [{runId, sha, day, on, createdAt, layer, platform, name, file, ok}]; open: [{layer, platform, test, file, day, runId, sha, on}]. Returns {open, flaky}.
 */
export async function advance(open, observations, {watched = [], changedBetween = async () => null} = {}) {
  const still = new Map(open.map(item => [`${item.layer}|${item.platform}|${item.file}|${item.test}`, item])), flaky = [];
  for (const seen of observations.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.runId - b.runId)) {
    const key = `${seen.layer}|${seen.platform}|${seen.file}|${seen.name}`, red = still.get(key);
    if (!seen.ok) { if (!red) still.set(key, {layer: seen.layer, platform: seen.platform, test: seen.name, file: seen.file, day: seen.day, runId: seen.runId, sha: seen.sha, on: seen.on}); continue; }
    if (!red || red.runId === seen.runId) continue;
    still.delete(key);
    let kind = null;
    if (red.sha === seen.sha) kind = 'same-commit';
    else if (red.on === 'main' && seen.on === 'main' && watched.length) { const files = await changedBetween(red.sha, seen.sha); if (files && !files.some(file => pathMatches(watched, file))) kind = 'unchanged-files'; }
    if (kind) flaky.push({layer: seen.layer, test: seen.name, file: seen.file, kind, day: seen.day, red: {runId: red.runId, sha: red.sha}, green: {runId: seen.runId, sha: seen.sha}});
  }
  return {open: [...still.values()], flaky};
}

/** Counts of the e2e steps and integration tests from file names and per-file match counts (git grep -c output as {path: n}). */
export function moveRow(day, names, stepCounts, testCounts) {
  const suites = names.filter(name => /^desktop\/e2e\/suites\/[^/]+\.mjs$/.test(name));
  const sum = (counts, prefix) => Object.entries(counts).filter(([file]) => file.startsWith(prefix)).reduce((total, [, n]) => total + n, 0);
  return {day, e2eSuites: suites.length, e2eSteps: sum(stepCounts, 'desktop/e2e/suites/'), integration: Object.fromEntries(LAYERS.map(layer => [layer, sum(testCounts, `desktop/integration/${layer}/`)]))};
}

/** `git grep -c` output ("<sha>:<path>:<n>" or "<path>:<n>" per line) -> {path: n}. */
export function grepCounts(output, sha = '') {
  const counts = {};
  for (const line of String(output).split('\n')) { const found = /^(.+):(\d+)$/.exec(sha && line.startsWith(`${sha}:`) ? line.slice(sha.length + 1) : line); if (found) counts[found[1]] = Number(found[2]); }
  return counts;
}

/**
 * The runs of this pass that may be folded into the snapshot, oldest first: every run up to the first one not read for certain (a timeout, a rate limit), because a retried run
 * replayed after newer ones would reach advance() out of order and miss its same-commit pair (Gitar, #245). A run still unreadable after `giveUpHours` is let go (read, no results),
 * so one dead run never blocks the newer ones for good. read: [{run: {createdAt}, ok, results}].
 */
export function inOrder(read, now = Date.now(), giveUpHours = 48) {
  const sorted = read.slice().sort((a, b) => a.run.createdAt.localeCompare(b.run.createdAt)), out = [];
  for (const item of sorted) {
    if (item.ok) { out.push(item); continue; }
    if (now - Date.parse(item.run.createdAt) > giveUpHours * 3600000) { out.push({...item, ok: true, results: []}); continue; }
    break;
  }
  return out;
}

/** Keep only the folded runs created before the oldest run still in progress (and younger than `giveUpHours`), so that run is not replayed after newer ones (Gitar, #245). */
export function beforePending(items, listed, now = Date.now(), giveUpHours = 48) {
  const open = listed.filter(run => !['success', 'failure', 'cancelled', 'skipped', 'timed_out', 'neutral', 'startup_failure', 'action_required', 'stale'].includes(run.conclusion) && now - Date.parse(run.createdAt) < giveUpHours * 3600000).map(run => run.createdAt).sort()[0];
  return open ? items.filter(({run}) => run.createdAt < open) : items;
}
