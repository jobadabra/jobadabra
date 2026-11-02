// Where e2e work goes (owner, 28 Oct 2026: "how many commits/work is around plumbing and how much is about e2e expectations?"; spec docs/superpowers/specs/2026-10-28-e2e-reliability-design.md
// rule J in the public repo): each commit of the public repo's main gets ONE kind from the paths it touched, the first that matches in WORK_KINDS' order, so a
// product commit that also edits a workflow counts as product, and "plumbing" means a commit that changed only CI or harness plumbing. Pure, shared by the collector
// (tools/ci-intel/jobs/e2e-intel.mjs: reads `git log`, sends the rows) and the page (jobadabra-web admin/e2e-page.js). Guard: desktop/test/ci-intel-e2e-work.test.js.

// Why (28 Oct 2026, the design session): the owner's target is plumbing under 15% of commits a week; by these rules main had 654 plumbing of 2,329 commits (28%), 14-27 Oct.
export const PLUMBING_TARGET = 0.15;
export const WORK_KINDS = [
  {id: 'product', label: 'Product', color: '#3fb68b', hint: 'the app, the extension or the engine', test: file => /^(desktop\/(?!e2e\/|test\/|docs\/)|extension\/|src\/)/.test(file)},
  {id: 'expectations', label: 'E2E expectations', color: '#3987e5', hint: 'what an e2e suite or a recorded page case expects', test: file => /^desktop\/e2e\/(suites|recorded)\//.test(file)},
  {id: 'plumbing', label: 'CI and harness plumbing', color: '#e5484d', hint: 'workflows, the e2e harness, test sets, tools', test: file => /^(\.github\/|desktop\/e2e\/|tools\/)/.test(file)},
  {id: 'tests', label: 'Unit tests', color: '#f5b54a', hint: 'the python and desktop unit tests', test: file => /^(tests\/|desktop\/test\/)/.test(file)},
  {id: 'other', label: 'Docs and other', color: '#8d949c', hint: 'docs, specs, config', test: () => true},
];
export const WORK_IDS = WORK_KINDS.map(kind => kind.id);
const HARNESS = WORK_KINDS.find(kind => kind.id === 'plumbing').test;

/** The kind of one commit from its files: the first WORK_KINDS entry any file matches; a commit with no file is "other". */
export const kindOfCommit = files => (WORK_KINDS.find(kind => kind.id !== 'other' && (files || []).some(kind.test)) || WORK_KINDS.at(-1)).id;

/** The Monday (UTC) of a YYYY-MM-DD day, as YYYY-MM-DD: the week a commit counts in. */
export function weekOf(day) {
  const date = new Date(`${day}T00:00:00Z`);
  return new Date(date.getTime() - ((date.getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10);
}

/** `git log --no-merges --format=@@%H %cs --name-only` output -> [{sha, day, files}], oldest last as git prints them. */
export function parseLog(text) {
  const commits = [];
  for (const line of String(text || '').split('\n')) {
    const head = /^@@([0-9a-f]{7,40}) (\d{4}-\d{2}-\d{2})$/.exec(line);
    if (head) commits.push({sha: head[1], day: head[2], files: []});
    else if (line.trim() && commits.length) commits.at(-1).files.push(line.trim());
  }
  return commits;
}

/**
 * Commits -> {work: [{day, kind, commits}] with a row for every kind on every day that has a commit (zeros included, so a rewritten main lowers a count),
 * files: [{week, file, commits}] the `top` harness files changed most in each week (the going-in-circles signal: e2e.yml changed 64 times in 14 days)}.
 */
export function workRows(commits, top = 8) {
  const days = new Map(), weeks = new Map();
  for (const commit of commits) {
    const counts = days.get(commit.day) || Object.fromEntries(WORK_IDS.map(id => [id, 0]));
    counts[kindOfCommit(commit.files)] += 1; days.set(commit.day, counts);
    const week = weekOf(commit.day), files = weeks.get(week) || new Map();
    for (const file of new Set(commit.files.filter(HARNESS))) files.set(file, (files.get(file) || 0) + 1);
    weeks.set(week, files);
  }
  const work = [...days].flatMap(([day, counts]) => WORK_IDS.map(kind => ({day, kind, commits: counts[kind]})));
  const files = [...weeks].flatMap(([week, counts]) => [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, top).map(([file, n]) => ({week, file, commits: n})));
  return {work, files};
}
