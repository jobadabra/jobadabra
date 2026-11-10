// After a build becomes STABLE, tells the website which pull requests it carries, so the reporters whose fix is in it hear "fixed in 0.9.13" (jobadabra-web POST /api/feedback/released,
// spec docs/superpowers/specs/2026-11-03-feedback-actions-design.md PR 6/7). Started by tools/release-stable.sh as its own workflow run (feedback-released.yml), never inside the promotion:
//   node tools/feedback-released.mjs <desktop-vX.Y.Z>      (GITHUB_REPOSITORY, GH_TOKEN, SELFHEAL_PUBLISH_KEY, CI_ALERTS_TELEGRAM_BOT_TOKEN + _CHAT_ID from the runner; FEEDBACK_RELEASED_URL for a test site)
// Why (3 Nov 2026, owner: "when we release a new beta/stable version which includes a feedback fix, we should automatically inform all the reporters"; stable only, owner's answer the same day): a
// reporter should hear "fixed" when the fix reaches them. mac-07: a slow or failing call must never fail, delay or block a release, so this runs in its own run after the promotion, every request is
// bounded (20 s, 3 tries on a network error or a 5xx), and a failure is one log line, one Telegram note and a red run of THIS workflow (retry by hand: the site tells each reporter once).
// The pull requests are the "(#123)" at the end of the commit subjects between the previous stable release and this tag; no previous stable is found: an empty list (the site then matches only by version or by time).
import path from 'node:path';
import {card} from '../desktop/e2e/lib/tg-card.mjs';
import {send} from '../desktop/e2e/ci-alert.mjs';
import {commitOf} from '../desktop/e2e/release-alert.mjs';

const URL_DEFAULT = 'https://www.jobadabra.top/api/feedback/released';
const MAX_EARLIER = 50, EARLIER_BUDGET_MS = 120000;   // lookups per release (a few GitHub calls each, only for cards still waiting) and the time they may take together
const TAG = /^desktop-v(\d+(?:\.\d+)*)$/;

/** The PR numbers in commit subjects: the "(#123)" a squash merge puts at the end of the first line. Sorted, no duplicates. */
export const prNumbers = subjects => {
  const lines = subjects.map(line => String(line).split('\n')[0]), numbers = new Set(lines.map(line => Number(line.match(/\(#(\d+)\)\s*$/)?.[1])).filter(Number.isInteger));
  // Why (6/7 code review, 3 Nov 2026): a Revert subject in the same range cancels the PR it reverts, so that reporter is not told "fixed" for a fix that was taken out.
  // In order, oldest first: a revert takes its PR out, a revert of that revert puts it back (the nesting depth of the Revert prefixes says which; 6/7 review, Gitar).
  for (const line of lines) {
    const depth = (line.match(/^(?:Revert ")+/)?.[0].length || 0) / 'Revert "'.length, inner = Number(line.match(/\(#(\d+)\)"/)?.[1]);
    if (depth && Number.isInteger(inner)) { if (depth % 2) numbers.delete(inner); else numbers.add(inner); }
  }
  return [...numbers].sort((a, b) => a - b);
};

const parts = tag => TAG.exec(tag)?.[1].split('.').map(Number) || null;
const order = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0); return 0; };
/** The newest stable tag older than `tag` (by version), or '' when there is none or `tag` is not a desktop-v tag. */
export const previousStable = (tags, tag) => {
  const mine = parts(tag);
  return mine ? tags.filter(other => other !== tag && parts(other) && order(parts(other), mine) < 0).sort((a, b) => order(parts(b), parts(a)))[0] || '' : '';
};

const api = env => env.GITHUB_API_URL || 'https://api.github.com';
const github = (url, env, fetcher) => fetcher(url, {headers: {Authorization: `Bearer ${env.GH_TOKEN || ''}`, Accept: 'application/vnd.github+json'}, signal: AbortSignal.timeout(20000)});

/** Every stable (not pre-release, not draft) release tag, newest first, up to 1000. */
async function stableTags(env, fetcher) {
  const tags = [];
  for (let page = 1; page <= 10; page++) {
    const answer = await github(`${api(env)}/repos/${env.GITHUB_REPOSITORY}/releases?per_page=100&page=${page}`, env, fetcher);
    if (!answer.ok) throw new Error(`releases list: HTTP ${answer.status}`);
    const list = await answer.json();
    tags.push(...list.filter(release => !release.prerelease && !release.draft).map(release => release.tag_name));
    if (list.length < 100) break;
  }
  return tags;
}

const MAX_COMMITS = 3000;
/**
 * The first lines of ALL commits in prev...tag. GitHub lists them oldest first, 100 a page, so a range that is not read to its end would lose the newest PRs, the ones this release is about:
 * the pages are counted from `total_commits`, and a range over MAX_COMMITS fails loudly (Why, 6/7 code review, 3 Nov 2026: 0.8.60...0.8.86 is 766 commits, a long hold is more than 500).
 */
const subjectsBetween = async (prev, tag, env, fetcher) => (await rangeBetween(prev, tag, env, fetcher)).lines;
/**
 * -> {status, lines}: GitHub's compare status of base...tag ("ahead" = base is an ancestor of the tag) and the first line of every commit in it, oldest first.
 * `due` (ms clock reading, optional) is checked before every page: Why (3 Nov 2026, Gitar on #3104): a lookup started just under the budget could otherwise read up to 30 pages of 20 s each and overrun it.
 */
async function rangeBetween(prev, tag, env, fetcher, {due = Infinity, now = Date.now} = {}) {
  const lines = [];
  let pages = 1, status = '';
  for (let page = 1; page <= pages; page++) {
    if (now() > due) throw new Error(`compare ${prev}...${tag}: out of time`);
    const answer = await github(`${api(env)}/repos/${env.GITHUB_REPOSITORY}/compare/${encodeURIComponent(prev)}...${encodeURIComponent(tag)}?per_page=100&page=${page}`, env, fetcher);
    if (!answer.ok) throw new Error(`compare ${prev}...${tag}: HTTP ${answer.status}`);
    const body = await answer.json();
    if (page === 1) {
      status = String(body.status || '');
      const total = Number(body.total_commits) || (body.commits || []).length;
      if (total > MAX_COMMITS) throw new Error(`${prev}...${tag} is ${total} commits: more than ${MAX_COMMITS}, the list of pull requests would be cut`);
      pages = Math.ceil(total / 100);
    }
    lines.push(...(body.commits || []).map(commit => String(commit.commit?.message || '').split('\n')[0]));
  }
  return {status, lines};
}

/**
 * The PRs of the site's waiting cards that this tag CONTAINS although they are not in its own commit list. Why (3 Nov 2026, owner; card c1ea31a0): a fix that shipped in 0.9.4 got its card marked
 * "fixed" after 0.9.4 was told, and every later release's list is "since the previous stable", so it waited through 0.9.6. The site (GET) names the PRs its waiting cards hold; a merged PR whose merge
 * commit is an ancestor of the tag (GitHub compare <merge commit>...<tag> says ahead or identical) is inside this release. Never throws and never blocks: a PR that cannot be read stays waiting, the next release asks again.
 * -> [PR numbers] sorted, not already in `listed`, at most MAX_EARLIER lookups.
 */
export async function earlierFixes({tag, url, key, listed, env, fetcher, now = Date.now}) {
  const found = [], started = now();
  try {
    const answer = await fetcher(url, {method: 'GET', headers: {Authorization: `Bearer ${key}`}, signal: AbortSignal.timeout(20000)});
    const waiting = answer.ok ? (await answer.json().catch(() => null))?.prs : null;
    for (const number of (Array.isArray(waiting) ? waiting : []).filter(n => Number.isInteger(n) && n > 0 && !listed.includes(n)).slice(0, MAX_EARLIER)) {
      if (now() - started > EARLIER_BUDGET_MS) break;   // the own-PR POST must still fit the workflow's 10 minutes
      try {
        const pull = await github(`${api(env)}/repos/${env.GITHUB_REPOSITORY}/pulls/${number}`, env, fetcher);
        const data = pull.ok ? await pull.json().catch(() => null) : null;
        if (!data?.merged_at || !data.merge_commit_sha) continue;   // not merged (an open PR can still carry a test-merge sha), or unreadable: still waiting
        const {status, lines} = await rangeBetween(data.merge_commit_sha, tag, env, fetcher, {due: started + EARLIER_BUDGET_MS, now});
        // A revert anywhere between the merge and the tag takes the fix out (prNumbers reads them oldest first), exactly as it does inside a release's own range.
        if (['ahead', 'identical'].includes(status) && prNumbers([`merge (#${number})`, ...lines]).includes(number)) found.push(number);
      } catch { /* this PR stays waiting, the next release asks again */ }
    }
  } catch { /* the site could not list its waiting cards: nothing earlier this time */ }
  return found.sort((a, b) => a - b);
}

/** One POST to the site, bounded: 20 s each, up to `tries` on a network error or a 5xx (`wait` ms between); a 4xx is final. -> {ok, status, body, tries} (status 0 = no answer). */
export async function post(url, key, body, {fetcher = fetch, tries = 3, wait = 5000} = {}) {
  let last = {ok: false, status: 0, body: null, tries: 0};
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const answer = await fetcher(url, {method: 'POST', headers: {Authorization: `Bearer ${key}`, 'Content-Type': 'application/json'}, body: JSON.stringify(body), signal: AbortSignal.timeout(20000)});
      last = {ok: answer.ok, status: answer.status, body: await answer.json().catch(() => null), tries: attempt};
      if (answer.status < 500) return last;
    } catch { last = {ok: false, status: 0, body: null, tries: attempt}; }
    if (attempt < tries) await new Promise(resolve => setTimeout(resolve, wait));
  }
  return last;
}

// Why (10 Nov 2026, owner: every message reads like the Central scout one): the headline names the release, the cause is the one verdict line.
export const note = (title, verdict, tag, env) => card({level: 'orange', headline: `${title} · ${tag}`, verdict: {ok: false, text: verdict},
  link: env.GITHUB_RUN_ID ? {text: 'Open the run', url: `${env.GITHUB_SERVER_URL || 'https://github.com'}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`} : null});

/**
 * Tells the site this stable release's pull requests. Never throws. -> {ok, line}: `line` is what to print; a failure has also been sent to Telegram (a send that fails changes nothing).
 * `wait`: ms between tries (a test passes 0).
 */
export async function tellSite({tag, env = process.env, fetcher = fetch, wait = 5000}) {
  const fail = async (cause, extra = '') => { const line = `feedback-released: ${cause}${extra}`; await send(note('Feedback reporters were not told', cause, tag, env), env, fetcher, {event: 'feedback-not-told', level: 'problem'}).catch(() => {}); return {ok: false, line}; };
  const key = env.SELFHEAL_PUBLISH_KEY;
  if (!TAG.test(String(tag))) return {ok: false, line: `feedback-released: "${tag}" is not a desktop-vX.Y.Z tag`};
  if (!key) return fail('SELFHEAL_PUBLISH_KEY is not set in this repository', ': the site refuses the call without it');
  try {
    const commit = await commitOf(tag, env, fetcher);
    if (!commit?.date) return fail(`the commit of ${tag} could not be read`);
    const prev = previousStable(await stableTags(env, fetcher), tag);
    const own = prev ? prNumbers(await subjectsBetween(prev, tag, env, fetcher)) : [], siteUrl = env.FEEDBACK_RELEASED_URL || URL_DEFAULT;
    const earlier = await earlierFixes({tag, url: siteUrl, key, listed: own, env, fetcher}), prs = [...own, ...earlier].sort((a, b) => a - b);
    const answer = await post(siteUrl, key, {version: tag.replace(/^desktop-v/, ''), channel: 'stable', prs, cutAt: new Date(commit.date).toISOString()}, {fetcher, wait});
    if (!answer.ok) return fail(`the site answered ${answer.status || 'nothing'} after ${answer.tries} ${answer.tries === 1 ? 'try' : 'tries'}`, answer.body?.error ? ` (${String(answer.body.error).slice(0, 120)})` : '');
    const {told = 0, waiting = 0} = answer.body || {}, failed = Array.isArray(answer.body?.failed) ? answer.body.failed : [];   // Why (6/7 review): a null or odd `failed` is no failure of ours
    const line = `feedback-released: ${tag} (stable, ${own.length} PRs since ${prev || 'no earlier stable'}${earlier.length ? `, ${earlier.length} earlier fix${earlier.length === 1 ? '' : 'es'} the tag contains` : ''}): told ${told}, still waiting ${waiting}${failed.length ? `, NOT confirmed ${failed.length}` : ''}`;
    if (failed.length) await send(note('Some reporters were not confirmed', `${failed.length} could not be confirmed (their cards say so on /admin/feedback/inbox)`, tag, env), env, fetcher, {event: 'feedback-not-told', level: 'problem'}).catch(() => {});
    return {ok: true, line};
  } catch (error) { return fail(`could not prepare the call: ${String(error.message || error).slice(0, 160)}`); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const {ok, line} = await tellSite({tag: process.argv[2]});
  console.log(line);
  if (!ok) { console.log(`::error title=Feedback reporters not told::${line}`); process.exit(1); }
}
