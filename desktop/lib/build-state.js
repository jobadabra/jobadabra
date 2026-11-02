// Which build runs, told the same way in the app window and the extension panel (owner, 16 Oct 2026: the app ran a build older than the merged fixes and he tested old code without knowing).
// The app: the commit it started on (a package's build-info.json, or the checkout's HEAD at start) and how many PRs merged into the checkout since change desktop/extension ("Restart to get N fixes").
// The extension: the commit its version names (a checkout stamps base.<commits that changed extension/>, scripts/extension-stamp.mjs) and how many fixes it lacks ("Reload the extension to get N fixes").
// Git failing, a shallow clone or an unnamed version says nothing rather than a wrong number. Guard: desktop/test/build-state.test.js.
import {execFileSync} from 'node:child_process';

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
// Why (owner, 29 Oct 2026: "let's fix this counter to show merged PRs in master, not other things"): it counted commits, 41 for 13 merged PRs. Main
// takes PRs as merge commits, so each PR is one merge on the first-parent line.
export function appBuild({repo, running, run = execFileSync, now = Date.now()}) {
  const label = labelOf(running);
  if (!running?.commit) return {label, commit: '', ahead: 0};
  let ahead = 0;
  try { ahead = Number(cached(`ahead:${repo}:${running.commit}`, now, () => gitIn(repo, run)('rev-list', '--count', '--merges', '--first-parent', `${running.commit}..HEAD`, '--', 'desktop', 'extension'))) || 0; } catch { /* nothing is claimed */ }
  return {label, commit: running.commit, ahead};
}

// The commits that changed extension/, oldest first, as {commit, time}: the n-th is the build a stamped patch n names (scripts/extension-stamp.mjs).
// Why (#2910, 2 Nov 2026): it was two history walks per check-in (one per label, a 20 s cache, a check-in every 30 s), ~1-5 s each inside the request.
// A HEAD's commits never change, so one walk per HEAD; `rev-parse HEAD` costs milliseconds. A walk that fails (git's 5 s limit on a cold checkout)
// is kept as an empty list for that HEAD too: the labels then say nothing until a pull, instead of costing 2 x 5 s on every check-in (#3000 review).
const extensionHistory = new Map();
function extensionCommits(repo, run) {
  const git = gitIn(repo, run), key = `${repo}:${git('rev-parse', 'HEAD')}`;
  if (!extensionHistory.has(key)) {
    for (const old of [...extensionHistory.keys()]) if (old.startsWith(`${repo}:`)) extensionHistory.delete(old);   // one HEAD kept per checkout
    let commits = [];
    try {
      commits = git('log', '--reverse', '--format=%H %cI', 'HEAD', '--', 'extension').split('\n').filter(Boolean).map(line => {
        const [sha, time] = line.split(' ');
        return {commit: sha.slice(0, 7), time};
      });
    } catch { /* git ran out of time or failed: nothing is claimed for this HEAD */ }
    extensionHistory.set(key, commits);
  }
  return extensionHistory.get(key);
}

const patchOf = version => { const m = /^\d+\.\d+\.(\d+)$/.exec(String(version || '')); return m ? Number(m[1]) : null; };

// The extension at `version` (what it reports) against `latest` (the checkout's, or the package's). packaged: {commit, time} of an installed app, whose extension is the app's own build.
// -> {label, latestLabel, behind}: behind = 0 current, N fixes, or null when it is behind by an unknown number (a copy that never reloaded reports the manifest's base "0.9").
export function extensionBuild({repo, version, latest, packaged = null, run = execFileSync}) {
  if (packaged) return {label: labelOf(packaged), latestLabel: labelOf(packaged), behind: 0, reloadLabel: ''};
  const mine = patchOf(version), newest = patchOf(latest);
  const behind = newest === null ? 0 : mine === null ? (version && version !== latest ? null : 0) : Math.max(0, newest - mine);
  let commits = [];
  if (mine !== null || newest !== null) { try { commits = extensionCommits(repo, run); } catch { /* no git (rev-parse failed): nothing is claimed */ } }
  const at = n => labelOf(commits[n - 1]);
  return {label: mine === null ? '' : at(mine), latestLabel: newest === null ? '' : at(newest), behind, reloadLabel: behind === 0 ? '' : reloadLabel(behind)};
}
