#!/usr/bin/env node
// Sets the one "Gitar: …" label on a PR from Gitar's verdict, so the PR list shows red / yellow / green without opening the PR.
// Why (owner, 28 Oct 2026): "how can I know from this view if the PR has PR comments, or change requested, or not yet approved? … red 'gitar requested changes', or 'approved with suggestions', or green 'fully approved'".
// Why (28 Oct 2026; measured again 30 Oct 2026): a head often gets no Gitar review (9 of 60 PRs: an unchanged verdict after a push is only a new comment), so only the
// verdict line of its own comment says approved; a verdict older than the head commit is stale and gets no label.
// Design (7 Nov 2026, gl; owner: "One state, one owner: the label = what Gitar's latest comment says"; 5 fixes in 8 days: 018e8727, bfab72ed, #3091, #3143, #3191, then this):
//   States: changes requested | approved with suggestions | approved | reviewing (no verdict yet, Gitar has a check on the head) | not started (no verdict, no Gitar check: 11 Nov 2026), plus the gray "working" mark a session sets.
//   Owner: syncOnce() below, a pure function of Gitar's newest "Code Review" comment, the head's push time and the PR's labels. Nothing else decides a label.
//   Moments that run it: a push, open or reopen of the PR, Gitar's review or new comment, EVERY push to main (all open PRs), and the Worker's ten-minute tick (all open PRs;
//   app-core/src/scheduler.js). Gitar closes a finding by only EDITING its comment, which starts nothing, so the tick is what bounds the label's age: at most ten minutes stale.
//   Gone with it: the check_run trigger and its PR lookup, and the wait for Gitar's comment to catch up with its review (up to 2 minutes of re-reads, then a red run): a read that is
//   a few seconds early is corrected by the next moment. Reads are one GraphQL call per PR; a label is written only when it differs (#2516: 151 runs an hour once spent the REST budget).
// Usage (workflow .github/workflows/pr-labels.yml): node tools/gitar-label.mjs <pr-number> | all
//   node tools/gitar-label.mjs working <pr-number>   a session says it has started handling the comments. Needs GH_TOKEN and GITHUB_REPOSITORY. No test file: a tool of our own, checked by running it (owner, 3 Nov 2026; #3078).
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const LABELS = {
  changes: {name: 'Gitar: changes requested', color: 'd73a4a', description: 'Gitar blocks this PR until its findings are fixed'},
  suggestions: {name: 'Gitar: approved with suggestions', color: 'fbca04', description: 'Gitar approved; a minor finding is still open'},
  approved: {name: 'Gitar: approved', color: '0e8a16', description: 'Gitar fully approved the current head'},
};
// Gray, our side of the conversation (owner, 28 Oct 2026: "when we acknowledged and working on the feedback, a secondary label, a gray one"; "what's the latest status from Gitar and what's our current action").
export const WAITING = {name: 'Gitar: reviewing', color: '9ca3af', description: 'Gitar is reviewing the newest push; a verdict label beside this one is for an older push'};
// Why (11 Nov 2026, owner: "the gh labels are not representing the Gitar review state"; #3779, #3781, #3780 read "reviewing" for 7+ min while Gitar had not started: it reviews a PR when it opens, not a push to an open PR): "reviewing" is true only while Gitar has a check RUN on the head (an empty check suite exists on every push, so it proves nothing); no run = not started. Both marks sit beside the latest verdict (owner, 11 Nov: "the label is not reflecting gitar").
export const NOT_STARTED = {name: 'Gitar: not started', color: 'f97316', description: 'Gitar has not started on the newest push; one "Gitar review" comment starts it'};
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
function headTime(repo, sha) {
  const committed = JSON.parse(gh('api', `repos/${repo}/commits/${sha}`)).commit.committer.date;
  const suites = JSON.parse(gh('api', `repos/${repo}/commits/${sha}/check-suites`)).check_suites.map(c => c.created_at);
  return [committed, suites.sort()[0]].filter(Boolean).sort().at(-1);   // the first suite created for the head
}

/** True when Gitar has a check RUN on the head (REST path). Why (11 Nov 2026, owner: "why the label is not right?"): GitHub queues an empty check SUITE for every installed app on each push, so a Gitar suite exists even when Gitar never starts; only a run proves it started. Read from the suites (one per app, so no 100-run cap) and match the app slug only, as the GraphQL read does (Gitar, #3790). */
export function gitarOnHead(repo, sha, run = gh) {
  return JSON.parse(run('api', `repos/${repo}/commits/${sha}/check-suites?per_page=100`)).check_suites.some(c => /gitar/i.test(c.app?.slug || '') && (c.latest_check_runs_count ?? 0) > 0);
}

/** The labels a PR should hold: Gitar's current verdict or "reviewing" when it has none for this head; "working" (when since, its time) stays only if it was set after the head's push and Gitar has not approved: a push or a later approval ends it (owner, 28 Oct 2026: "if the PR is approved on a subsequent commit, we should clear this gray label"). Why (#2386, Gitar): judged from times, not from the push event, which a Gitar comment run could cancel. */
export function wantedLabels({verdict, latest = null, workingSince, headTime, verdictTime, gitarOnHead = true}) {
  // Why (11 Nov 2026, owner: "the label is not reflecting gitar"; 7 Nov: "the label = what Gitar's latest comment says"): a verdict older than the head still shows, beside a second label saying the newest push has no review yet (gray: Gitar has a check on it, orange: it has none). READY reads the pair, so a stale approval never reads as ready.
  const names = verdict ? [verdict] : [...(latest ? [latest] : []), gitarOnHead ? WAITING.name : NOT_STARTED.name];
  if (workingSince && Date.parse(workingSince) >= Date.parse(headTime) && ((verdict ?? latest) !== LABELS.approved.name || Date.parse(workingSince) > Date.parse(verdictTime))) names.push(WORKING.name);
  return names;
}

const ALL = [...Object.values(LABELS), WAITING, NOT_STARTED, WORKING];
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

const PR_QUERY = `query($owner: String!, $name: String!, $pr: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $pr) {
  state headRefOid
  comments(last: 100) { pageInfo { hasPreviousPage } nodes { author { login } body updatedAt } }
  labels(first: 30) { nodes { name } }
  timelineItems(last: 30, itemTypes: [LABELED_EVENT]) { nodes { ... on LabeledEvent { createdAt label { name } } } }
  commits(last: 1) { nodes { commit { committedDate checkSuites(first: 20) { nodes { createdAt app { slug } checkRuns(first: 1) { totalCount } } } } } }
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
    headTime: [commit.committedDate, suites.map(c => c.createdAt).sort()[0]].filter(Boolean).sort().at(-1),
    review: latest ? {body: latest.body, updated_at: latest.updatedAt} : null,
    labels,
    workingSince: workedAt,
    gitarOnHead: suites.some(c => /gitar/i.test(c.app?.slug || '') && (c.checkRuns?.totalCount ?? 0) > 0),
  };
}

/** One GraphQL call for everything a label run reads; null when the thread is too long for it. `run` is the gh call (a test passes a fake). */
export function readPr(repo, pr, run = gh) {
  const [owner, name] = repo.split('/');
  return fromGraphql(JSON.parse(run('api', 'graphql', '-f', `query=${PR_QUERY}`, '-f', `owner=${owner}`, '-f', `name=${name}`, '-F', `pr=${pr}`)).data);
}

/** The same read page by page over REST: for a thread whose Gitar comment is older than the 100 newest. */
function readPrByRest(repo, pr, info) {
  const reviews = pages(`repos/${repo}/issues/${pr}/comments`).filter(c => c.user.login === 'gitar-bot[bot]' && /Code Review/.test(c.body));
  const latest = reviews.sort((a, b) => Date.parse(a.updated_at) - Date.parse(b.updated_at)).at(-1);
  const labels = pages(`repos/${repo}/issues/${pr}/labels`).map(l => l.name);
  const workingSince = labels.includes(WORKING.name) ? pages(`repos/${repo}/issues/${pr}/events`).filter(e => e.event === 'labeled' && e.label.name === WORKING.name).map(e => e.created_at).sort().at(-1) : null;
  return {state: info.state, headTime: headTime(repo, info.head.sha), gitarOnHead: gitarOnHead(repo, info.head.sha), review: latest ? {body: latest.body, updated_at: latest.updated_at} : null, labels, workingSince, viaRest: true};
}

const readLive = (repo, pr) => readPr(repo, pr) || readPrByRest(repo, pr, JSON.parse(gh('api', `repos/${repo}/pulls/${pr}`)));

/** One read of the verdict, head and labels, then the writes it needs; -> true when it changed a label. */
function syncOnce(pr) {
  const repo = process.env.GITHUB_REPOSITORY;
  const read = readLive(repo, pr);
  if (read.state !== 'open') { console.log(`gitar-label: #${pr} is ${read.state}, left as it is`); return false; }
  const verdict = read.review ? wantedLabel(read.review.body, read.review.updated_at, read.headTime) : null;
  const kind = read.review ? verdictKind(read.review.body) : null;
  const wanted = wantedLabels({verdict, latest: kind ? LABELS[kind].name : null, workingSince: read.workingSince, headTime: read.headTime, verdictTime: read.review?.updated_at, gitarOnHead: read.gitarOnHead});
  const changed = setLabels(repo, pr, wanted, read.labels);
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
    // Why (7 Nov 2026, gl, code review): jobadabra-web and -lab run this script from main with their own copy of the workflow, which still starts on a Gitar check and passes no PR number until their copy is synced to templates/org-repo/pr-labels.yml; that must not turn each of their Gitar checks red. TODO(AI): make an empty argument an error again once both repos carry the synced workflow (14 Nov 2026)
    if (!process.argv[2]) return console.log('gitar-label: no PR number given (an event that no longer labels), nothing to do');
    main(process.argv[2]);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) cli();
