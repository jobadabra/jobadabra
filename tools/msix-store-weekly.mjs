// Picks the stable release that goes to the Microsoft Store this week, and starts msix-store.yml for it (used by .github/workflows/msix-store-weekly.yml, started by the Worker on Mondays).
//   node tools/msix-store-weekly.mjs            (env GH_TOKEN, GITHUB_REPOSITORY; DRY_RUN=1 prints the pick and starts nothing)
// Why (7 Nov 2026, owner: "how the microsoft publishes are going? If we release stable every day, and they take 4 days to approve one version" · "To release less often on Microsoft store" ·
// "Weekly, a fixed day (Recommended)": "One submission a week (e.g. Monday's stable), only after it has run a day on the .exe without a red"): until then every stable started a Store submission,
// 0.9.1 … 0.9.16 were all skipped behind 0.8.86, which sat in review for 5 days.
// Invariants: only a stable desktop release; out at least MIN_AGE_HOURS; no failed main-check run on its commit; newer than the last version submitted (the Store wants each submission higher);
// nothing here submits: it starts msix-store.yml, which keeps its own "a version still in review waits" guard.
import {compareVersions} from './msix-store-watch.mjs';

export const MIN_AGE_HOURS = 24;
/** Workflows whose failed run on a release's commit means "red": the checks main runs on every push. */
export const RED_WORKFLOWS = ['build.yml', 'e2e.yml'];

/**
 * The tag to send, from `stables` ([{version, tag, publishedAt}] in any order). Newest first: too young (< MIN_AGE_HOURS since `publishedAt`, the build's publish time; a promotion later than that
 * means it has been stable for less) or red (`isRed(stable)`) is skipped for the next older one; the first that passes is the pick, unless it is not newer than `lastSubmitted`.
 * -> {tag: string, reason: string}; tag '' = send nothing this week.
 */
export async function pick(stables, {now = new Date(), lastSubmitted = '', isRed = async () => false} = {}) {
  const skipped = [];
  for (const stable of [...stables].sort((a, b) => compareVersions(b.version, a.version))) {
    const ageHours = (now - new Date(stable.publishedAt)) / 3600000;
    if (ageHours < MIN_AGE_HOURS) { skipped.push(`${stable.version} is ${Math.floor(ageHours)} h old`); continue; }
    if (await isRed(stable)) { skipped.push(`${stable.version} has a red run`); continue; }
    if (lastSubmitted && compareVersions(stable.version, lastSubmitted) <= 0) return {tag: '', reason: `${stable.version} is the newest that passes and is not newer than ${lastSubmitted}, already submitted${skipped.length ? ` (${skipped.join('; ')})` : ''}`};
    return {tag: stable.tag, reason: `${stable.version} passes${skipped.length ? ` (${skipped.join('; ')})` : ''}`};
  }
  return {tag: '', reason: stables.length ? `no stable is old enough and green: ${skipped.join('; ')}` : 'no stable release'};
}

/** The GitHub calls the pick needs, over `fetcher`. */
export function github(env = process.env, fetcher = fetch) {
  const base = `${env.GITHUB_API_URL || 'https://api.github.com'}/repos/${env.GITHUB_REPOSITORY}`;
  const call = async (path, init = {}) => {
    const answer = await fetcher(`${base}/${path}`, {...init, headers: {Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json', ...(init.body ? {'Content-Type': 'application/json'} : {})}, signal: AbortSignal.timeout(20000)});
    if (!answer.ok) throw new Error(`${path}: GitHub ${answer.status}`);
    return answer;
  };
  return {
    async stables() {
      const releases = await (await call('releases?per_page=50')).json();
      return releases.filter(r => !r.prerelease && !r.draft).map(r => ({tag: r.tag_name, version: /^desktop-v(\d+\.\d+\.\d+)$/.exec(r.tag_name)?.[1], publishedAt: r.published_at})).filter(r => r.version);
    },
    async lastSubmitted() {
      const refs = await (await call('git/matching-refs/tags/msstore-submitted-')).json();
      return refs.map(ref => ref.ref.slice('refs/tags/msstore-submitted-'.length)).filter(v => /^\d+\.\d+\.\d+$/.test(v)).sort(compareVersions).pop() || '';
    },
    /** true when a finished run of a RED_WORKFLOWS workflow on the release's commit failed. */
    async isRed(stable) {
      const {sha} = await (await call(`commits/${stable.tag}`)).json();
      const {workflow_runs: runs = []} = await (await call(`actions/runs?head_sha=${sha}&per_page=100`)).json();
      return runs.some(run => RED_WORKFLOWS.some(file => String(run.path || '').endsWith(`/${file}`)) && run.conclusion === 'failure');
    },
    async dispatch(tag) { await call('actions/workflows/msix-store.yml/dispatches', {method: 'POST', body: JSON.stringify({ref: 'main', inputs: {tag}})}); },
  };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    const gh = github();
    const {tag, reason} = await pick(await gh.stables(), {lastSubmitted: await gh.lastSubmitted(), isRed: stable => gh.isRed(stable)});
    console.log(`weekly Store pick: ${tag || 'nothing'} (${reason})`);
    if (tag && !process.env.DRY_RUN) { await gh.dispatch(tag); console.log(`started msix-store.yml for ${tag}`); }
  } catch (error) { console.error(error.message); process.exit(1); }
}
