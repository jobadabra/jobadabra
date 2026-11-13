#!/usr/bin/env node
// Sets the one "Gitar: …" label on a PR from Gitar's verdict, so the PR list shows red / yellow / green without opening the PR.
// Why (owner, 28 Oct 2026): "how can I know from this view if the PR has PR comments, or change requested, or not yet approved? … red 'gitar requested changes', or 'approved with suggestions', or green 'fully approved'".
// Why (28 Oct 2026; measured again 30 Oct 2026): a head often gets no Gitar review (9 of 60 PRs: an unchanged verdict after a push is only a new comment), so only the
// verdict line of its own comment says approved; a verdict older than the head commit is stale and gets no label.
// Design (13 Nov 2026, gl4; owner, asked via AskUserQuestion: "Simplify to one signal (Recommended)": "the label reads only Gitar's check run on the head. Running = 'reviewing'; done = the verdict Gitar wrote
//   after that run started; no run = last verdict + '· not re-reviewed' (or 'not started'). This deletes the merge-walk, the ask-detection and its 15-minute timer instead of adding a case."). The symptom of
//   benchmarks #38 ("reviewing" beside ✅ Approved) came back on #4031 after 10 fix PRs in 10 days (#3191, #3513, #3785, #3790, #3822, #3873, #3890, #4020, #4025, #4032), each adding a second way to decide
//   "did Gitar look at this head": the head's run (reviewing), a walk to the commit before a merge of main (the verdict), a "Gitar review" comment and its timer (reviewing). Two of them disagreed on #4031.
//   One signal: Gitar's check run on the head commit: none | running | completed (startedAt). One owner: wantedLabels(), a pure function of that run, the verdict of Gitar's newest "Code Review" comment (its
//   kind and last edit) and the gray mark. States:
//     run running ......................................... Gitar: reviewing
//     run completed, verdict edited at or after its start .. <verdict> (changes requested | approved with suggestions | approved)
//     no run on the head, or a verdict older than the run .. <last verdict> · not re-reviewed (the same suffix for every verdict; owner, 13 Nov 2026: "Last verdict + not re-reviewed (Recommended)")
//     no verdict on any push ............................... Gitar: not started
//   A verdict edited AFTER the run completed (Gitar closing a finding when a session replies in a thread, on the same head) stays the head's verdict, shown plain: it is Gitar's judgement of a head it ran on,
//   so the label does not bound the edit by the run's end (Gitar on #4048 offered completedAt + a slack; that would call a genuine "finding closed, now approved" edit "not re-reviewed" and adds a case). The case the
//   owner saw (#4020) is the other one: an edit with NO run on the head.
//   plus the gray "Working on PR comments" mark a session sets (a push clears it; Gitar's approval of the head clears it) and the conflict label (tools/conflict-label.mjs).
//   Trade-off, said plainly: a merge of main into the branch is a new head, so with Gitar's automatic reviews paused it reads "<last verdict> · not re-reviewed" until Gitar runs on it (12 Nov's "keep the
//   verdict" for a merge of main is gone with the walk); sessions rebase instead of merging main in.
//   Moments that run it (the table is in .github/workflows/pr-labels-shared.yml, the one workflow every repo of the org calls; owner, 13 Nov 2026: "One shared workflow"): a push, open or reopen of
//   the PR, Gitar's review or new comment, Gitar's check starting or ending (`head <sha>`: Gitar closes a finding or approves by only EDITING its comment, which starts no event, and its check ends
//   0-2 s after that edit), EVERY push to main (all open PRs), and jobadabra's ten-minute tick (app-core/src/scheduler.js), now only a safety net.
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
export const WAITING = {name: 'Gitar: reviewing', color: '9ca3af', description: 'Gitar is reviewing the newest push: its check is running on it'};
// Why (11 Nov 2026, owner: "the gh labels are not representing the Gitar review state"; #3779, #3781, #3780 read "reviewing" for 7+ min while Gitar had not started: it reviews a PR when it opens, not a push to an open PR): "reviewing" is true only while Gitar's check RUN on the head is running (an empty check suite exists on every push, so it proves nothing; 13 Nov 2026, gl4: a run that has ended is no longer "reviewing"); no run = not reviewed: the last verdict with " · not re-reviewed", or "not started" when Gitar never gave one (13 Nov 2026, owner).
export const NOT_STARTED = {name: 'Gitar: not started', color: 'f97316', description: 'Gitar has given no verdict on this PR yet; one "Gitar review" comment starts it'};
// Why (13 Nov 2026, owner: "Last verdict + not re-reviewed (Recommended)"; web #635 red hidden by "not started", #4026 "approved with suggestions" hidden the same way; Gitar had locked those PRs after the sessions' thread replies, so no re-review could be asked): the last verdict stays visible, with this suffix, until Gitar judges the new push. It replaces 28 Oct's "an old approval never stays green": the suffix says the verdict is old.
export const NOT_RE_REVIEWED = ' · not re-reviewed';
// The same hue as the verdict, lighter, so the PR list still reads red / yellow / green (owner, 28 Oct 2026) and a glance tells current from old.
const LIGHTER = {changes: 'f0a1a8', suggestions: 'fde68a', approved: '86d98d'};
export const OLD_LABELS = Object.fromEntries(Object.entries(LABELS).map(([kind, l]) => [kind, {name: l.name + NOT_RE_REVIEWED, color: LIGHTER[kind], description: `${l.description.replace(/\.$/, '')}; on an earlier push, the newest has no review yet`}]));
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

// Why (3 Nov 2026, owner chose "One retry on GitHub errors"): every gh call goes through tools/gh_retry.py, shared with the release checks: GitHub's own
// 500/502/503/504 gets one more try after ~10 s; a second failure and any other error still throw, so a failure stays red (#2516).
const GH_RETRY = fileURLToPath(new URL('./gh_retry.py', import.meta.url));
const gh = (...args) => execFileSync('python3', [GH_RETRY, ...args], {encoding: 'utf8'});
const pages = path => JSON.parse(gh('api', path, '--paginate', '--slurp')).flat();

/** When the head became the head: the later of its commit date and the first check suite created for it (a commit made at 10:00 and pushed at 11:00 counts as 11:00; Why (#2386, 28 Oct 2026): Gitar flagged commit date as push time). */
function headTime(repo, sha, run = gh) {
  const committed = JSON.parse(run('api', `repos/${repo}/commits/${sha}`)).commit.committer.date;
  const suites = JSON.parse(run('api', `repos/${repo}/commits/${sha}/check-suites`)).check_suites.map(c => c.created_at);
  return [committed, suites.sort()[0]].filter(Boolean).sort().at(-1);   // the first suite created for the head
}

/** Gitar's newest check RUN on the head, `{running, startedAt}`, or null when it has none (REST path: the head's suites, Gitar's by app slug, then its runs). Why (11 Nov 2026, owner: "why the label is not
 * right?"): GitHub queues an empty check SUITE for every installed app on each push, so a Gitar suite exists even when Gitar never starts; only a run proves it started. Matched by the app slug only, as the
 * GraphQL read does (Gitar, #3790); read per suite, so a head with 90 other runs has no 100-run cap. */
export function gitarRunOnHead(repo, sha, run = gh) {
  const suites = JSON.parse(run('api', `repos/${repo}/commits/${sha}/check-suites?per_page=100`)).check_suites.filter(c => /gitar/i.test(c.app?.slug || '') && (c.latest_check_runs_count ?? 0) > 0);
  return newestRun(suites.flatMap(c => JSON.parse(run('api', `repos/${repo}/check-suites/${c.id}/check-runs`)).check_runs.map(r => ({status: r.status.toUpperCase(), startedAt: r.started_at}))));
}

/** The newest of Gitar's check runs on a head, `{running, startedAt}` (running = any run not completed; startedAt = the newest start), or null when there is none. */
export function newestRun(runs) {
  const some = runs.filter(Boolean);
  if (!some.length) return null;
  return {running: some.some(r => r.status !== 'COMPLETED'), startedAt: some.map(r => r.startedAt).filter(Boolean).sort().at(-1) || null};
}

/** The labels a PR should hold: ONE Gitar label for the newest push, then "working" when it applies. `kind`: the verdict of Gitar's newest Code Review comment (or null), `verdictTime` its last edit; `run`: Gitar's
 * check run on the head (`{running, startedAt}` or null). "working" (when since, its time) stays only if it was set after the head's push and Gitar has not approved the head: a push or a later approval ends it
 * (owner, 28 Oct 2026: "if the PR is approved on a subsequent commit, we should clear this gray label"). Why (#2386, Gitar): judged from times, not from the push event, which a Gitar comment run could cancel. */
export function wantedLabels({kind = null, verdictTime = null, run = null, workingSince = null, headTime}) {
  const t = Date.parse;
  const current = !!run && !run.running && !!kind && (run.startedAt == null || t(verdictTime) >= t(run.startedAt));   // the verdict Gitar wrote at or after the head's run started
  const names = [run?.running ? WAITING.name : current ? LABELS[kind].name : kind ? OLD_LABELS[kind].name : NOT_STARTED.name];
  if (workingSince && t(workingSince) >= t(headTime) && !(current && kind === 'approved' && t(verdictTime) >= t(workingSince))) names.push(WORKING.name);
  return names;
}

export const ALL = [...Object.values(LABELS), ...Object.values(OLD_LABELS), WAITING, NOT_STARTED, WORKING];
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
  state headRefOid
  comments(last: 100) { pageInfo { hasPreviousPage } nodes { author { login } body createdAt updatedAt } }
  labels(first: 30) { nodes { name } }
  timelineItems(last: 30, itemTypes: [LABELED_EVENT]) { nodes { ... on LabeledEvent { createdAt label { name } } } }
  commits(last: 1) { nodes { commit { committedDate checkSuites(first: 20) { nodes { createdAt app { slug } checkRuns(first: 20) { nodes { status startedAt } } } } } } }
} } }`;

/** The PR's state, Gitar's newest Code Review comment, Gitar's check run on the head, head time (for the gray mark), labels and when "working" was set, from one GraphQL answer; null when Gitar's comment may sit
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
    headSha: pr.headRefOid,
    headTime: [commit.committedDate, suites.map(c => c.createdAt).sort()[0]].filter(Boolean).sort().at(-1),
    review: latest ? {body: latest.body, updated_at: latest.updatedAt} : null,
    labels,
    workingSince: workedAt,
    run: newestRun(suites.filter(c => /gitar/i.test(c.app?.slug || '')).flatMap(c => c.checkRuns?.nodes || [])),
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
  return {state: info.state, headSha: info.head.sha, headTime: headTime(repo, info.head.sha), run: gitarRunOnHead(repo, info.head.sha), review: latest ? {body: latest.body, updated_at: latest.updated_at} : null, labels, workingSince, viaRest: true};
}

const readLive = (repo, pr, run = gh) => readPr(repo, pr, run) || readPrByRest(repo, pr, JSON.parse(gh('api', `repos/${repo}/pulls/${pr}`)));

/** The read and the labels the PR should hold (exported: the cases play it with a fake gh): from Gitar's check run on the head, the verdict of its newest comment and the gray mark; nothing else. */
export function wantedFor(repo, pr, run = gh) {
  const read = readLive(repo, pr, run);
  if (read.state !== 'open') return {read, wanted: null};
  const kind = read.review ? verdictKind(read.review.body) : null;
  return {read, wanted: wantedLabels({kind, verdictTime: read.review?.updated_at, run: read.run, workingSince: read.workingSince, headTime: read.headTime})};
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
    if (!process.argv[2]) throw new Error('gitar-label: no PR number given (usage: <pr-number> | all | head <sha> | working <pr> | peek <pr>)');
    main(process.argv[2]);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) cli();
