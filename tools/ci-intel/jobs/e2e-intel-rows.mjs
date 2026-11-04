// The pure part of the e2e collector (tools/ci-intel/jobs/e2e-intel.mjs does the I/O): which kind of run each workflow run is, which suite jobs were red on their first try,
// how long a job waited for a runner and how long it ran, and the cause of each red (tools/ci-intel/lib/e2e-causes.mjs) from facts, then the fix's trailer, then the AI.
// No network here: GitHub and the AI come in as functions. Guard: desktop/test/ci-intel-e2e-intel-collector.test.js.
import {cleanBetaRun} from '../lib/e2e-beta.mjs';
import {RATE_SUITES, ratesOf} from '../lib/e2e-rates.mjs';
import {causePrompt, factCause, failureLine, isCatch, likelyFixes, namedCause, namedRuns, prCause, readAnswer, suiteOfJob, trailerCause} from '../lib/e2e-causes.mjs';

/** Minutes between two ISO times to one decimal; 0 when either is missing or the order is wrong. */
export const minutesOf = (from, to) => (from && to ? Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 6000) / 10) || 0 : 0);

// Every e2e run kind the page shows (owner, 27 Oct 2026: betas and nightlies only could not tell whether PR e2e helped). null = not counted
// (a bisect or a mutant is red on purpose; a run by hand on main is someone's experiment).
export function kindOf(run, workflow) {
  const title = run.displayTitle || '';
  if (workflow === 'harness-daily.yml') return 'harness';
  if (workflow === 'desktop.yml') return /Nightly|E2E check/.test(title) ? 'nightly' : /Beta/.test(title) ? 'beta' : null;
  if (/^(Bisect|Mutant)/.test(title)) return null;
  if (title.startsWith('E2E for PR')) return 'pr';
  if (title.startsWith('E2E after merge')) return 'after-merge';
  if (title.startsWith('E2E check')) return 'scheduled';
  // Why (1 Nov 2026, found by reading the run list, mac-07 for the owner): the night's passes ride "Night burn-in n/5 · main" since 31 Oct and had no kind, so no night run, suite night or live quality night was ever stored; liveNights below expected them.
  if (/^Night burn-in \d\/\d/.test(title)) return 'nightly';
  if (title.startsWith('RC soak')) return 'soak';
  if (title.startsWith('Stable canary')) return 'canary';
  if (title.startsWith('Beta E2E')) return 'beta';
  return run.headBranch && run.headBranch !== 'main' && run.event === 'workflow_dispatch' ? 'pr' : null;   // before 26 Oct a PR's run read "E2E Mac + Linux · all suites · <branch>"
}
// The runs a red's fix is looked for in: a PR's own branch, or main (every other kind).
export const streamOf = run => (run.kind === 'pr' ? `pr:${run.headBranch}` : 'main');

const suiteJob = (job, run) => (run.kind === 'harness' ? (/harness|e2e tooling/i.test(job.name || '') || (job.steps || []).some(step => /harness test|e2e tooling test/i.test(step.name)) ? {suite: 'harness', platform: 'mac'} : null)
  : suiteOfJob(job.name, job.steps, run.workflow === 'e2e-windows.yml'));
const again = job => (job.steps || []).find(step => /once more, to tell flaky from real/.test(step.name) && step.conclusion && step.conclusion !== 'skipped');

// The suite jobs of one run that were red on their first try: [{suite, platform, jobConclusion, failedStep, rerun, minutes, jobId}]. Green on the second try still counts (a flake).
export function redJobs(run) {
  const out = [];
  for (const job of run.jobs || []) {
    const id = suiteJob(job, run);
    if (!id) continue;
    const second = again(job);
    if (job.conclusion !== 'failure' && job.conclusion !== 'cancelled' && !second) continue;
    if (job.conclusion === 'cancelled' && ['pr', 'after-merge'].includes(run.kind)) continue;   // a newer push or merge replaced it: not a red
    const failed = (job.steps || []).find(step => step.conclusion === 'failure');
    out.push({...id, jobConclusion: job.conclusion, failedStep: failed?.name || '', rerun: second?.conclusion, minutes: minutesOf(job.started_at, job.completed_at), jobId: job.id});
  }
  return out;
}
// The night jobs whose logs hold rates (tools/ci-intel/lib/e2e-rates.mjs): read like a red's log, but green or red.
export const rateJobs = run => (['nightly', 'scheduled'].includes(run.kind) ? (run.jobs || []).flatMap(job => { const id = suiteJob(job, run); return id && RATE_SUITES.includes(id.suite) && ['success', 'failure'].includes(job.conclusion) ? [{jobId: job.id}] : []; }) : []);
// Did this suite pass on its first try in this run?
export const passedFirst = (run, suite, platform) => (run.jobs || []).some(job => {
  const id = suiteJob(job, run);
  return id && id.suite === suite && id.platform === platform && job.conclusion === 'success' && !again(job);
});
// Waiting for a runner vs running, summed over the run's jobs (6e, 27 Oct 2026: #2199's checks took 13.9 min, its suite ran 73 s).
export function jobMinutes(jobs = []) {
  let queue = 0, running = 0;
  for (const job of jobs) if (job.started_at && job.completed_at && job.conclusion !== 'skipped') { queue += minutesOf(job.created_at || job.started_at, job.started_at); running += minutesOf(job.started_at, job.completed_at); }
  return {queueMin: Math.round(queue * 10) / 10, runMin: Math.round(running * 10) / 10};
}

/** Existing GitHub job reads -> successful first-try suite seconds only; no setup jobs, log text or non-main release runs. */
// Why (30 Oct 2026, a8): promise steps need artifact lists and ZIP reads; ship job medians from existing reads first, without expanding the hourly call caps.
export function suiteJobTimes(run) {
  if (run.kind !== 'pr' && run.headBranch !== 'main') return [];
  return (run.jobs || []).flatMap(job => {
    const id = suiteJob(job, run), seconds = (Date.parse(job.completed_at) - Date.parse(job.started_at)) / 1000;
    return id && /^[\w.+-]{1,80}$/.test(id.suite) && job.conclusion === 'success' && !again(job) && Number.isFinite(seconds) && seconds >= 0 && seconds <= 86400
      ? [{suite: id.suite, seconds}] : [];
  });
}

/** One beta run's suite jobs -> the row /admin/e2e draws (tools/ci-intel/lib/e2e-beta.mjs): green / red / not run-or-unfinished, the red suites' names, whether every Release job passed. null: not a beta run, or its jobs were not read (read again next hour). */
// Why (1 Nov 2026, a8): counted per job from the run's own job list (no new GitHub call kind); a flake that passed on its second try is green, as the job's conclusion says.
export function betaRunRow(run, now = new Date()) {
  if (run.kind !== 'beta' || !Array.isArray(run.jobs)) return null;
  let green = 0, red = 0, grey = 0;
  const redSuites = [];
  for (const job of run.jobs) {
    const id = suiteJob(job, run);
    if (!id) continue;
    if (job.conclusion === 'success') green += 1;
    else if (job.conclusion === 'failure' || job.conclusion === 'timed_out') { red += 1; redSuites.push(`${id.platform === 'windows' ? 'Windows' : 'Mac + Linux'} · ${id.suite}`); }
    else grey += 1;
  }
  const release = run.jobs.filter(job => /^Release\b/.test(job.name || ''));
  return cleanBetaRun({runId: run.databaseId, createdAt: run.createdAt, sha: String(run.headSha || ''), conclusion: run.conclusion, green, red, grey, released: release.length > 0 && release.every(job => job.conclusion === 'success'), redSuites: redSuites.sort()}, now);
}

// One red's cause. deps (async, may return null = could not read): commitsBetween(a, b) -> [{sha, message}], filesOf(sha) -> [file], filesBetween(a, b) -> [file],
// prFiles(pr) -> [file], diffOf(sha) -> text, ask({system, user}) -> text or null (no AI token: null); namedCommits (newest first): the main commits whose "E2E-cause:" trailer names run ids.
// log === null: the log was not read this pass (the red is read again later).
const SYMPTOM = ['flake', 'timing'];
export async function causeOfRed({run, red, log, next}, deps) {
  const line = failureLine(log || '');
  const fact = factCause({...red, log, line});
  // Why (2 Nov 2026, owner: "has this caught bug been counted?"): a fix that names the red's run id wins over the window up to the next green, which an intermittent red reaches
  // before its real fix (apply-1of3: #2986 was read for #2988). It beats the facts that only read the symptom, "flake" (a green second try cannot tell an intermittent bug from noise) and "timing" (the hang's own words: the real apply-1of3 red of 2 Nov read "timing"), never a lost runner, a CI step or the picker.
  const naming = namingCommit(deps.namedCommits, run.databaseId);   // the newest commit that names this run speaks for all of its reds (namedToRedo reads the same one)
  const named = run.kind === 'pr' || log === null || !naming ? null : namedCause([naming], red.suite, run.databaseId);
  if (fact && !(SYMPTOM.includes(fact) && named)) return {cause: fact, line};
  if (log === null) return {cause: 'unknown', line};
  if (named) return {cause: named.cause, line, fix: named.sha, named: true};
  if (!next) return {cause: 'open', line};
  if (run.kind === 'pr') {
    const sameCommit = next.headSha === run.headSha;
    const cause = prCause({sameCommit, fixFiles: sameCommit ? [] : (await deps.filesBetween(run.headSha, next.headSha)) || [], prFiles: (await deps.prFiles(run.pr)) || []});
    return {cause: cause || 'unknown', line};
  }
  const commits = await deps.commitsBetween(run.headSha, next.headSha);
  if (!commits) return {cause: 'unknown', line};
  const windowed = trailerCause(commits, red.suite);
  if (windowed) return {cause: windowed.cause, line, fix: windowed.sha};
  const fixes = likelyFixes(commits, {suite: red.suite, line});
  if (!fixes.length) return {cause: 'unknown', line};   // no commit to judge: the AI would only guess
  for (const [i, fix] of fixes.entries()) { fix.files = (await deps.filesOf(fix.sha)) || []; if (i < 2 && deps.diffOf) fix.diff = (await deps.diffOf(fix.sha)) || ''; }
  const answer = readAnswer((await deps.ask(causePrompt({suite: red.suite, kind: run.kind, line, fixes}))) || '');
  return {cause: answer?.cause || 'unknown', line, fix: answer?.fix ? fixes[answer.fix - 1]?.sha : undefined};
}

// Workers AI gives the text as result.response, as OpenAI-style choices, or (for a JSON answer) the parsed object itself: always text out (27 Oct 2026: every answer read "[object Object]").
export function answerText(data) {
  const raw = data?.result?.choices?.[0]?.message?.content ?? data?.result?.response ?? '';
  return (typeof raw === 'string' ? raw : JSON.stringify(raw)).replace(/<think>[^]*?<\/think>/g, '');
}

// runs: [{databaseId, createdAt, updatedAt, headSha, headBranch, conclusion, kind, workflow, pr, jobs}] oldest first -> {runs, fails, suiteNights} rows for the site.
export async function rowsOf(runs, {logOf = () => '', ...deps} = {}) {
  const out = {runs: [], fails: [], suiteNights: []};
  for (const [index, run] of runs.entries()) {
    out.runs.push({runId: run.databaseId, createdAt: run.createdAt, kind: run.kind, conclusion: run.conclusion, minutes: minutesOf(run.createdAt, run.updatedAt), ...jobMinutes(run.jobs), suiteJobs: suiteJobTimes(run), pr: run.pr || null});
    if (run.conclusion === 'cancelled') continue;   // a cancelled run is a try that showed nothing: its jobs are not reds
    if (['nightly', 'scheduled'].includes(run.kind)) for (const job of run.jobs || []) {
      const id = suiteJob(job, run);
      if (id && ['success', 'failure'].includes(job.conclusion)) {
        const rates = RATE_SUITES.includes(id.suite) ? ratesOf(id.suite, logOf(job.id)) : null;   // the suite's measured rates from its own log (tools/ci-intel/lib/e2e-rates.mjs), when the log was read
        out.suiteNights.push({runId: run.databaseId, day: run.createdAt.slice(0, 10), kind: run.kind, ...id, green: passedFirst(run, id.suite, id.platform), ...(rates ? {rates} : {})});
      }
    }
    for (const red of redJobs(run)) {
      const next = runs.slice(index + 1).find(later => streamOf(later) === streamOf(run) && passedFirst(later, red.suite, red.platform));
      const log = logOf(red.jobId);   // a flake's log too: its first try may be the picker's or the credit's red
      const {cause, line, fix, named} = await causeOfRed({run, red, log, next}, deps);
      out.fails.push({runId: run.databaseId, suite: red.suite, platform: red.platform, day: run.createdAt.slice(0, 10), kind: run.kind, cause, line, fix: fix || '', minutes: red.minutes,
        caught: isCatch(cause) ? 1 : 0, ...(named ? {named: 1} : {})});
    }
  }
  return out;
}

// New runs first, newest first, at most `max` a pass: the page fills from today backwards; with nothing new, the runs whose reds are still open or unknown are read again.
// redo: the runs a new trailer names (namedToRedo), read again whatever is stored.
export function runsToRead(listed, settled, waiting, max = 200, redo = new Set()) {
  const fresh = listed.filter(run => !settled.has(run.databaseId) && !waiting.has(run.databaseId));
  const again = fresh.length ? new Set(fresh.map(run => run.databaseId)) : waiting;
  return listed.filter(run => again.has(run.databaseId) || redo.has(run.databaseId)).slice(-max);
}

/** The newest main commit whose trailer names this run id, or undefined (commits come newest first). */
export const namingCommit = (commits = [], runId = '') => commits.find(commit => namedRuns(commit.message).includes(String(runId)));

// Causes a name never changes: no app step ran (runner, ci, picker) or the AI itself failed (ai). A run whose reds are all these is not read again for a name.
const NAME_CANNOT_CHANGE = ['runner', 'ci', 'picker', 'ai'];

/**
 * Main commits (newest first) and the stored reds [[runId, suite, cause, fix, kind]] (pull-request runs left out by the Worker) -> the run ids to read again: those where the
 * naming commit would change a red that is stored (another cause or fix, and a cause a name may change). Read once: after it every such red holds the named cause and fix, or none
 * would change (Why, 2 Nov 2026, Gitar on #2995: the first rule, "no stored fix is the naming commit", re-read runs that never take the name every hour for 30 days).
 */
export function namedToRedo(commits = [], reds = []) {
  const redo = new Set();
  for (const [runId, suite, cause, fix, kind] of reds) {
    if (kind === 'pr' || NAME_CANNOT_CHANGE.includes(cause)) continue;
    const naming = namingCommit(commits, runId), want = naming && namedCause([naming], suite, runId);
    if (want && (cause !== want.cause || fix !== want.sha)) redo.add(Number(runId));
  }
  return redo;
}

/** Oldest-first listed runs -> the beta runs whose suite counts the site lacks, newest first (the page fills from today back), at most `max` a pass. */
// Why (1 Nov 2026, Gitar on #244): the run list starts at a calendar date (up to ~31 days back) but the site keeps 30 days (cleanBetaRun); a run in that gap was read every hour and thrown away.
export function betaRunsToRead(listed, stored, max = 40, now = new Date()) {
  const from = now.getTime() - 30 * 86400000;
  return listed.filter(run => run.kind === 'beta' && !stored.has(run.databaseId) && Date.parse(run.createdAt) >= from).slice(-max);
}

/** Oldest-first listed runs -> unread suite history for the last seven observed main nights, bounded per hourly pass; settled red classification does not suppress history. */
export function nightRunsToRead(listed, stored, max = 40) {
  const nights = listed.filter(run => ['nightly', 'scheduled'].includes(run.kind) && ['success', 'failure'].includes(run.conclusion));
  const days = new Set([...new Set(nights.map(run => run.createdAt.slice(0, 10)))].slice(-7));
  return nights.filter(run => days.has(run.createdAt.slice(0, 10)) && !stored.has(run.databaseId)).slice(-max);
}
