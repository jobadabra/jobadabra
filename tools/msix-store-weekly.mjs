// Picks the stable release that goes to the Microsoft Store this week, and starts msix-store.yml for it (used by .github/workflows/msix-store-weekly.yml, started by the Worker on Mondays).
//   node tools/msix-store-weekly.mjs            (env GH_TOKEN, GITHUB_REPOSITORY; DRY_RUN=1 prints the pick and starts nothing)
// Why (7 Nov 2026, owner: "how the microsoft publishes are going? If we release stable every day, and they take 4 days to approve one version" · "To release less often on Microsoft store" ·
// "Weekly, a fixed day (Recommended)": "One submission a week (e.g. Monday's stable), only after it has run a day on the .exe without a red"): until then every stable started a Store submission,
// 0.9.1 … 0.9.16 were all skipped behind 0.8.86, which sat in review for 5 days.
// Invariants: only a stable desktop release; stable for at least MIN_AGE_HOURS; no failed main-check run on its commit;
// newer than the last version submitted (the Store wants each submission higher; a version Microsoft refused is therefore not sent again until a newer stable passes);
// nothing here submits: it starts msix-store.yml, which keeps its own "a version still in review waits" guard.
import {compareVersions} from './msix-store-watch.mjs';

export const MIN_AGE_HOURS = 24;
/** Workflows whose failed run on a release's commit means "red": the checks main runs on every push. */
export const RED_WORKFLOWS = ['build.yml', 'e2e.yml'];
/** Conclusions that are not a pass. */
const NOT_A_PASS = ['failure', 'timed_out', 'startup_failure'];
/** Candidates looked at per week: a few days of stables; older ones are not worth an API walk. */
export const MAX_CANDIDATES = 8;

/**
 * The tag to send, from `stables` ([{version, tag, publishedAt}] in any order). Newest first (at most MAX_CANDIDATES): too young (< MIN_AGE_HOURS since `promotedAt(stable)`, the date
 * tools/release-stable.sh recorded when it made the release stable; '' = none recorded, as for stables promoted before 7 Nov 2026: then `publishedAt`, the beta's date, which is earlier), or blocked
 * (`isRed(stable)` returns a reason: a run that did not pass, or unreadable) is skipped for the next older one; the first that passes is the pick, unless it is not newer than `lastSubmitted`.
 * -> {tag: string, reason: string}; tag '' = send nothing this week.
 */
export async function pick(stables, {now = new Date(), lastSubmitted = '', isRed = async () => '', promotedAt = async () => ''} = {}) {
  const skipped = [];
  for (const stable of [...stables].sort((a, b) => compareVersions(b.version, a.version)).slice(0, MAX_CANDIDATES)) {
    let since = stable.publishedAt, blocked = '';
    try { since = await promotedAt(stable) || since; blocked = await isRed(stable); }
    catch (error) { blocked = `could not be checked (${error.message})`; }   // an unreadable candidate is skipped, never trusted and never a failed week
    const ageHours = (now - new Date(since)) / 3600000;
    if (ageHours < MIN_AGE_HOURS) { skipped.push(`${stable.version} has been stable ${Math.floor(ageHours)} h`); continue; }
    if (blocked) { skipped.push(`${stable.version} ${blocked}`); continue; }
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
    /** '' when the release's commit has no RED_WORKFLOWS run that did not pass; else why. */
    async isRed(stable) {
      const {sha} = await (await call(`commits/${stable.tag}`)).json();
      const runs = [];
      for (let page = 1; page <= 5; page++) {
        const {workflow_runs: batch = []} = await (await call(`actions/runs?head_sha=${sha}&per_page=100&page=${page}`)).json();
        runs.push(...batch);
        if (batch.length < 100) break;
      }
      const file = run => String(run.path || '').split('@')[0].split('/').pop();
      const bad = runs.find(run => RED_WORKFLOWS.includes(file(run)) && NOT_A_PASS.includes(run.conclusion));
      // Why (7 Nov 2026, measured): a release's commit does not always carry a build.yml run (0.9.13's has none, 0.9.15's has one), so "no green build.yml" would skip good releases for old ones: only a run that did not pass blocks.
      return bad ? `has a ${bad.conclusion} ${file(bad)} run` : '';
    },
    /** When tools/release-stable.sh made the release stable (the annotated tag stable-promoted-X.Y.Z), '' when none was recorded. */
    async promotedAt(stable) {
      const answer = await fetcher(`${base}/git/ref/tags/stable-promoted-${stable.version}`, {headers: {Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json'}, signal: AbortSignal.timeout(20000)});
      if (answer.status === 404) return '';
      if (!answer.ok) throw new Error(`stable-promoted-${stable.version}: GitHub ${answer.status}`);
      const {object} = await answer.json();
      return object?.type === 'tag' ? (await (await call(`git/tags/${object.sha}`)).json()).tagger?.date || '' : '';
    },
    async dispatch(tag) { await call('actions/workflows/msix-store.yml/dispatches', {method: 'POST', body: JSON.stringify({ref: 'main', inputs: {tag}})}); },
  };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    const gh = github();
    const {tag, reason} = await pick(await gh.stables(), {lastSubmitted: await gh.lastSubmitted(), isRed: stable => gh.isRed(stable), promotedAt: stable => gh.promotedAt(stable)});
    console.log(`weekly Store pick: ${tag || 'nothing'} (${reason})`);
    if (tag && !process.env.DRY_RUN) { await gh.dispatch(tag); console.log(`started msix-store.yml for ${tag}`); }
  } catch (error) { console.error(error.message); process.exit(1); }
}
