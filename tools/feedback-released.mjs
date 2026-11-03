// After a build becomes STABLE, tells the website which pull requests it carries, so the reporters whose fix is in it hear "fixed in 0.9.13" (jobadabra-web POST /api/feedback/released,
// spec docs/superpowers/specs/2026-11-03-feedback-actions-design.md PR 6/7). Started by tools/release-stable.sh as its own workflow run (feedback-released.yml), never inside the promotion:
//   node tools/feedback-released.mjs <desktop-vX.Y.Z>      (GITHUB_REPOSITORY, GH_TOKEN, SELFHEAL_PUBLISH_KEY, CI_ALERTS_TELEGRAM_BOT_TOKEN + _CHAT_ID from the runner; FEEDBACK_RELEASED_URL for a test site)
// Why (3 Nov 2026, owner: "when we release a new beta/stable version which includes a feedback fix, we should automatically inform all the reporters"; stable only, owner's answer the same day): a
// reporter should hear "fixed" when the fix reaches them. mac-07: a slow or failing call must never fail, delay or block a release, so this runs in its own run after the promotion, every request is
// bounded (20 s, 3 tries on a network error or a 5xx), and a failure is one log line, one Telegram note and a red run of THIS workflow (retry by hand: the site tells each reporter once).
// The pull requests are the "(#123)" at the end of the commit subjects between the previous stable release and this tag; no previous stable is found: an empty list (the site then matches only by version or by time).
import path from 'node:path';
import {alertHtml} from '../desktop/e2e/lib/telegram-html.mjs';
import {send} from '../desktop/e2e/ci-alert.mjs';
import {commitOf} from '../desktop/e2e/release-alert.mjs';

const URL_DEFAULT = 'https://www.jobadabra.top/api/feedback/released';
const TAG = /^desktop-v(\d+(?:\.\d+)*)$/;

/** The PR numbers in commit subjects: the "(#123)" a squash merge puts at the end of the first line. Sorted, no duplicates. */
export const prNumbers = subjects => [...new Set(subjects.map(line => Number(String(line).split('\n')[0].match(/\(#(\d+)\)\s*$/)?.[1])).filter(Number.isInteger))].sort((a, b) => a - b);

const parts = tag => TAG.exec(tag)?.[1].split('.').map(Number) || null;
const order = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0); return 0; };
/** The newest stable tag older than `tag` (by version), or '' when there is none or `tag` is not a desktop-v tag. */
export const previousStable = (tags, tag) => {
  const mine = parts(tag);
  return mine ? tags.filter(other => other !== tag && parts(other) && order(parts(other), mine) < 0).sort((a, b) => order(parts(b), parts(a)))[0] || '' : '';
};

const api = env => env.GITHUB_API_URL || 'https://api.github.com';
const github = (url, env, fetcher) => fetcher(url, {headers: {Authorization: `Bearer ${env.GH_TOKEN || ''}`, Accept: 'application/vnd.github+json'}, signal: AbortSignal.timeout(20000)});

/** Every stable (not pre-release, not draft) release tag, newest first, up to 300. */
async function stableTags(env, fetcher) {
  const tags = [];
  for (let page = 1; page <= 3; page++) {
    const answer = await github(`${api(env)}/repos/${env.GITHUB_REPOSITORY}/releases?per_page=100&page=${page}`, env, fetcher);
    if (!answer.ok) throw new Error(`releases list: HTTP ${answer.status}`);
    const list = await answer.json();
    tags.push(...list.filter(release => !release.prerelease && !release.draft).map(release => release.tag_name));
    if (list.length < 100) break;
  }
  return tags;
}

/** The first lines of the commits in prev...tag (up to 500). */
async function subjectsBetween(prev, tag, env, fetcher) {
  const lines = [];
  for (let page = 1; page <= 5; page++) {
    const answer = await github(`${api(env)}/repos/${env.GITHUB_REPOSITORY}/compare/${encodeURIComponent(prev)}...${encodeURIComponent(tag)}?per_page=100&page=${page}`, env, fetcher);
    if (!answer.ok) throw new Error(`compare ${prev}...${tag}: HTTP ${answer.status}`);
    const body = await answer.json(), commits = body.commits || [];
    lines.push(...commits.map(commit => String(commit.commit?.message || '').split('\n')[0]));
    if (commits.length < 100) break;
  }
  return lines;
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

const note = (title, verdict, tag, env) => alertHtml({icon: '⚠️', title, verdict, bullets: [{label: 'Release', parts: [tag]}],
  links: env.GITHUB_RUN_ID ? [{text: 'Open the run', url: `${env.GITHUB_SERVER_URL || 'https://github.com'}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`}] : []});

/**
 * Tells the site this stable release's pull requests. Never throws. -> {ok, line}: `line` is what to print; a failure has also been sent to Telegram (a send that fails changes nothing).
 * `wait`: ms between tries (a test passes 0).
 */
export async function tellSite({tag, env = process.env, fetcher = fetch, wait = 5000}) {
  const fail = async (cause, extra = '') => { const line = `feedback-released: ${cause}${extra}`; await send(note('Feedback reporters were not told', cause, tag, env), env, fetcher).catch(() => {}); return {ok: false, line}; };
  const key = env.SELFHEAL_PUBLISH_KEY;
  if (!TAG.test(String(tag))) return {ok: false, line: `feedback-released: "${tag}" is not a desktop-vX.Y.Z tag`};
  if (!key) return fail('SELFHEAL_PUBLISH_KEY is not set in this repository', ': the site refuses the call without it');
  try {
    const commit = await commitOf(tag, env, fetcher);
    if (!commit?.date) return fail(`the commit of ${tag} could not be read`);
    const prev = previousStable(await stableTags(env, fetcher), tag);
    const prs = prev ? prNumbers(await subjectsBetween(prev, tag, env, fetcher)) : [];
    const answer = await post(env.FEEDBACK_RELEASED_URL || URL_DEFAULT, key, {version: tag.replace(/^desktop-v/, ''), channel: 'stable', prs, cutAt: new Date(commit.date).toISOString()}, {fetcher, wait});
    if (!answer.ok) return fail(`the site answered ${answer.status || 'nothing'} after ${answer.tries} ${answer.tries === 1 ? 'try' : 'tries'}`, answer.body?.error ? ` (${String(answer.body.error).slice(0, 120)})` : '');
    const {told = 0, waiting = 0, failed = []} = answer.body || {};
    const line = `feedback-released: ${tag} (stable, ${prs.length} PRs since ${prev || 'no earlier stable'}): told ${told}, still waiting ${waiting}${failed.length ? `, NOT confirmed ${failed.length}` : ''}`;
    if (failed.length) await send(note('Some reporters were not confirmed', `${failed.length} could not be confirmed (their cards say so on /admin/feedback/inbox)`, tag, env), env, fetcher).catch(() => {});
    return {ok: true, line};
  } catch (error) { return fail(`could not prepare the call: ${String(error.message || error).slice(0, 160)}`); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const {ok, line} = await tellSite({tag: process.argv[2]});
  console.log(line);
  if (!ok) { console.log(`::error title=Feedback reporters not told::${line}`); process.exit(1); }
}
