// Telegram alerts for the scheduled CI checks (owner, 14 Oct 2026): a failure of e2e.yml (scheduled and gate runs) and site-replays.yml sends 🔴 once per commit and set of failed jobs (16 Oct 2026), and a success
// that closes a red the owner was sent sends 🟢 (only then; 10 Nov 2026). Bot @jobpilotto_ci_alerts_bot: CI_ALERTS_TELEGRAM_BOT_TOKEN + CI_ALERTS_TELEGRAM_CHAT_ID (missing: one line, no send).
// The token is never printed; no AI. Guard: e2e/test/harness/green-again.test.mjs.
//   node ci-alert.mjs <failure|success> "<cause in a few words>" "<the one next action>"      (GITHUB_* and GH_TOKEN from the runner)
// Job: report health
import path from 'node:path';
import fs from 'node:fs';
import {card, plural} from './lib/tg-card.mjs';
import {TIMEOUT_FAILURE} from './lib/triage-match.mjs';
import {aiFailureCauses} from './lib/ai-miss-cause.mjs';
import {ghIo, verdictsForCauses} from './lib/flaky-evidence.mjs';
import {isBackbone, suiteOfKey} from './lib/suite-shards.mjs';
import {reportFallback, viaSwitchboard} from './lib/switchboard.mjs';
import {eventOfWorkflow, stateOf} from './lib/alert-events.mjs';

const readLanes = () => JSON.parse(fs.readFileSync(new URL('./lanes.json', import.meta.url), 'utf8'));
// Invariant: a non-backbone suite result cannot cause an owner failure or recovery alert.
const backbone = (name, lanes = readLanes()) => isBackbone(lanes, suiteOfKey(name));

// Until 28 Oct 2026 a renamed workflow's old file is read too (replay-offline.yml → site-replays.yml, 14 Oct 2026).
export const OLD_FILES = {'site-replays.yml': 'replay-offline.yml'};
const FAILED = ['failure', 'timed_out'];
const workflowFile = env => path.basename(String(env.GITHUB_WORKFLOW_REF || '').split('@')[0]);

const API = env => env.GITHUB_API_URL || 'https://api.github.com';
const unsuccessful = job => ['failure', 'cancelled', 'timed_out'].includes(job.conclusion);
const get = (url, env, fetcher) => fetcher(url, {headers: {Authorization: `Bearer ${env.GH_TOKEN || ''}`, Accept: 'application/vnd.github+json'}, signal: AbortSignal.timeout(15000)}).then(answer => { if (answer.ok === false) throw new Error(`GitHub HTTP ${answer.status}`); return answer.json(); });

// Why (10 Nov 2026, #3660 review): a job's own conclusion is the verdict, but an unreadable jobs response proves neither failure nor recovery; reject it before classifying.
const jobsFor = async (runId, env, fetcher) => {
  const body = await get(`${API(env)}/repos/${env.GITHUB_REPOSITORY}/actions/runs/${runId}/jobs?per_page=100`, env, fetcher);
  if (!Array.isArray(body.jobs)) throw new Error(`jobs of run ${runId} unreadable`);
  return body.jobs;
};
const unsuccessfulJobs = async (runId, env, fetcher) => (await jobsFor(runId, env, fetcher)).filter(unsuccessful);

/** A run's blocking backbone job names. */
export async function failedJobs(runId, env = process.env, fetcher = fetch, lanes = readLanes()) {
  return (await unsuccessfulJobs(runId, env, fetcher)).filter(job => backbone(job.name, lanes)).map(job => job.name).sort();
}

/** Unsuccessful jobs with their links, for the alert's job list. */
export async function failedJobLinks(runId, env = process.env, fetcher = fetch) {
  return (await unsuccessfulJobs(runId, env, fetcher)).map(job => ({name: job.name, url: job.html_url}));
}

/**
 * The failed steps' own words: per failed job, every annotation titled "<suite> · <step>" (lib/artifacts.mjs annotationLines). Errors: [] (the caller's cause stays).
 * @returns {Promise<{suite: string, step: string, message: string, job: string, url: string}[]>} e.g. [{suite: 'apply', step: 'fill the form', message: 'a required field is missing'}]
 */
export async function stepCauses(runId, env = process.env, fetcher = fetch, lanes = readLanes()) {
  try {
    const body = await get(`${API(env)}/repos/${env.GITHUB_REPOSITORY}/actions/runs/${runId}/jobs?per_page=100`, env, fetcher);
    const out = [];
    for (const job of (body.jobs || []).filter(item => item.conclusion === 'failure' && backbone(item.name, lanes))) {
      const notes = await get(`${API(env)}/repos/${env.GITHUB_REPOSITORY}/check-runs/${job.id}/annotations?per_page=50`, env, fetcher);
      for (const note of (Array.isArray(notes) ? notes : []).filter(item => / · /.test(item.title || ''))) {
        const at = note.title.indexOf(' · ');
        out.push({suite: note.title.slice(0, at), step: note.title.slice(at + 3), message: String(note.message || ''), job: job.name,
          url: job.html_url || `${env.GITHUB_SERVER_URL || 'https://github.com'}/${env.GITHUB_REPOSITORY}/actions/runs/${runId}/job/${job.id}`});
      }
    }
    return out;
  } catch { return []; }
}

/**
 * Mark the failed steps that are flaky: red on code unchanged since a green of the same step (lib/flaky-verdict.mjs). Errors and a slow read: the causes as they were.
 * @returns {Promise<object[]>} causes, each flaky one with `flaky: {green: {sha, run, url}, sameCommit}`
 */
export async function flakyCauses(causes, runId, env = process.env, fetcher = fetch, io, deadlineMs = 90000) {
  let timer;
  const deadlineAt = Date.now() + deadlineMs;   // the one hang guard: the reads inside end by it too (flaky-evidence.mjs), not only this race
  const reads = io || ghIo({repo: env.GITHUB_REPOSITORY, deadlineAt});
  try {
    const read = (async () => {
      const run = await get(`${API(env)}/repos/${env.GITHUB_REPOSITORY}/actions/runs/${runId}`, env, fetcher);
      return {redSha: run.head_sha, found: await verdictsForCauses(causes, {redSha: run.head_sha, redRun: runId, redAt: run.created_at, io: reads, deadlineAt})};
    })();
    const {redSha, found} = await Promise.race([read, new Promise((_, stop) => { timer = setTimeout(() => stop(new Error('flaky read took too long')), deadlineMs); })]);
    return causes.map(cause => {
      const verdict = found.find(item => item.suite === cause.suite && item.step === cause.step && item.verdict === 'flaky');
      return verdict ? {...cause, flaky: {green: verdict.green, sameCommit: verdict.green.sha === redSha}} : cause;
    });
  } catch { return causes; } finally { clearTimeout(timer); }
}

// PR numbers in a compare range's commits (a merge commit "Merge pull request #123 from …", or a squash "Title (#123)"), newest first.
// Why (30 Oct 2026): main merges PRs by merge commit since 27 Oct; matching only "(#123)" left "Since green" empty.
const prNumbers = commits => commits.map(commit => /^Merge pull request #(\d+)\b|\(#(\d+)\)\s*$/.exec(String(commit.commit?.message || '').split('\n')[0])).filter(Boolean).map(found => found[1] || found[2]).reverse();

// The PRs that landed since this workflow's last green run on the branch -> {prs: [number], more: number}; empty when unknown.
export async function sinceGreen(env = process.env, fetcher = fetch, shown = 5) {
  const file = workflowFile(env), repo = `${API(env)}/repos/${env.GITHUB_REPOSITORY}`;
  try {
    const green = (await get(`${repo}/actions/workflows/${file}/runs?branch=${encodeURIComponent(env.GITHUB_REF_NAME || 'main')}&status=success&per_page=1`, env, fetcher)).workflow_runs?.[0];
    if (!green?.head_sha || green.head_sha === env.GITHUB_SHA) return {prs: [], more: 0};
    const all = prNumbers((await get(`${repo}/compare/${green.head_sha}...${env.GITHUB_SHA}`, env, fetcher)).commits || []);
    return {prs: all.slice(0, shown), more: Math.max(0, all.length - shown)};
  } catch { return {prs: [], more: 0}; }
}

/**
 * The red the owner was sent that this green run closes, read from the workflow's own finished runs on the branch (no second store): walk back through recent alerting runs, closing each suite only on an observed pass.
 * A streak run counts when a red card went out for it: an e2e.yml run only when a backbone job failed in it (report-only suites never send one; such a run can close only the suites it passed),
 * any other workflow when it failed. A suite is closed only if a red remains open for it and this run passed it. Errors (told on stderr) and nothing open: suites [] (the caller stays silent).
 * Why (10 Nov 2026, owner, asked via AskUserQuestion, "Only to close a red I saw"): "green again" came for suites that never sent a red and fell back to the workflow's name. The switchboard's own holds
 * (a switch off, "same state") are not readable from here (its log has no read route), so a red it held counts as seen: the one gap, told by the PR.
 * @returns {Promise<{suites: string[], at: string, sha: string, fixed: {prs: string[], more: number}, flaky: boolean}>} `at` = when the oldest closed red began; `flaky` = this run checked the same commit as the newest red.
 */
export async function openRed(env = process.env, fetcher = fetch, lanes = readLanes(), shown = 3) {
  const none = {suites: [], at: '', sha: '', fixed: {prs: [], more: 0}, flaky: false};
  const repo = `${API(env)}/repos/${env.GITHUB_REPOSITORY}`, workflow = env.GITHUB_WORKFLOW || 'CI';
  try {
    const streak = await redStreak(env, fetcher, lanes);
    if (!streak.length) return none;
    const passed = workflowFile(env) === 'e2e.yml' ? await passedNow(env, fetcher) : null;
    // Unrun and skipped suites keep their earlier red; only an observed pass closes it.
    const newest = streak[0].run, back = [...new Set(streak.flatMap(item => item.suites))].filter(suite => suite === workflow || !passed || passed.has(suite));
    if (!back.length) return none;
    const began = suite => streak.filter(item => item.suites.includes(suite)).at(-1).run;
    const startOf = run => String(run.run_started_at || run.created_at), oldest = back.map(began).sort((a, b) => startOf(a).localeCompare(startOf(b)))[0], flaky = newest.head_sha === env.GITHUB_SHA;
    const all = flaky || !newest.head_sha ? [] : prNumbers((await get(`${repo}/compare/${newest.head_sha}...${env.GITHUB_SHA}`, env, fetcher).catch(error => { console.error(`ci-alert: compare unavailable: ${String(error.message).slice(0, 80)}`); return {}; })).commits || []);
    return {suites: back, at: oldest.run_started_at || oldest.created_at || '', sha: newest.head_sha || '', fixed: {prs: all.slice(0, shown), more: Math.max(0, all.length - shown)}, flaky};
  } catch (error) {
    console.error(`ci-alert: green not sent (could not read the earlier runs: ${String(error?.message || error).slice(0, 80)})`);
    return none;
  }
}

// Walk newest first: observed passes hide older reds for that suite; an absent suite never does.
async function redStreak(env, fetcher, lanes) {
  const e2e = workflowFile(env) === 'e2e.yml', workflow = env.GITHUB_WORKFLOW || 'CI', closed = new Set(), streak = [];
  for (const run of (await finishedRuns(env, fetcher)).slice(0, 12)) {
    if (e2e && run.conclusion === 'success' && /^E2E after merge · /.test(run.display_title || '')) continue;
    if (!e2e) {
      if (run.conclusion === 'success') break;
      if (FAILED.includes(run.conclusion)) streak.push({run, suites: [workflow]});
      continue;
    }
    if (!FAILED.includes(run.conclusion) && run.conclusion !== 'success') continue;
    const jobs = await jobsFor(run.id, env, fetcher), bad = jobs.filter(unsuccessful);
    const suites = [...new Set(bad.filter(job => backbone(job.name, lanes)).map(job => suiteOfKey(job.name)))].filter(suite => !closed.has(suite));
    if (FAILED.includes(run.conclusion) && !bad.length && !closed.has(workflow)) suites.push(workflow);
    if (suites.length) streak.push({run, suites});
    if (run.conclusion === 'success' || effectiveStatus(run.conclusion, bad, lanes) === 'success') closed.add(workflow);
    for (const suite of passedSuites(jobs)) closed.add(suite);
  }
  return streak;
}

// A suite passed only when at least one job succeeded and none of its shards failed.
function passedSuites(jobs) {
  const bad = new Set(jobs.filter(unsuccessful).map(job => suiteOfKey(job.name)));
  return new Set(jobs.filter(job => job.conclusion === 'success').map(job => suiteOfKey(job.name)).filter(suite => !bad.has(suite)));
}

// The suites this e2e run passed: a job succeeded and none of the suite's jobs failed.
async function passedNow(env, fetcher) {
  return passedSuites(await jobsFor(env.GITHUB_RUN_ID, env, fetcher));
}

// This workflow's finished runs on the branch except this one, newest first (the renamed file's too when the new name has none). A by-hand bisect run (e2e_bisect.py: "Bisect <suite> <sha>") is no main check.
async function finishedRuns(env, fetcher) {
  const file = workflowFile(env);
  for (const name of [file, OLD_FILES[file]].filter(Boolean)) {
    try {
      const body = await get(`${API(env)}/repos/${env.GITHUB_REPOSITORY}/actions/workflows/${name}/runs?branch=${encodeURIComponent(env.GITHUB_REF_NAME || 'main')}&status=completed&per_page=20`, env, fetcher);
      const runs = (body.workflow_runs || []).filter(run => String(run.id) !== String(env.GITHUB_RUN_ID) && (file !== 'e2e.yml' || /^(E2E check · |Beta E2E tests |E2E after merge · )/.test(run.display_title || '')));
      if (runs.length) return runs;
    } catch { /* try the next name */ }
  }
  return [];
}

// One alert per (workflow, commit, failed jobs): true when an earlier finished run of this workflow on this commit failed with the same failed jobs. Errors: false (alert).
export async function isRepeat(env = process.env, fetcher = fetch, lanes = readLanes()) {
  const file = workflowFile(env);
  try {
    const body = await get(`${API(env)}/repos/${env.GITHUB_REPOSITORY}/actions/workflows/${file}/runs?branch=${encodeURIComponent(env.GITHUB_REF_NAME || 'main')}&status=completed&per_page=10`, env, fetcher);
    const earlier = (body.workflow_runs || []).filter(run => String(run.id) !== String(env.GITHUB_RUN_ID) && run.head_sha === env.GITHUB_SHA && run.conclusion === 'failure');
    if (!earlier.length) return false;
    const now = [...await failedJobs(env.GITHUB_RUN_ID, env, fetcher, lanes), ...(env.CI_ALERT_ASSUME_FAILED ? [env.CI_ALERT_ASSUME_FAILED] : [])].sort().join('|');   // ASSUME_FAILED: the job that sends is itself the failing one, not yet marked
    if (!now) return false;
    for (const run of earlier) if ((await failedJobs(run.id, env, fetcher, lanes)).join('|') === now) return true;
  } catch { /* alert rather than stay silent */ }
  return false;
}

// Human words for a step's text: a value that ends the line as null/undefined reads "nothing" (never inside an error such as "of undefined"), a quoted name before ":" loses its quotes.
const plain = text => String(text).replace(/\b(shows|says|is) (?:null|undefined)$/, '$1 nothing').replace(/^"([^"]+)":/, '$1:');

// Short names stop at a whole word; annotation evidence remains available in the linked job log.
const short = (text, max = 80) => text.length <= max ? text : `${text.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;

// Parse only runner-owned budget wording, after the shared timeout classifier has identified timing.
function timingCause(message) {
  const minutes = /(?:suite's |over its )(\d+)-minute budget/.exec(message)?.[1];
  return minutes ? {icon: '⏱', text: `Over its ${minutes}-min budget`, cut: !message.startsWith('not run: '),
    detail: message.includes('the suite is too long: split it') ? 'the suite is too long: split it' : ''}
    : {icon: '⏱', text: short(message.split(': ')[0])};
}

// Each annotation can carry multiple recorded problems; an unknown cause keeps its own words.
function problemsOf(message) {
  const ai = aiFailureCauses(message);
  if (ai.length) return ai;
  if (TIMEOUT_FAILURE.test(message)) return [timingCause(message)];
  const items = String(message || 'see the job log').split('\n')[0].split('; ').filter(Boolean);
  const more = /^\+(\d+) more$/.exec(items.at(-1) || '');
  if (more) items.pop();
  return items.map((text, i) => ({icon: '✗', key: text, text: short(plain(text), 120), more: i === items.length - 1 ? Number(more?.[1] || 0) : 0}));
}

// Why (31 Oct 2026, owner: "You detect flakiness and immediately treat the flakiness root cause"): a step red on code unchanged since a green is its own cause, with the green it compared to.
const flakyProblem = flaky => ({icon: '🎲', key: 'flaky', text: 'Flaky: red on code unchanged since it passed', green: flaky.green, same: Boolean(flaky.sameCommit)});

function groupedCauses(causes, fallback) {
  const groups = new Map();
  for (const cause of causes) for (const problem of cause.flaky ? [flakyProblem(cause.flaky)] : problemsOf(cause.message)) {
    const key = `${problem.icon}:${problem.key || problem.text}`;
    const group = groups.get(key) || {...problem, more: 0, steps: []};
    group.detail ||= problem.detail;
    group.more = (group.more || 0) + (problem.more || 0);
    group.steps.push({...cause, cut: problem.cut, skipped: String(cause.message).startsWith('not run: ')});
    groups.set(key, group);
  }
  return groups.size ? [...groups.values()] : [{icon: '🔌', text: short(plain(fallback), 160), steps: []}];
}

// One Why row per cause: its icon, how many steps it hit, the plain cause. A step's raw payload (a JSON read, a stack) is cut: the run keeps it, the message never shows it.
const cleaned = text => String(text).replace(/\s*\(?last read:?\s*[{[].*$/si, '').replace(/\s*[{[]\s*["'][\w-]+["']\s*:.*$/s, '').replace(/[\s:(]+$/, '');
const causeRow = (group, prefix = '') => ({icon: group.icon, count: group.steps.length || undefined, text: `${prefix}${short(cleaned(group.text), 90)}${group.green ? ' (fix its input, not the step)' : ''}`});

// "After #3630 · #3629 +4 more": the PRs that landed since the last green, as plain text (the one link of the message is the run).
const sinceText = since => (since.prs.length ? `after ${since.prs.slice(0, 3).map(number => `#${number}`).join(' · ')}${since.prs.length > 3 || since.more ? ` +${Math.max(0, since.prs.length - 3) + since.more} more` : ''}` : '');
const factsOf = (since, where) => [`🕐 ${[where.time, sinceText(since)].filter(Boolean).join(' · ')}`];

/** A failure whose failed jobs are all non-backbone counts as a success (report-only suites never send a red card). */
export const effectiveStatus = (status, jobs = [], lanes = readLanes()) => (status === 'failure' && jobs.length && !jobs.some(job => backbone(job.name, lanes)) ? 'success' : status);

/**
 * Build a pure Telegram payload (lib/tg-card.mjs): one card for the red suites, or one for the suites whose red the owner was sent and that passed now (`closed`, from openRed); anything else stays silent.
 * Why (10 Nov 2026, owner, asked via AskUserQuestion, "Only to close a red I saw"): "🟢 … are green again on main" came with report-only suites and no red before it. It says what it closes and what fixed it, or that the same code passed again.
 */
// Why (10 Nov 2026, owner: every message reads like the Central scout one): a red and a green card alike are one headline, the Why rows or two facts (red since, fixed by), one verdict and the run link; no per-suite sections, job links, PR links or commit link.
export function messageOf({status, what = '', causes = [], next = '', closed, since = {prs: [], more: 0}, jobs = [], env = process.env, now = new Date(), lanes = readLanes()}) {
  const blocking = jobs.filter(job => backbone(job.name, lanes));
  status = effectiveStatus(status, jobs, lanes);
  const where = placeOf(env, now);
  const named = names => [...new Set(names.map(suiteOfKey))].filter(suite => backbone(suite, lanes));
  const link = {text: 'Open the run', url: where.run};
  if (status === 'failure') {
    const suites = where.e2e ? named([...blocking.map(job => job.name), ...causes.map(cause => cause.suite)]) : [];
    const own = suite => (where.e2e ? causes.filter(cause => cause.suite === suite) : causes);
    const fallback = what || `Failed job: ${blocking.map(job => job.name).join(', ') || 'see the run'}`;
    const names = suites.length ? suites : [where.workflow];
    const why = names.flatMap(suite => groupedCauses(own(suite), fallback).map(group => causeRow(group, names.length > 1 ? `${suite} · ` : '')));
    const steps = causes.filter(cause => !where.e2e || names.includes(cause.suite)).length;
    const headline = names.length === 1 ? `${names[0]}: ${steps ? `${plural(steps, 'step')} red` : 'failed'} on ${where.branch}` : `${plural(names.length, 'suite')} red on ${where.branch}: ${short(names.join(', '), 60)}`;
    return card({level: 'red', headline, why, facts: factsOf(since, where), verdict: {ok: false, text: next ? `Next: ${short(next, 160)}` : 'Main stays red until the failing step passes.'}, link});
  }
  if (status === 'success' && closed?.suites?.length) return greenCard(closed, where, link);
  return '';
}

// The green card: the suites a sent red closed, since when, and what fixed it (a PR, or the same code passing again).
function greenCard(closed, where, link) {
  const back = closed.suites, fixed = closed.fixed || {prs: [], more: 0};
  const fix = closed.flaky ? '🎲 Passed again on the same code (flaky)' : fixed.prs.length ? `🔧 Fixed by ${fixed.prs.map(number => `#${number}`).join(' · ')}${fixed.more ? ` +${fixed.more} more` : ''}` : '';
  return card({level: 'green', headline: `${back.length > 1 ? short(back.join(', '), 60) : back[0]} ${back.length > 1 ? 'are' : 'is'} green again on ${where.branch}`,
    facts: [closed.at ? `🕐 Red since ${zurich(new Date(closed.at))}` : '', fix].filter(Boolean), verdict: {ok: true, text: 'It passed on the latest run.'}, link});
}

// The run's place and time, from the GitHub env: links, branch, the commit it checked, whether it is the e2e workflow (suites name its alerts).
function placeOf(env, now) {
  const repo = `${env.GITHUB_SERVER_URL || 'https://github.com'}/${env.GITHUB_REPOSITORY}`;
  return {repo, run: `${repo}/actions/runs/${env.GITHUB_RUN_ID}`, branch: env.GITHUB_REF_NAME || 'main', sha: String(env.AFTER_MERGE || env.GITHUB_SHA || ''),
    workflow: env.GITHUB_WORKFLOW || 'CI', e2e: path.basename(String(env.GITHUB_WORKFLOW_REF || '').split('@')[0]) === 'e2e.yml',
    time: zurich(now)};
}
const zurich = date => new Intl.DateTimeFormat('en-GB', {timeZone: 'Europe/Zurich', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'}).format(date);

/**
 * True when a send() line means the alert is DONE: delivered, held on purpose by the owner's switch (a hold is final: no retry, no claim to release), or `unsure` (the request timed out, Telegram may have delivered it).
 * Why (10 Nov 2026, owner: "It tells you once" came twice, 8 Nov 10:24 and 11:22; runs 42466803520, 42471046179): a timeout was read as "not sent", the claim was released and the next hour sent it again.
 * A message lost to a timeout is told by the run that is still red; a message told twice is noise the owner saw. At most once.
 * Callers: msix-store-watch (keeps its claim) and credit-alert (writes its marker): a credit or Store verdict whose request never left the machine is lost for that run; accepted (code review, 10 Nov 2026), the next run tells the credit again.
 */
export const delivered = line => /^ci-alert: (sent|held|unsure)\b/.test(String(line));

// text: a message from messageOf (or a plain string) -> the line to print.
// With `event` (an id of shared/notify-registry.js in jobadabra-web) the alert goes through the owner's switchboard first (Admin → Operations → Notifications: on/off, when, which bot);
// a switchboard that cannot deliver (down, no key, 400/503) leaves the old CI-alerts bot to send it, and tells the switchboard so ("sent without switchboard").
// Why (5 Nov 2026, owner, nt 3/4): an alert must still arrive while the Engineering bot is not connected, so the old path is the fallback, never removed first.
export async function send(message, env = process.env, fetcher = fetch, {event = '', state, level} = {}) {
  if (!message) return 'ci-alert: nothing to send';
  const payload = typeof message === 'string' ? {text: message, disable_web_page_preview: true} : message;
  const board = event ? await viaSwitchboard({event, text: payload.text, html: payload.parse_mode === 'HTML', state, level}, env, fetcher) : null;
  if (board) return board;
  if (!env.CI_ALERTS_TELEGRAM_BOT_TOKEN || !env.CI_ALERTS_TELEGRAM_CHAT_ID) return 'ci-alert: not sent (CI_ALERTS_TELEGRAM_BOT_TOKEN or CI_ALERTS_TELEGRAM_CHAT_ID not set)';
  try {
    const answer = await fetcher(`https://api.telegram.org/bot${env.CI_ALERTS_TELEGRAM_BOT_TOKEN}/sendMessage`, {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({chat_id: env.CI_ALERTS_TELEGRAM_CHAT_ID, ...payload}), signal: AbortSignal.timeout(15000)});
    if (answer.ok && event) await reportFallback(event, env, fetcher, state);
    return answer.ok ? 'ci-alert: sent' : `ci-alert: not sent (Telegram ${answer.status})`;
  } catch (error) {
    const name = String(error?.name || 'error');
    return ['TimeoutError', 'AbortError'].includes(name) ? `ci-alert: unsure (${name}: it may have arrived)` : `ci-alert: not sent (${name})`;
  }   // never the error text: it can carry the URL with the token
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const [status, what, next] = process.argv.slice(2);
  if (status === 'failure' && await isRepeat()) console.log('ci-alert: not sent (same failure on this commit already alerted)');
  else {
    const jobs = status === 'failure' ? await failedJobLinks(process.env.GITHUB_RUN_ID).catch(() => []) : undefined;
    const failure = effectiveStatus(status, jobs) === 'failure';
    const since = failure ? await sinceGreen() : undefined, closed = failure ? undefined : await openRed();
    const seen = failure ? await stepCauses(process.env.GITHUB_RUN_ID) : [];
    const causes = failure && placeOf(process.env, new Date()).e2e ? await flakyCauses(seen, process.env.GITHUB_RUN_ID) : seen;
    console.log(await send(messageOf({status, what, causes, next, closed, since, jobs}), process.env, fetch, {event: eventOfWorkflow(process.env), ...stateOf(failure ? 'failure' : 'success', {causes, jobs})}));
  }
}
