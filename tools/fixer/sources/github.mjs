// Source "github": one GitHub issue of THIS repository as the loop's item ([hm] 6/7, 5 Nov 2026; owner chose "Read the issues from GitHub" after run 1 could not read a feedback card: the site hands a card only to feedback-ai.yml).
// Two halves, so no token sits next to the AI: `fetchIssue` runs in the guard job (a read-only github.token) and writes item.json; `read` runs in the fix job, from that file only (no network, no token).
// Why (5 Nov 2026): a public issue can be opened by anyone, so only an issue filed by the owner's account (PR_COMMENTS_OWNER, default GarryOne) is taken; its text is still DATA in a random fence, scrubbed twice, like every other source.
import fs from 'node:fs';
import {redactBrief} from '../leaks.mjs';
import {CAPS, fenced} from '../loop.mjs';
import {EDITABLE, MAX_FILES, MAX_PATCH_BYTES} from '../walls.mjs';

export const name = 'github';
export const ISSUE = /^[1-9]\d{0,6}$/;   // no leading zero: the branch name and the file's number must read the same
const TITLE_CHARS = 200, BODY_CHARS = 8000;

/** The issue from GitHub's REST API (guard job): `{number, title, body}` of an open or closed ISSUE (not a pull request) filed by the owner; throws with a reason of ours otherwise. `env`: GITHUB_REPOSITORY, GH_TOKEN, PR_COMMENTS_OWNER. */
export async function fetchIssue(ref, {env = process.env, fetchImpl = fetch} = {}) {
  if (!ISSUE.test(String(ref))) throw new Error('a GitHub issue ref is its number');
  const answer = await fetchImpl(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/issues/${ref}`, {headers: {Authorization: `Bearer ${env.GH_TOKEN || ''}`, Accept: 'application/vnd.github+json'}, signal: AbortSignal.timeout(20000)});
  if (!answer.ok) throw new Error(`the issue could not be read (HTTP ${answer.status})`);
  const issue = await answer.json();
  if (issue.pull_request) throw new Error('that number is a pull request, not an issue');
  if (issue.user?.login !== (env.PR_COMMENTS_OWNER || 'GarryOne')) throw new Error('only an issue the owner filed is taken');
  return {number: issue.number, title: String(issue.title || '').slice(0, TITLE_CHARS), body: String(issue.body || '').slice(0, BODY_CHARS)};
}

/** `read(ref, {env})` -> {title, what, brief, block(fence), allowedPaths, caps}; reads env.FIXER_ITEM (the guard's item.json), never the network. Throws when the file is missing or is not this issue's. */
export async function read(ref, {env = process.env} = {}) {
  if (!ISSUE.test(String(ref))) throw new Error('a GitHub issue ref is its number');
  let item;
  try { item = JSON.parse(fs.readFileSync(env.FIXER_ITEM || '', 'utf8')); } catch { throw new Error('the issue file is missing (the guard job writes it)'); }
  if (String(item.number) !== String(ref)) throw new Error('the issue file is another issue\'s');
  const brief = redactBrief({text: `# Issue: ${String(item.title).slice(0, TITLE_CHARS)}\n\n${String(item.body).slice(0, BODY_CHARS)}`, screen: '', files: {}});
  return {title: String(item.title).slice(0, TITLE_CHARS), what: 'a bug or task the owner filed as a GitHub issue', brief, block: fence => fenced('THE ISSUE', brief.text, fence), allowedPaths: EDITABLE, caps: {...CAPS, maxFiles: MAX_FILES, maxBytes: MAX_PATCH_BYTES}};
}
