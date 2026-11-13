#!/usr/bin/env node
// Decides whether Claude reviews a PR head on CI (gate) and posts its ONE GitHub review of that head (post); the workflows are .github/workflows/claude-review-shared.yml (reusable) and claude-review.yml (jobadabra's caller).
// Why (owner, 13 Nov 2026, asked via AskUserQuestion: "Trial Claude on jobadabra (Recommended)", after "Let's explore alternatives to Gitar" / "Maybe Claude"): Gitar's automatic reviews are used up until 1 Dec and
//   by-hand asks are refused past ~2 in 10 min, so PRs wait 20-40 min for a review. A Claude review of a green head, as a real GitHub review, is the trial; Gitar stays on as backup. It is a reviewer, not a required check.
// Design: states of a head: not-green | skipped (draft, "DONT MERGE", a fork, closed, already reviewed, cap) | reviewed (ONE review: APPROVE when no high/medium finding, else REQUEST_CHANGES). The decision is
//   decide() below, a pure function; the model only returns findings (structured output), this script alone turns them into the review, so one head never gets two and the verdict is never a model's mood.
//   Counted from GitHub, not from a counter: our reviews carry `<!-- claude-review sha=<head> -->`; the per-day cap counts them over the 100 most recently updated PRs.
//   The rules are the repository's own `.gitar/review/*.md`, read from the checked-out BASE branch at run time (never copied into a workflow, never from the PR): what Gitar reviews by, Claude reviews by (owner, 13 Nov 2026: "A+B+D").
//   A later push is reviewed on the diff since the last reviewed head when that head is still an ancestor (compare says "ahead"), else on the whole PR; the last review's findings are handed over to be re-checked.
// Usage: node tools/claude-review.mjs gate | post   (env in the workflow; outputs to $GITHUB_OUTPUT and $GITHUB_STEP_SUMMARY). Needs GH_TOKEN, GITHUB_REPOSITORY; gate: PR, MODE (auto | manual), ASKED_BY (manual), SHA (auto), CLAUDE_REVIEW_DAILY_CAP.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const CHECK = 'All checks passed';
export const CAP_DEFAULT = 60;
export const MAX_FINDINGS = 5;
const BOT = 'github-actions';   // the login GraphQL reports for a review posted with GITHUB_TOKEN
const MARK = /<!-- claude-review sha=([0-9a-f]{40})(?: findings=(\S*))? -->/;
const GH_RETRY = fileURLToPath(new URL('./gh_retry.py', import.meta.url));
const gh = (...args) => execFileSync('python3', [GH_RETRY, ...args], {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});

/** True for a title that holds the PR (the "DONT MERGE" rule, CLAUDE.md "Shipping and PRs"). */
export const isHold = title => /DONT MERGE/i.test(title || '');

/** Our reviews among `reviews` ({author:{login}, submittedAt, body}), oldest first: {sha, at, findings, verdict} (findings: the compact list the review carried, [] when unreadable; verdict: APPROVE | REQUEST_CHANGES, read from the headline). */
export function ourReviews(reviews) {
  return (reviews || []).filter(Boolean).filter(r => r.author?.login === BOT && MARK.test(r.body || '')).map(r => {
    const [, sha, packed] = MARK.exec(r.body);
    let findings = [];
    try { findings = packed ? JSON.parse(decodeURIComponent(packed)) : []; } catch { /* a review whose list cannot be read hands none over */ }
    // Fail closed: a headline that is not exactly "✅ Approve" (a truncated or edited body) reads as changes requested, never as an approval.
    return {sha, at: r.submittedAt, findings, verdict: /^\*\*Claude review: ✅ Approve\*\*/.test(r.body) ? 'APPROVE' : 'REQUEST_CHANGES'};
  }).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/** How many of our reviews were submitted since 00:00 UTC of `now`'s day, over the PRs GraphQL listed (`prs`: [{reviews:{nodes}}]). */
export function reviewsToday(prs, now = Date.now()) {
  const start = Date.parse(new Date(now).toISOString().slice(0, 10) + 'T00:00:00Z');
  return (prs || []).filter(Boolean).flatMap(p => ourReviews(p.reviews?.nodes)).filter(r => Date.parse(r.at) >= start).length;
}

/** The decision for one PR head: {go, reason}. `manual`: the owner's "@claude review" comment (it runs on drafts and held PRs and re-reviews a reviewed head, but never on a fork, a closed PR or over the cap).
 * `pr`: {state, isDraft, title, head, headRepo, status} (status: the head's "All checks passed" state); `repo`; `wantedSha`: the head the dispatcher saw; `reviews`: ourReviews(); `today`, `cap`. */
export function decide({pr, repo, manual = false, wantedSha = '', reviews = [], today = 0, cap = CAP_DEFAULT}) {
  if (pr.state !== 'OPEN') return {go: false, reason: 'the PR is not open'};
  if (pr.headRepo !== repo) return {go: false, reason: 'the PR comes from a fork: its code never meets the plan token'};
  if (!manual) {
    if (pr.isDraft) return {go: false, reason: 'a draft'};
    if (isHold(pr.title)) return {go: false, reason: 'its title says DONT MERGE'};
    if (wantedSha && wantedSha !== pr.head) return {go: false, reason: 'the head moved since this was started'};
    if (pr.status !== 'SUCCESS') return {go: false, reason: `"${CHECK}" is ${String(pr.status || 'missing').toLowerCase()} on this head`};
    if (reviews.some(r => r.sha === pr.head)) return {go: false, reason: 'this head is already reviewed'};
  }
  if (today >= cap) return {go: false, reason: 'cap', cap};
  return {go: true, reason: manual ? 'asked by "@claude review"' : 'green head'};
}

/** The diff base for a re-review: the last reviewed head when it is an ancestor of the new head (`compareStatus` of last...head is "ahead"), else '' (the whole PR against its base). */
export function diffBase(lastSha, compareStatus) {
  return lastSha && compareStatus === 'ahead' ? lastSha : '';
}

/** APPROVE when no finding is high or medium, else REQUEST_CHANGES (owner, 5 Nov 2026: "high or medium is fixed now, low is parked": a low finding is listed, never blocks). */
export function verdictOf(findings) {
  return (findings || []).some(f => ['high', 'medium'].includes(f.severity)) ? 'REQUEST_CHANGES' : 'APPROVE';
}

/** True when `text` (the final error message of a run) says the Claude plan is out: a usage limit, rate limit, quota or credit. Narrow on purpose: it is only ever given the run's LAST result message, never the transcript,
 * so a PR whose diff talks about quotas or 429s cannot turn a real failure into a skip (Gitar's finding on #4119). */
export const planLimitHit = text => /usage limit|rate limit|limit reached|out of credit|credit balance|too many requests/i.test(String(text || ''));

/** The error text of the run's last `result` message when it is an error ('' otherwise or when unreadable): `messages` is the action's execution file (an array of Claude Code messages). */
export function finalError(messages) {
  const result = [...(Array.isArray(messages) ? messages : [])].reverse().find(m => m?.type === 'result');
  return result && result.is_error ? String(result.result || result.error || '') : '';
}

const ICON = {high: '🔴', medium: '🟠', low: '⚪'};

/** The review to post for `result` ({summary, findings:[{severity,path,line,title,body}]}) of head `sha`: {event, body, comments}. Inline comments only for findings with a path and a line; the body lists every finding
 * so a review that GitHub refuses inline (a line outside the diff) still says all of it. At most MAX_FINDINGS, worst first. */
export function reviewPayload(result, sha, {from = '', approveAllowed = true} = {}) {
  const order = {high: 0, medium: 1, low: 2};
  const findings = [...(result.findings || [])].sort((a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3)).slice(0, MAX_FINDINGS);
  const verdict = verdictOf(findings);
  const event = verdict === 'APPROVE' && !approveAllowed ? 'COMMENT' : verdict;
  const lines = [`**Claude review: ${verdict === 'APPROVE' ? '✅ Approve' : '⛔ Request changes'}** on \`${sha.slice(0, 7)}\`${from ? ` (the diff since \`${from.slice(0, 7)}\`)` : ''}`, '', String(result.summary || '').trim()];
  if (verdict === 'APPROVE' && !approveAllowed) lines.push('', '_Posted as a comment: this repository does not let GitHub Actions approve pull requests._');
  if (findings.length) lines.push('', ...findings.map(f => `- ${ICON[f.severity] || '⚪'} **${f.severity}** ${f.path ? `\`${f.path}${f.line ? `:${f.line}` : ''}\` ` : ''}${f.title || ''}`));
  const packed = encodeURIComponent(JSON.stringify(findings.map(f => ({severity: f.severity, path: f.path, line: f.line, title: f.title})))).slice(0, 4000);
  lines.push('', `<!-- claude-review sha=${sha} findings=${packed} -->`);
  const comments = findings.filter(f => f.path && f.line).map(f => ({path: f.path, line: Number(f.line), side: 'RIGHT', body: `${ICON[f.severity] || '⚪'} **${f.severity}**: ${f.title || ''}\n\n${f.body || ''}`.trim()}));
  return {event, body: lines.join('\n'), comments};
}

/** Posts the review, falling back twice: GitHub refuses an APPROVE from Actions when the repository setting is off (-> a COMMENT with the same verdict), and refuses the whole review when an inline line is outside
 * the diff (-> the same review without inline comments, its body already lists every finding). `post(payload)` throws on a refusal. -> what was posted: {event, inline}. */
export function submitReview(payload, post) {
  const attempts = [payload, {...payload, event: payload.event === 'APPROVE' ? 'COMMENT' : payload.event}, {...payload, event: payload.event === 'APPROVE' ? 'COMMENT' : payload.event, comments: []}];
  let last;
  for (const a of attempts) {
    try { post(a); return {event: a.event, inline: a.comments.length}; } catch (error) { last = error; }
  }
  throw last;
}

/** Tokens, turns and time of the run from the action's execution file (an array of Claude Code messages; the last "result" message), as one summary line; '' when unreadable. */
export function usageLine(messages) {
  const result = [...(Array.isArray(messages) ? messages : [])].reverse().find(m => m?.type === 'result');
  if (!result) return '';
  const u = result.usage || {};
  return `Claude review run: ${result.num_turns ?? '?'} turns, ${Math.round((result.duration_ms || 0) / 1000)} s, ${u.input_tokens ?? '?'} input + ${u.cache_read_input_tokens ?? 0} cached + ${u.output_tokens ?? '?'} output tokens`;
}

// ---- the gate and the post: gh and files; the decisions above are pure ----
const PR_QUERY = `query($owner: String!, $name: String!, $pr: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $pr) {
  number state isDraft title headRefOid baseRefName baseRefOid headRepository { nameWithOwner }
  commits(last: 1) { nodes { commit { status { context(name: "${CHECK}") { state } } } } }
  reviews(last: 30) { nodes { author { login } submittedAt body } }
  comments(last: 30) { nodes { body } }
  labels(first: 50) { nodes { name } }
} } }`;
const CAP_QUERY = `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { pullRequests(first: 100, orderBy: {field: UPDATED_AT, direction: DESC}) { nodes { reviews(last: 10) { nodes { author { login } submittedAt body } } } } } }`;
const graphql = (query, vars, run = gh) => JSON.parse(run('api', 'graphql', '-f', `query=${query}`, ...Object.entries(vars).flatMap(([k, v]) => ['-F', `${k}=${v}`]))).data.repository;

/** Reads the PR for decide() and the label: -> {pr: {…, labels}, reviews, comments}. */
export function readPr(repo, number, run = gh) {
  const [owner, name] = repo.split('/');
  const p = graphql(PR_QUERY, {owner, name, pr: number}, run).pullRequest;
  return {pr: {number: p.number, state: p.state, isDraft: p.isDraft, title: p.title, head: p.headRefOid, base: p.baseRefName, headRepo: p.headRepository?.nameWithOwner || '',
    status: p.commits.nodes[0]?.commit?.status?.context?.state || '', labels: p.labels.nodes.map(l => l.name)}, reviews: ourReviews(p.reviews.nodes), comments: p.comments.nodes.filter(Boolean).map(c => c.body)};
}

/** The reviews of ours submitted today across the 100 most recently updated PRs. */
export function readToday(repo, now = Date.now(), run = gh) {
  const [owner, name] = repo.split('/');
  return reviewsToday(graphql(CAP_QUERY, {owner, name}, run).pullRequests.nodes, now);
}

const out = (key, value) => {
  const text = String(value);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, text.includes('\n') ? `${key}<<CR_EOF\n${text}\nCR_EOF\n` : `${key}=${text}\n`);
  console.log(`claude-review: ${key}=${text.split('\n')[0]}`);
};
const summary = text => { if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + '\n'); console.log(text); };

/** The repository's own review rules: every `*.md` in `dir` (the base branch's `.gitar/review/`), one section per file, '' when there is none. */
export function rulesFrom(dir) {
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort(); } catch { /* a repository without the folder reviews by the base prompt alone */ }
  return files.map(f => `#### ${f}\n\n${fs.readFileSync(path.join(dir, f), 'utf8').trim()}`).join('\n\n');
}

/** Builds the prompt from tools/claude-review-prompt.md, the facts of this review and the repository's rules. */
export function promptFor({number, head, base, from, prior, rules = ''}, template) {
  const range = from ? `\`git diff ${from} ${head}\` (only what changed since the last reviewed head ${from.slice(0, 7)})` : `\`git diff origin/${base}...${head}\` (the whole PR)`;
  const previous = prior.length ? prior.map(f => `- ${f.severity} ${f.path || ''}${f.line ? ':' + f.line : ''} ${f.title || ''}`).join('\n') : 'none';
  return template.replace('{{pr}}', () => number).replace('{{head}}', () => head).replace('{{range}}', () => range).replace('{{prior}}', () => previous).replace('{{rules}}', () => rules || '(this repository has no `.gitar/review/` rules: review by CLAUDE.md and AGENTS.md)');
}

function gate(env = process.env, run = gh) {
  const repo = env.GITHUB_REPOSITORY, manual = env.MODE === 'manual', number = env.PR;
  // Why (13 Nov 2026, cr): fail closed: an ask is the owner's or a member's, or a dispatcher's (who has write access); anything else, including an empty value, is refused.
  if (manual && !['OWNER', 'MEMBER', 'DISPATCH'].includes(env.ASKED_BY)) { out('go', 'false'); return summary('Claude review skipped: only the repository owner or a member can ask for it.'); }
  const {pr, reviews, comments} = readPr(repo, number, run);
  const cap = Number(env.CLAUDE_REVIEW_DAILY_CAP) > 0 ? Number(env.CLAUDE_REVIEW_DAILY_CAP) : CAP_DEFAULT;
  const today = readToday(repo, Date.now(), run);
  const verdict = decide({pr, repo, manual, wantedSha: env.SHA || '', reviews, today, cap});
  out('go', verdict.go);
  out('reason', verdict.reason);
  if (!verdict.go) {
    summary(`Claude review of #${number}: not run: ${verdict.reason === 'cap' ? `the daily cap of ${cap} reviews is reached` : verdict.reason}.`);
    const mark = `<!-- claude-review-cap ${new Date().toISOString().slice(0, 10)} -->`;
    if (verdict.reason === 'cap' && !comments.some(c => (c || '').includes(mark))) run('pr', 'comment', String(number), '-R', repo, '--body', `Claude review cap reached today (${cap} reviews); no review of this head.\n\n${mark}`);
    return;
  }
  const last = [...reviews].reverse().find(r => r.sha !== pr.head);
  const status = last ? JSON.parse(run('api', `repos/${repo}/compare/${last.sha}...${pr.head}`)).status : '';
  const from = diffBase(last?.sha, status);
  const template = fs.readFileSync(fileURLToPath(new URL('./claude-review-prompt.md', import.meta.url)), 'utf8');
  out('pr', number); out('head', pr.head); out('base', pr.base); out('from', from);
  out('prompt', promptFor({number, head: pr.head, base: pr.base, from, prior: last?.findings || [], rules: rulesFrom('.gitar/review')}, template));
  summary(`Claude review of #${number} on ${pr.head.slice(0, 7)}: ${verdict.reason}; review ${today + 1} of ${cap} today${from ? `; diff since ${from.slice(0, 7)}` : ''}.`);
}

function post(env = process.env, run = gh) {
  const repo = env.GITHUB_REPOSITORY, number = env.PR, head = env.HEAD;
  let result;
  try { result = JSON.parse(env.STRUCTURED || ''); } catch { throw new Error('claude-review: the run returned no structured review (its output is not JSON)'); }
  const live = JSON.parse(run('api', `repos/${repo}/pulls/${number}`)).head.sha;
  if (live !== head) return summary(`Claude review of #${number}: not posted, the head moved from ${head.slice(0, 7)} to ${live.slice(0, 7)} while it ran.`);
  const payload = reviewPayload(result, head, {from: env.FROM || ''});
  const file = path.join(os.tmpdir(), `claude-review-${process.pid}.json`);
  const posted = submitReview(payload, p => { fs.writeFileSync(file, JSON.stringify({commit_id: head, ...p})); run('api', '-X', 'POST', `repos/${repo}/pulls/${number}/reviews`, '--input', file); });
  summary(`Claude review of #${number} posted on ${head.slice(0, 7)}: ${posted.event}, ${posted.inline} inline comment(s), ${(result.findings || []).length} finding(s).`);
  try { const line = usageLine(JSON.parse(fs.readFileSync(env.EXECUTION_FILE, 'utf8'))); if (line) summary(line); } catch { /* no execution file: no usage line */ }
}

/** After a failed Review step: a plan limit is a green job with one clear line and ONE note on the PR per head (the review is skipped, nothing is blocked, the owner sees why); any other failure stays red. */
export function failed(env = process.env, run = gh) {
  let messages = [];
  try { messages = JSON.parse(fs.readFileSync(env.EXECUTION_FILE, 'utf8')); } catch { /* no execution file: nothing says it was a plan limit */ }
  if (!planLimitHit(finalError(messages))) throw new Error('claude-review: the Review step failed (not a plan limit): see its log');
  summary(`Claude review of #${env.PR} skipped: the Claude plan limit is reached (it resets by itself); no review of this head, nothing is blocked.`);
  const mark = `<!-- claude-review-skipped sha=${env.HEAD} -->`;
  if (!env.HEAD || !env.GITHUB_REPOSITORY) return;
  if (readPr(env.GITHUB_REPOSITORY, env.PR, run).comments.some(c => (c || '').includes(mark))) return;
  run('pr', 'comment', String(env.PR), '-R', env.GITHUB_REPOSITORY, '--body', `Claude review skipped on \`${env.HEAD.slice(0, 7)}\`: the Claude plan limit is reached; it resets by itself. Comment "@claude review" later to review this head.\n\n${mark}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === 'gate') gate();
    else if (process.argv[2] === 'post') post();
    else if (process.argv[2] === 'failed') failed();
    else throw new Error('usage: claude-review.mjs gate | post | failed');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
