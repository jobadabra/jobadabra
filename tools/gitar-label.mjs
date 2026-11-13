#!/usr/bin/env node
// Sets the one "Gitar: …" label on a PR from Gitar's verdict, so the PR list shows red / yellow / green without opening the PR.
// Why (owner, 28 Oct 2026): "how can I know from this view if the PR has PR comments, or change requested, or not yet approved? … red 'gitar requested changes', or 'approved with suggestions', or green 'fully approved'".
// Why (28 Oct 2026; measured again 30 Oct 2026): a head often gets no Gitar review (9 of 60 PRs: an unchanged verdict after a push is only a new comment), so only the
// verdict line of its own comment says approved; a verdict older than the head commit is stale and gets no label.
// Design (7 Nov 2026, gl; owner: "One state, one owner: the label = what Gitar's latest comment says"; 5 fixes in 8 days: 018e8727, bfab72ed, #3091, #3143, #3191, then this):
//   States: changes requested | approved with suggestions | approved | reviewing (no verdict yet, Gitar has a check on the head) | not started (no verdict, no Gitar check: 11 Nov 2026) | changes requested · not re-reviewed (the
//   same as "not started" when Gitar's last verdict, on an older push, was red: 13 Nov 2026), plus the gray "working" mark a session sets.
//   A head that only merged the base branch in, own diff byte-identical, keeps the verdict of the change before it (12 Nov 2026, owner: "Keep the verdict (Recommended)"; ownHeadTime()).
//   One label per push (12 Nov 2026, owner, asked via AskUserQuestion: "One label per push (Recommended)"; 4th fix in 7 days after #3785, #3790, #3822): the PR holds ONE Gitar label, about the newest push.
//   A verdict older than the head is dropped, never shown beside a second mark. "reviewing" starts the moment someone asks ("Gitar review" comment newer than the head and than the verdict, under
//   ASK_FRESH_MS old, not refused by Gitar's "wait about N minutes" reply) or Gitar has a check run on the head; it ends at the verdict. Pure owner: wantedLabels().
//   Owner: syncOnce() below, a pure function of Gitar's newest "Code Review" comment, the head's push time and the PR's labels. Nothing else decides a label.
//   Moments that run it (the table is in .github/workflows/pr-labels-shared.yml, the one workflow every repo of the org calls; owner, 13 Nov 2026: "One shared workflow"): a push, open or reopen of
//   the PR, Gitar's review or new comment, Gitar's check starting or ending (`head <sha>`: Gitar closes a finding or approves by only EDITING its comment, which starts no event, and its check ends
//   0-2 s after that edit), EVERY push to main (all open PRs), and jobadabra's ten-minute tick (app-core/src/scheduler.js), now only a safety net.
//   Gone with it: the wait for Gitar's comment to catch up with its review (up to 2 minutes of re-reads, then a red run): a read that is a few seconds early is corrected by the next moment.
//   Reads are one GraphQL call per PR; a label is written only when it differs (#2516: 151 runs an hour once spent the REST budget).
// Usage (shared workflow .github/workflows/pr-labels-shared.yml): node tools/gitar-label.mjs <pr-number> | all | head <sha>
//   node tools/gitar-label.mjs working <pr-number>   a session says it has started handling the comments. Needs GH_TOKEN and GITHUB_REPOSITORY. No test file: a tool of our own, checked by running it (owner, 3 Nov 2026; #3078).
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const LABELS = {
  changes: {name: 'Gitar: changes requested', color: 'd73a4a', description: 'Gitar blocks this PR until its findings are fixed'},
  suggestions: {name: 'Gitar: approved with suggestions', color: 'fbca04', description: 'Gitar approved; a minor finding is still open'},
  approved: {name: 'Gitar: approved', color: '0e8a16', description: 'Gitar fully approved the current head'},
};
// Gray, our side of the conversation (owner, 28 Oct 2026: "when we acknowledged and working on the feedback, a secondary label, a gray one"; "what's the latest status from Gitar and what's our current action").
export const WAITING = {name: 'Gitar: reviewing', color: '9ca3af', description: 'Gitar was asked to review the newest push, or its check runs on it; no verdict yet'};
// Why (11 Nov 2026, owner: "the gh labels are not representing the Gitar review state"; #3779, #3781, #3780 read "reviewing" for 7+ min while Gitar had not started: it reviews a PR when it opens, not a push to an open PR): "reviewing" is true only while Gitar has a check RUN on the head (an empty check suite exists on every push, so it proves nothing); no run = not started. Both marks sit beside the latest verdict (owner, 11 Nov: "the label is not reflecting gitar").
export const NOT_STARTED = {name: 'Gitar: not started', color: 'f97316', description: 'Gitar has not started on the newest push; one "Gitar review" comment starts it'};
// Why (13 Nov 2026, owner, asked via AskUserQuestion: "Keep red visible (Recommended)"; web #635: after the fix push the label read "not started" and hid the red verdict he was reading; Gitar had locked the PR for 20 min after the session's thread replies, so no re-review could be asked): a red verdict of an older push stays visible until Gitar judges the new one. Only red: an old approval never stays green (28 Oct 2026).
export const CHANGES_OLD = {name: 'Gitar: changes requested · not re-reviewed', color: 'd73a4a', description: 'Gitar asked for changes on an earlier push; the newest push has no review yet'};
export const WORKING = {name: 'Working on PR comments', color: '6b7280', description: 'A session is applying the review feedback; a push clears it'};

/** The verdict kind in Gitar's comment body, or null when it holds no verdict line (e.g. a review in progress). Order matters: "Approved with suggestions" contains "Approved". */
export function verdictKind(body) {
  const line = /<summary><b>Code Review<\/b>\s*<kbd>([^<]*)<\/kbd>/.exec(body || '');
  if (!line) return null;
  const text = line[1];
  if (/changes requested/i.test(text)) return 'changes';
  if (/approved with suggestions/i.test(text)) return 'suggestions';
  if (/approved/i.test(text)) return 'approved';
  return 'changes';   // Why (28 Oct 2026): an unknown Code Review state is not an approval; red is the safe side
}

/** The label name to hold: Gitar's verdict if its comment was written at or after the head commit, else null (a stale approval never stays green). */
export function wantedLabel(body, commentUpdatedAt, headCommittedAt) {
  const kind = verdictKind(body);
  if (!kind || !(Date.parse(commentUpdatedAt) >= Date.parse(headCommittedAt))) return null;
  return LABELS[kind].name;
}

// Why (3 Nov 2026, owner chose "One retry on GitHub errors"): every gh call goes through tools/gh_retry.py, shared with the release checks: GitHub's own
// 502/503/504 gets one more try after ~10 s; a second failure and any other error still throw, so a failure stays red (#2516).
const GH_RETRY = fileURLToPath(new URL('./gh_retry.py', import.meta.url));
const gh = (...args) => execFileSync('python3', [GH_RETRY, ...args], {encoding: 'utf8'});
const pages = path => JSON.parse(gh('api', path, '--paginate', '--slurp')).flat();

/** When the head became the head: the later of its commit date and the first check suite created for it (a commit made at 10:00 and pushed at 11:00 counts as 11:00; Why (#2386, 28 Oct 2026): Gitar flagged commit date as push time). */
function headTime(repo, sha, run = gh) {
  const committed = JSON.parse(run('api', `repos/${repo}/commits/${sha}`)).commit.committer.date;
  const suites = JSON.parse(run('api', `repos/${repo}/commits/${sha}/check-suites`)).check_suites.map(c => c.created_at);
  return [committed, suites.sort()[0]].filter(Boolean).sort().at(-1);   // the first suite created for the head
}

/** True when Gitar has a check RUN on the head (REST path). Why (11 Nov 2026, owner: "why the label is not right?"): GitHub queues an empty check SUITE for every installed app on each push, so a Gitar suite exists even when Gitar never starts; only a run proves it started. Read from the suites (one per app, so no 100-run cap) and match the app slug only, as the GraphQL read does (Gitar, #3790). */
export function gitarOnHead(repo, sha, run = gh) {
  return JSON.parse(run('api', `repos/${repo}/commits/${sha}/check-suites?per_page=100`)).check_suites.some(c => /gitar/i.test(c.app?.slug || '') && (c.latest_check_runs_count ?? 0) > 0);
}

/** True when two GitHub compare file lists hold the same own change: the same files, each with the same status and the same added and removed lines, byte for byte
 * (blob sha when GitHub sends no patch). Line numbers and context lines are left out: #3886's merge of main moved found_boards.py's hunks by one line and nothing else. */
export function sameOwnChange(before, after) {
  const own = patch => patch.split('\n').filter(l => /^[+-]/.test(l) && !/^(\+\+\+|---) /.test(l)).join('\n');
  const key = f => `${f.filename}\0${f.status}\0${f.patch == null ? f.sha : own(f.patch)}`;
  const a = before.map(key).sort(), b = after.map(key).sort();
  return a.length === b.length && a.every((k, i) => k === b[i]);
}

// Why (12 Nov 2026, owner, asked via AskUserQuestion: "Keep the verdict (Recommended)"; #3886 approved at 13:05, merged main at 13:10, read "not started", Gitar refused the
//   re-ask for 30 min): a head that only merged the base branch in, the PR's own diff byte-identical, is not a new change to review. Up to 3 such merges are walked back.
const COMPARE_CAP = 300;   // GitHub's compare lists at most 300 files: a list that long may be cut, so it never counts as the same change
/** The push time of the PR's own change when the head (`{sha, parents}`) only merged `base` in, else null (the head's own time counts). Own diff before: compare
 * theirs...mine (from their merge base to the branch's previous tip); after: theirs...head (from the merged base commit to the head). */
export function ownHeadTime(repo, head, base, run = gh) {
  let sha = head.sha, parents = head.parents;
  for (let i = 0; i < 3 && parents?.length === 2; i++) {
    const [mine, theirs] = parents;
    if (!['behind', 'identical'].includes(JSON.parse(run('api', `repos/${repo}/compare/${base}...${theirs}`)).status)) break;   // theirs is not in the base branch
    const files = to => JSON.parse(run('api', `repos/${repo}/compare/${theirs}...${to}`)).files || [];
    const before = files(mine), after = files(sha);
    if (before.length >= COMPARE_CAP || !sameOwnChange(before, after)) break;
    sha = mine; parents = JSON.parse(run('api', `repos/${repo}/commits/${mine}`)).parents.map(p => p.sha);
  }
  return sha === head.sha ? null : headTime(repo, sha, run);
}

// Why (12 Nov 2026, #3870 and #3859): a "Gitar review" ask is answered in ~1 min; past 15 min with no verdict and no Gitar run it was lost, so the label says "not started" and the watcher may ask again.
export const ASK_FRESH_MS = 15 * 60 * 1000;
const ASK = /^\s*gitar review\b/i;
const REFUSED = /wait about \d+ minutes/i;   // Gitar's rate-limit reply: the ask before it starts nothing

/** When someone last asked Gitar to review ("Gitar review" comment), or null when there is no ask or Gitar refused it with a later "wait about N minutes". `comments`: {login, body, createdAt}. */
export function askedAt(comments) {
  const at = c => Date.parse(c.createdAt);
  const ask = comments.filter(c => !/^gitar-bot/.test(c.login) && ASK.test(c.body || '')).sort((a, b) => at(a) - at(b)).at(-1);
  if (!ask) return null;
  return comments.some(c => /^gitar-bot/.test(c.login) && REFUSED.test(c.body || '') && at(c) > at(ask)) ? null : ask.createdAt;
}

/** The labels a PR should hold: ONE Gitar label for the newest push, then "working" when it applies; "working" (when since, its time) stays only if it was set after the head's push and Gitar has not approved: a push or a later approval ends it (owner, 28 Oct 2026: "if the PR is approved on a subsequent commit, we should clear this gray label"). Why (#2386, Gitar): judged from times, not from the push event, which a Gitar comment run could cancel. */
export function wantedLabels({verdict, staleKind = null, workingSince, headTime, verdictTime, gitarOnHead = true, asked = null, now = Date.now()}) {
  const t = Date.parse;
  const askPending = !!asked && t(asked) >= t(headTime) && !(t(verdictTime) >= t(asked)) && now - t(asked) < ASK_FRESH_MS;
  const names = [askPending ? WAITING.name : verdict || (gitarOnHead ? WAITING.name : staleKind === 'changes' ? CHANGES_OLD.name : NOT_STARTED.name)];
  if (workingSince && t(workingSince) >= t(headTime) && (verdict !== LABELS.approved.name || t(workingSince) > t(verdictTime))) names.push(WORKING.name);
  return names;
}

const ALL = [...Object.values(LABELS), WAITING, NOT_STARTED, CHANGES_OLD, WORKING];
const ensure = (repo, l, run = gh) => run('label', 'create', l.name, '--color', l.color, '--description', l.description, '--force', '-R', repo);

/** Adds one label; creates it (a REST call) only when GitHub says the repo has no such label yet, then adds it again.
 * Why (30 Oct 2026, #2516): the create ran before every add and was the REST call that met the exhausted budget; the labels exist after their first use. */
export function addLabel(repo, pr, l, run = gh) {
  const add = () => run('pr', 'edit', String(pr), '--add-label', l.name, '-R', repo);
  try { add(); } catch (error) {
    // Why (30 Oct 2026, run 40981811862 red on #2529): gh says "'<name>' not found" for a label the repo lacks; the guessed "could not add label: …" never
    // matched, so the label was never created. The label's own name keeps a missing PR (another message) from starting a create.
    if (!String(error.message).includes(`'${l.name}' not found`)) throw error;
    ensure(repo, l, run);
    add();
  }
}

/** Adds and removes labels until the PR holds exactly `wanted`; -> how many it changed. `run` is the gh call (a test passes a fake). */
export function setLabels(repo, pr, wanted, have, run = gh) {
  let changed = 0;
  for (const l of ALL) {
    if (wanted.includes(l.name) && !have.includes(l.name)) { addLabel(repo, pr, l, run); changed++; }
    else if (!wanted.includes(l.name) && have.includes(l.name)) { run('pr', 'edit', String(pr), '--remove-label', l.name, '-R', repo); changed++; }
  }
  return changed;
}

/** Runs `once` until a fresh read wants no change (at most `max` rounds); -> the rounds run.
 * Why (#2404, Gitar): label runs overlap since no run is cancelled; a run that read a stale verdict and wrote last would leave a stale label. Re-reading
 * after each write makes the last run to finish write the current state. */
export function converge(once, max = 3) {
  let rounds = 0;
  while (rounds < max) { rounds++; if (!once()) break; }
  return rounds;
}

function main(pr) {
  converge(() => syncOnce(pr));
}

/** The open PRs whose head IS `sha` (one REST call, up to 100 PRs a commit belongs to; a failed read stays a red run, as everywhere here, #2516). Why (13 Nov 2026, gl): a Gitar check names its commit; its payload's own PR list is empty on most checks (3 of 40, 5 Nov 2026). */
export function prsOfHead(repo, sha, run = gh) {
  return JSON.parse(run('api', `repos/${repo}/commits/${sha}/pulls?per_page=100`)).filter(p => p.state === 'open' && p.head?.sha === sha).map(p => p.number);
}

/** Labels the PRs a Gitar check ran on; -> their numbers. The label follows the verdict the moment Gitar's check ends, even when the verdict only edited its comment (owner, 13 Nov 2026: jobadabra-benchmarks #38). */
export function syncHead(repo, sha, run = gh) {
  const prs = prsOfHead(repo, sha, run);
  for (const pr of prs) converge(() => syncOnce(pr, repo, run));
  return prs;
}

const PR_QUERY = `query($owner: String!, $name: String!, $pr: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $pr) {
  state headRefOid baseRefName
  comments(last: 100) { pageInfo { hasPreviousPage } nodes { author { login } body createdAt updatedAt } }
  labels(first: 30) { nodes { name } }
  timelineItems(last: 30, itemTypes: [LABELED_EVENT]) { nodes { ... on LabeledEvent { createdAt label { name } } } }
  commits(last: 1) { nodes { commit { committedDate parents(first: 2) { nodes { oid } } checkSuites(first: 20) { nodes { createdAt app { slug } checkRuns(first: 1) { totalCount } } } } } }
} } }`;

/** The PR's state, Gitar's newest Code Review comment, head time, labels and when "working" was set, from one GraphQL answer; null when Gitar's comment may sit
 * before the 100 newest comments (the caller then reads page by page). Why (29 Oct 2026, api-quota): six REST calls per label run, ~125 runs an hour, were over half
 * of Actions' 1,000-an-hour GITHUB_TOKEN quota; GraphQL is its own bucket and one call. Same head-time rule as headTime(): the later of commit date and first check suite. */
export function fromGraphql(data) {
  const pr = data.repository.pullRequest;
  const reviews = pr.comments.nodes.filter(c => c?.author?.login === 'gitar-bot' && /Code Review/.test(c.body));
  if (!reviews.length && pr.comments.pageInfo.hasPreviousPage) return null;
  const commit = pr.commits.nodes[0].commit;
  // Why (11 Nov 2026, #3817 run 43026926353): GitHub can answer a null node in a list (a suite or event this token may not see); one crashed the label run red. Every list here skips them.
  const suites = commit.checkSuites.nodes.filter(Boolean);
  const latest = reviews.sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt)).at(-1);
  const labels = pr.labels.nodes.filter(Boolean).map(l => l.name);
  const workedAt = labels.includes(WORKING.name) ? pr.timelineItems.nodes.filter(e => e?.label?.name === WORKING.name).map(e => e.createdAt).sort().at(-1) || null : null;   // only while the label is on the PR, as the REST read does (Gitar, #2445): a removed label must not come back
  return {
    state: pr.state.toLowerCase(),
    headSha: pr.headRefOid, base: pr.baseRefName, parents: (commit.parents?.nodes || []).filter(Boolean).map(p => p.oid),
    headTime: [commit.committedDate, suites.map(c => c.createdAt).sort()[0]].filter(Boolean).sort().at(-1),
    review: latest ? {body: latest.body, updated_at: latest.updatedAt} : null,
    labels,
    workingSince: workedAt,
    gitarOnHead: suites.some(c => /gitar/i.test(c.app?.slug || '') && (c.checkRuns?.totalCount ?? 0) > 0),
    asked: askedAt(pr.comments.nodes.filter(Boolean).map(c => ({login: c.author?.login || '', body: c.body, createdAt: c.createdAt}))),
  };
}

/** One GraphQL call for everything a label run reads; null when the thread is too long for it. `run` is the gh call (a test passes a fake). */
export function readPr(repo, pr, run = gh) {
  const [owner, name] = repo.split('/');
  return fromGraphql(JSON.parse(run('api', 'graphql', '-f', `query=${PR_QUERY}`, '-f', `owner=${owner}`, '-f', `name=${name}`, '-F', `pr=${pr}`)).data);
}

/** The same read page by page over REST: for a thread whose Gitar comment is older than the 100 newest. */
function readPrByRest(repo, pr, info) {
  const comments = pages(`repos/${repo}/issues/${pr}/comments`);
  const reviews = comments.filter(c => c.user.login === 'gitar-bot[bot]' && /Code Review/.test(c.body));
  const latest = reviews.sort((a, b) => Date.parse(a.updated_at) - Date.parse(b.updated_at)).at(-1);
  const labels = pages(`repos/${repo}/issues/${pr}/labels`).map(l => l.name);
  const workingSince = labels.includes(WORKING.name) ? pages(`repos/${repo}/issues/${pr}/events`).filter(e => e.event === 'labeled' && e.label.name === WORKING.name).map(e => e.created_at).sort().at(-1) : null;
  return {state: info.state, headSha: info.head.sha, base: info.base.ref, parents: JSON.parse(gh('api', `repos/${repo}/commits/${info.head.sha}`)).parents.map(p => p.sha), headTime: headTime(repo, info.head.sha), gitarOnHead: gitarOnHead(repo, info.head.sha), review: latest ? {body: latest.body, updated_at: latest.updated_at} : null, labels, workingSince, viaRest: true,
    asked: askedAt(comments.map(c => ({login: c.user.login, body: c.body, createdAt: c.created_at})))};
}

const readLive = (repo, pr, run = gh) => readPr(repo, pr, run) || readPrByRest(repo, pr, JSON.parse(gh('api', `repos/${repo}/pulls/${pr}`)));

/** The read and the labels the PR should hold; the head time is that of the PR's own change (ownHeadTime) when the head only merged the base branch in. */
function wantedFor(repo, pr, run = gh) {
  const read = readLive(repo, pr, run);
  if (read.state !== 'open') return {read, wanted: null};
  const at = (read.parents?.length === 2 && ownHeadTime(repo, {sha: read.headSha, parents: read.parents}, read.base, run)) || read.headTime;
  const verdict = read.review ? wantedLabel(read.review.body, read.review.updated_at, at) : null;
  const staleKind = read.review && !verdict ? verdictKind(read.review.body) : null;   // the verdict of an older push, kept in view only when red
  return {read, wanted: wantedLabels({verdict, staleKind, workingSince: read.workingSince, headTime: at, verdictTime: read.review?.updated_at, gitarOnHead: read.gitarOnHead, asked: read.asked})};
}

/** One read of the verdict, head and labels, then the writes it needs; -> true when it changed a label. */
function syncOnce(pr, repo = process.env.GITHUB_REPOSITORY, run = gh) {
  const {read, wanted} = wantedFor(repo, pr, run);
  if (!wanted) { console.log(`gitar-label: #${pr} is ${read.state}, left as it is`); return false; }
  const changed = setLabels(repo, pr, wanted, read.labels, run);
  console.log(`gitar-label: #${pr} → ${wanted.join(' + ')}`);
  return changed > 0;
}

function markWorking(pr) {
  const repo = process.env.GITHUB_REPOSITORY;
  const read = readLive(repo, pr);
  // Why (#2386, 29 Oct 2026): a current mark keeps its time; a stale mark is refreshed after a push.
  if (read.state !== 'open') return;
  const present = read.labels.includes(WORKING.name);
  if (present && read.workingSince && Date.parse(read.workingSince) >= Date.parse(read.headTime)) return;
  // Why (#2386, Gitar): a stale mark needs a new event time after the latest push.
  if (present) gh('pr', 'edit', String(pr), '--remove-label', WORKING.name, '-R', repo);
  addLabel(repo, pr, WORKING);
  main(pr); // Reconcile a push or verdict that arrived while marking work.
}

/** Every open PR, each read and labelled on its own: one that fails does not stop the others, and the run is red at the end (a failure stays visible, #2516). */
function syncAll() {
  const repo = process.env.GITHUB_REPOSITORY;
  const open = JSON.parse(gh('pr', 'list', '--state', 'open', '--limit', '100', '--json', 'number', '-R', repo)).map(pr => pr.number);
  console.log(`gitar-label: ${open.length} open PR(s)`);
  if (open.length === 100) console.log('::warning::gitar-label: 100 open PRs, the list stops there and older ones are not labelled');
  for (const pr of open) {
    try { main(pr); } catch (error) { console.error(`gitar-label: #${pr}: ${error.message}`); process.exitCode = 1; }
  }
}

/** A failure stays red, rate limit or not: a label left wrong in silence is what this design removes (#2516). */
function cli() {
  try {
    if (process.argv[2] === 'working') return markWorking(process.argv[3]);
    if (process.argv[2] === 'all') return syncAll();
    // head <sha>: the PRs a Gitar check ran on (the shared workflow's check_run event).
    if (process.argv[2] === 'head') return console.log(`gitar-label: head ${process.argv[3]} → ${syncHead(process.env.GITHUB_REPOSITORY, process.argv[3]).map(n => `#${n}`).join(' ') || 'no open PR'}`);
    // peek <n>: print the labels the PR should hold, write nothing (tools/ship-watch.sh asks Gitar only when no verdict counts on the head).
    if (process.argv[2] === 'peek') return console.log((wantedFor(process.env.GITHUB_REPOSITORY, process.argv[3]).wanted || []).join('\n'));
    // Why (7 Nov 2026, gl, code review): jobadabra-web, -lab and -benchmarks run this script from main with their own copy of the workflow, which still starts on a Gitar check and passes no PR number until their copy is the shared caller (templates/org-repo/pr-labels.yml); that must not turn each of their Gitar checks red. TODO(AI): make an empty argument an error again once all three callers have merged (13 Nov 2026)
    if (!process.argv[2]) return console.log('gitar-label: no PR number given (an event that no longer labels), nothing to do');
    main(process.argv[2]);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) cli();
