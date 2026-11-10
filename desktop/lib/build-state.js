// Which build runs, told the same way in the app window and the extension panel (owner, 16 Oct 2026: the app ran a build older than the merged fixes and he tested old code without knowing).
// The app: the commit it started on (a package's build-info.json, or the checkout's HEAD at start) and how many PRs merged into the checkout since change desktop/extension ("Restart to get N fixes").
// The extension: the commit its version names (a checkout stamps base.<commits that changed extension/>, scripts/extension-stamp.mjs) and how many fixes it lacks ("Reload the extension to get N fixes").
// Git failing, a shallow clone or an unnamed version says nothing rather than a wrong number. Guard: desktop/test/guards/release/build-state.test.js.
import {execFile, execFileSync} from 'node:child_process';
import {promisify} from 'node:util';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TTL_MS = 20000;   // the extension checks in every 30 s; a pull changes the answer at most every couple of minutes
const cache = new Map();

// "abc1234 · 16 Oct 14:02" (local time); '' without a commit.
export function labelOf({commit, time} = {}) {
  if (!commit) return '';
  const at = new Date(time);
  if (!time || Number.isNaN(at.getTime())) return commit;
  const two = n => String(n).padStart(2, '0');
  return `${commit} · ${at.getDate()} ${MONTHS[at.getMonth()]} ${two(at.getHours())}:${two(at.getMinutes())}`;
}
export const fixesLabel = n => `${n} fix${n === 1 ? '' : 'es'}`;
export const restartLabel = n => `Restart to get ${fixesLabel(n)}`;
export const reloadLabel = n => (n ? `Reload the extension to get ${fixesLabel(n)}` : 'Reload the extension to get the latest fixes');

const gitIn = (repo, run) => (...args) => String(run('git', ['-C', repo, ...args], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000})).trim();
const cached = (key, now, make) => {
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.value;
  const value = make();
  cache.set(key, {at: now, value});
  return value;
};

// The checkout's HEAD now: what a source run is started on. -> {commit, time}; empty strings when git cannot say.
export function headBuild(repo, run = execFileSync) {
  try { const git = gitIn(repo, run); return {commit: git('rev-parse', '--short=7', 'HEAD'), time: git('log', '-1', '--format=%cI', 'HEAD')}; } catch { return {commit: '', time: ''}; }
}

// running: {commit, time} the app started on. -> {label, commit, ahead}: ahead = PRs merged into the checkout since that change desktop/ or extension/ (0 when unknown).
// Why (owner, 29 Oct 2026: "let's fix this counter to show merged PRs in master, not other things"): it counted commits, 41 for 13 merged PRs.
// Why (6 Nov 2026, owner: "why I don't see anymore … a yellow badge"): main takes PRs as squash commits since 1 Nov, so `--merges` counted 0 of 13. Each PR is one commit on the
// first-parent line either way (a squash, or an older merge), so the count walks that line without --merges.
export function appBuild({repo, running, run = execFileSync, now = Date.now()}) {
  const label = labelOf(running);
  if (!running?.commit) return {label, commit: '', ahead: 0};
  let ahead = 0;
  try { ahead = Number(cached(`ahead:${repo}:${running.commit}`, now, () => gitIn(repo, run)('rev-list', '--count', '--first-parent', `${running.commit}..HEAD`, '--', 'desktop', 'extension'))) || 0; } catch { /* nothing is claimed */ }
  return {label, commit: running.commit, ahead};
}

// The commits that changed extension/, oldest first, as {commit, time}: the n-th is the build a stamped patch n names (scripts/extension-stamp.mjs).
// Why (#2910, 2 Nov 2026; #3000; 10 Nov 2026): a check-in came every 30 s and each one walked the history, ~1-5 s inside the request. A HEAD's commits never change, so one walk per HEAD;
// `rev-parse HEAD` costs milliseconds. A walk that fails (git's time limit on a cold checkout) keeps the last good list and is asked again only after TTL_MS, never on every check-in.
// Why (10 Nov 2026, hw; owner's app.log 31 Oct-6 Nov: 10,020 check-ins over 2 s, average 4.3 s): a source run asked git for this on every check-in, on the app's main thread
// (execFileSync here, and again in dev-extension-version.js; a 20 s cache never helped against a 30 s check-in), and froze the whole app for 3-5 s each time (a CPU profile of
// the practice app: 3.4 s inside that call). Design: ONE owner, `checkouts`: repo -> {head, commits, at}, the commits that changed extension/ at HEAD. Only an asynchronous
// refresh writes it (started at app start by warmExtensionHistory, and by any read that finds it older than TTL_MS); a read never waits: until the first refresh ends, or when none has ever
// succeeded, the commits are [] (a failed refresh keeps the last good list) and the labels and stamped version say nothing (the manifest's version stands). A new HEAD (a pull) is walked once. Both readers use it: the labels
// (extensionBuild) and the stamped version (dev-extension-version.js: its count is this list's length).
// Tests: test/guards/release/build-state.test.js, test/unit/extension/latest-extension-nonblocking.test.js.
const checkouts = new Map();
const execFileAsync = promisify(execFile);
const gitAsync = (repo, ...args) => execFileAsync('git', ['-C', repo, ...args], {encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024}).then(done => String(done.stdout).trim());
const gitHead = repo => gitAsync(repo, 'rev-parse', 'HEAD');
// A shallow clone cannot count its history: no commits, the manifest's version stands.
const gitLog = async repo => (await gitAsync(repo, 'rev-parse', '--is-shallow-repository') === 'true' ? '' : gitAsync(repo, 'log', '--reverse', '--format=%H %cI', 'HEAD', '--', 'extension'));
const parseHistory = text => String(text).trim().split('\n').filter(Boolean).map(line => { const [sha, time] = line.split(' '); return {commit: sha.slice(0, 7), time}; });
async function refresh(entry, repo, {now, head, walk}) {
  const at = await head(repo);
  if (at !== entry.head) { entry.commits = parseHistory(await walk(repo)); entry.head = at; }
  entry.at = now;
}
/**
 * The commits that changed extension/ at the checkout's HEAD, oldest first, as {commit, time}: what was last found, never waiting for git. [] until the first refresh ends or when git cannot say.
 * Starts a refresh when none ran for TTL_MS (one at a time); a failed refresh keeps what was known and tries again after TTL_MS. head/walk/now: for tests.
 */
export function checkoutCommits(repo, {now = Date.now(), head = gitHead, walk = gitLog} = {}) {
  let entry = checkouts.get(repo);
  if (!entry) checkouts.set(repo, entry = {head: '', commits: [], at: -Infinity, running: null});
  if (!entry.running && now - entry.at >= TTL_MS) {
    entry.at = now;   // a failed refresh waits TTL_MS too, never one git call per check-in
    entry.running = refresh(entry, repo, {now, head, walk}).catch(() => {}).finally(() => { entry.running = null; });
  }
  return entry.commits;
}
/** Start the refresh now (the app's start), so the first check-in finds its answer; never throws, never waits. */
export function warmExtensionHistory(repo, options) { try { checkoutCommits(repo, options); } catch { /* no git: nothing is claimed */ } }
/** Resolves when the refresh in flight for `repo` has ended (for tests; the app never waits for it). */
export const whenCheckoutCommits = repo => checkouts.get(repo)?.running || Promise.resolve();

const patchOf = version => { const m = /^\d+\.\d+\.(\d+)$/.exec(String(version || '')); return m ? Number(m[1]) : null; };

// The extension at `version` (what it reports) against `latest` (the checkout's, or the package's). packaged: {commit, time} of an installed app, whose extension is the app's own build.
// -> {label, latestLabel, behind}: behind = 0 current, N fixes, or null when it is behind by an unknown number (a copy that never reloaded reports the manifest's base "0.9").
export function extensionBuild({repo, version, latest, packaged = null, ...options}) {
  if (packaged) return {label: labelOf(packaged), latestLabel: labelOf(packaged), behind: 0, reloadLabel: ''};
  const mine = patchOf(version), newest = patchOf(latest);
  const behind = newest === null ? 0 : mine === null ? (version && version !== latest ? null : 0) : Math.max(0, newest - mine);
  let commits = [];
  if (mine !== null || newest !== null) { try { commits = checkoutCommits(repo, options); } catch { /* no git (rev-parse failed): nothing is claimed */ } }
  const at = n => labelOf(commits[n - 1]);
  return {label: mine === null ? '' : at(mine), latestLabel: newest === null ? '' : at(newest), behind, reloadLabel: behind === 0 ? '' : reloadLabel(behind)};
}
