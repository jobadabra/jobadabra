// Where an engineering change belongs (owner, 15 Oct 2026: "where do we spend our time, operational-wise"): the ONE map from a changed file to a category, and a merged PR's row
// (its main category, lines, open→merge hours). Pure: tools/ci-intel/jobs/ops-overview.mjs feeds it from GitHub, jobadabra-web admin/ops-overview.js stores and draws it. Guard: desktop/test/ci-intel-ops-overview.test.js
// (fails when a tracked file, or a new top-level path, has no category).

export const CATEGORIES = [
  {id: 'forms', label: 'Form fixes', color: '#5ec4b6', hint: 'how a form is read and filled: extension, ladder, its fixtures'},
  {id: 'pool', label: 'Pool data', color: '#7fb069', hint: 'which postings the pool rows point at (smoke-sites.json)'},
  {id: 'replay', label: 'Replay & recording', color: '#3987e5', hint: 'recording sites and replaying them offline'},
  {id: 'ci', label: 'CI, harness & tooling', color: '#d95926', hint: 'workflows, tools/, hooks, the e2e harness'},
  {id: 'site', label: 'Admin & site', color: '#f5b54a', hint: 'site/: admin pages, the public website, its Worker'},
  {id: 'app', label: 'Desktop app', color: '#a78bfa', hint: 'desktop/ outside the harness'},
  {id: 'engine', label: 'Engine & worker', color: '#199e70', hint: 'src/ (Python engine), app-core/, config, templates'},
  {id: 'docs', label: 'Docs, skills & rules', color: '#8d949c', hint: 'docs/, skills, rules, *.md'},
  {id: 'tests', label: 'Tests only', color: '#c9a227', hint: 'a PR that changes nothing but tests'},
  {id: 'mixed', label: 'Mixed', color: '#e377c2', hint: 'no category holds half of the changed lines'},
];
// Bump when a rule above changes: CI then re-reads the stored PRs (tools/ci-intel/jobs/ops-overview.mjs) so old rows get the new category.
export const RULES_VERSION = 4;   // 4: .dependency-cruiser.cjs is ci, not mixed (29 Oct 2026; Gitar on web #225: #2444's stored row would have stayed mixed)
export const CATEGORY_IDS = CATEGORIES.map(category => category.id);

const is = pattern => path => pattern.test(path);
// The code that reads or answers a form (coordinator, 15 Oct 2026): a Pool-row trailer makes a PR a form fix only together with a change here, and then the recorded pages count with the fix.
export const isFillCode = path => /^(extension|desktop\/lib\/ladder|desktop\/lib\/ai)\//.test(path) || /^(app-core|worker)\/src\/(answer-[^/]*|cv-facts|ai)\.js$/.test(path);
const isProof = path => /^desktop\/e2e\/(recorded|recorded-pending)\//.test(path) || path === 'desktop/e2e/recorded-case-map.json';
/** True when a changed path is a test file (folder test(s), *.test.*, test_*.py). */
export const isTest = path => /(^|\/)(tests?|__tests__)\/|\.test\.[cm]?[jt]s$|(^|\/)test_[^/]*\.py$/.test(path);
// First match wins; the order is the precedence (a replay file under desktop/e2e is "replay", not harness).
const RULES = [
  [is(/^(extension|desktop\/lib\/ladder|desktop\/e2e\/ladder[^/]*)\//), 'forms'],
  [is(/^desktop\/e2e\/(ladder-[^/]*|pool-fixes\.json)$/), 'forms'],
  [is(/^desktop\/e2e\/smoke-sites\.json$/), 'pool'],
  [is(/^desktop\/e2e\/(recorded|recorded-[^/]*|record[^/]*|replay[^/]*|net-[^/]*|guard[^/]*|pool-[^/]*|fidelity[^/]*)(\/|$)/), 'replay'],
  [is(/^\.github\/workflows\/(record-sites|site-replays[^/]*|page-cases|pool-[^/]*)\.yml$/), 'replay'],
  [is(/^tools\/(replay[^/]*|recorded[^/]*|pool-[^/]*)$/), 'replay'],
  [is(/^desktop\/(e2e|scripts)\//), 'ci'],
  [is(/^(\.github|\.gitar|tools|jobs|\.claude\/(hooks|settings[^/]*|worktrees))\//), 'ci'],
  [is(/^\.claude\/(skills|agents|commands)\//), 'docs'],
  [is(/^(site|preview|web|admin|api|shared|workers|db|media)\//), 'site'],
  [is(/^desktop\//), 'app'],
  [is(/^(src|app-core|worker|config|templates)\//), 'engine'],
  [is(/^(docs|brand)\//), 'docs'],
  [is(/\.(md|txt)$|^LICENSE/), 'docs'],
];
// A new top-level path must be added here (the test lists the repo's own): the fallback for files no rule above names.
export const TOP_LEVEL = {'.claude': 'ci', '.github': 'ci', '.gitar': 'ci', brand: 'docs', config: 'engine', desktop: 'app', docs: 'docs', extension: 'forms', hosted: 'engine', site: 'site', preview: 'site', web: 'site', admin: 'site', api: 'site', shared: 'site', workers: 'site', db: 'site', media: 'site', jobs: 'ci', test: 'site',
  src: 'engine', templates: 'engine', tests: 'engine', tools: 'ci', worker: 'engine', 'app-core': 'engine'};
const ROOT_FILES = {'.env.example': 'ci', '.gitattributes': 'ci', '.gitignore': 'ci', '.dependency-cruiser.cjs': 'ci', 'eslint.config.mjs': 'ci', 'requirements.txt': 'engine', 'requirements-render.txt': 'engine', 'requirements-transcribe.txt': 'engine'};

// A file's category id, or null when nothing names it (a test then fails).
export function categoryOfFile(path) {
  for (const [match, id] of RULES) if (match(path)) return id;
  const [top, ...rest] = path.split('/');
  return rest.length ? TOP_LEVEL[top] || null : ROOT_FILES[path] || null;
}

// files [{path, additions, deletions}], trailers: the messages of the PR's commits -> {category, lines, tests, mixed}.
// Lines of non-test files decide; a PR with only tests is "tests". A Pool-row trailer makes a PR a form fix only when it also changes fill code (isFillCode); then recorded pages count with the fix.
// No category holding half of the changed lines -> "mixed", said as such.
export function classify(files = [], messages = []) {
  const by = {};
  let tests = 0;
  const fill = files.some(file => !isTest(file.path) && isFillCode(file.path));
  for (const file of files) {
    const lines = (file.additions || 0) + (file.deletions || 0);
    if (isTest(file.path)) { tests += lines; continue; }
    const id = fill && isProof(file.path) ? 'forms' : categoryOfFile(file.path) || 'mixed';
    by[id] = (by[id] || 0) + lines;
  }
  const total = Object.values(by).reduce((a, b) => a + b, 0);
  const lines = total + tests;
  // Which row is real is the commit hook's check (tools/commit-trailers.mjs); a trailer with a name is enough here.
  if (fill && messages.some(message => /^Pool-row:[ \t]*\S/m.test(message))) return {category: 'forms', lines, tests, mixed: false};
  if (!total) return {category: files.length ? 'tests' : 'mixed', lines, tests, mixed: false};
  const [top, topLines] = Object.entries(by).sort((a, b) => b[1] - a[1])[0];
  if (topLines * 2 < total) return {category: 'mixed', lines, tests, mixed: true};
  return {category: top, lines, tests, mixed: false};
}

// A merged PR from `gh pr list --json number,title,createdAt,mergedAt,files,commits` + the CI minutes of its runs -> the stored row.
export function prRow(pr, ciMinutes = 0) {
  const {category, lines, mixed} = classify(pr.files || [], (pr.commits || []).map(commit => `${commit.messageHeadline || ''}\n${commit.messageBody || ''}`));
  const hours = pr.createdAt && pr.mergedAt ? Math.max(0, (Date.parse(pr.mergedAt) - Date.parse(pr.createdAt)) / 3600000) : 0;
  return {number: pr.number, title: String(pr.title || '').slice(0, 120), mergedAt: pr.mergedAt, category, mixed, lines, hours: Math.round(hours * 10) / 10, ciMinutes: Math.round(ciMinutes * 10) / 10};
}
