// Owns: the tracked tasks the Mac starts: refresh (Find jobs), scoreQueue (the scores after it), rescore (Re-score), syncMatches, checkMail, scout, work, task, scoreVisits, mailResult.
// Each runs its engine commands through run() and is queued, shown and recorded by tracked() (pipeline-queue.js).
// Guarded by: test/unit/renderer/mail-report.test.js, test/unit/main/run-join.test.js, test/unit/main/run-note.test.js, test/unit/renderer/run-cards.test.js, test/unit/main/run-kinds.test.js, test/unit/main/stop-task.test.js.
// Split out of pipeline.js (a pure move); pipeline.js re-exports everything.
import {osText} from '../i18n/platform.js';
import {engineOf, familyOfEngine} from './ai/names.js';
import {deliveryProblem, mailProblem as mailProblemFrom} from './run-result.js';

import {aiReadyOf, dailyArgs, insightArgs, mailArgs, SCOUT_BUDGET_S, SEARCH_BUDGET_S, scoreQueueArgs, syncMatchesArgs, deliveryReady, triggerEnv, visitsArgs} from './pipeline-args.js';
import {appMessage, failedLine, taskSummary} from './pipeline-lines.js';
import {running, stopTask, tracked} from './pipeline-queue.js';
import {run} from './pipeline-run.js';
import {searchSteps} from './search-steps.js';
import {searchDone} from './search-report.js';
import {offer as offerBrowserReads} from './refused-offer.js';
import {save as saveNextStep} from './next-step.js';
import {besideSteps} from './search-beside.js';

// What a search-kind row says when it ends: the digest problem, and the counts of the run's own summary (data/reports/last-run.json) when it is this run's.
const searchSummary = storage => (record, log) => {
  const problem = deliveryProblem(log);   // the digest the bot could not deliver: said on the run, not only as "Failed"
  let summary = {};
  try { summary = JSON.parse(storage.readText('data/reports/last-run.json')); } catch {}
  const fresh = summary.started_at && Date.parse(summary.started_at) >= record.id - 60000;
  return {...(problem ? {problem} : {}), ...(fresh ? {found: summary.jobs ?? null, feeds: summary.feeds ?? null, new: summary.new ?? 0, changed: summary.changed ?? 0,
    scored: summary.score?.done ?? summary.score?.scored ?? null, usd: summary.usd ?? 0, warnings: summary.warnings || []} : {})};
};
// note: what this search is for beyond a refresh ("Search wider"), shown on its row from queued to finished.
export function refresh(storage, onLine, mode = 'run', trigger = 'you', {note = '', employers = false} = {}) {
  // A Find jobs press ends the scoring queue of the search before it: the engine runs one process at a time, and the new search scores the waiting jobs first itself.
  if (running()?.note === SCORE_QUEUE_NOTE) stopTask();
  let left = 0, waits = false;   // found jobs this search said it did not score; whether it kept jobs or postings waiting for the check after it
  const seen = line => { left = waitingOf(line) ?? left; waits = waits || waitsOf(line); };
  return tracked(storage, 'search', trigger, onLine, (tee, signal) => searchOnce(storage, line => { seen(line); tee(line); }, mode, trigger, {employers, signal, note}), {mode}, searchSummary(storage), {note})
    .then(done => {
      const max = done?.run ? queueMax({left, waits, scored: Number(done.run.scored) || 0, stopped: !!done.run.stopped, ai: aiReadyOf(storage)}) : 0;
      if (max) scoreQueue(storage, onLine, trigger, {max}).catch(() => {});
      return done;
    });
}
// The engine's own lines for found jobs a search did not score (src/daily_search_scoring.py score_batches, src/press/clock.py).
const WAITING = /^⏱ (?:Time is up for this refresh: )?(\d+) (?:found )?job\(s\) (?:wait for the next refresh|left for the next one)/;
const SCORE_CEILING = 60;   // scores one Find jobs run makes, the search and its queue together (pipeline-args.js --score-max)
/** How many found jobs a search's line says it did not score -> a number, or null for any other line. */
export const waitingOf = line => { const waits = WAITING.exec(String(line)); return waits ? Number(waits[1]) : null; };
// The engine's lines for jobs a search read and had no time to judge (src/sources/waiting_jobs.py SAID) and for postings it had no time to read (src/press/clock.py later).
const WAITS = /^(?:Waiting to be checked after this search: \d+ job|⏱ Time is up \(.*\) for descriptions: )/;
/** Whether a search's line says it kept work for the check after it (jobs to judge, postings to read). */
export const waitsOf = line => WAITS.test(String(line));
/**
 * How many scores the queue after a search may make -> 0 when it must not start: nothing waits (no unscored job, no job to check, no posting to read), the person
 * stopped the search, no AI, or the search already made the run's 60.
 * Why `waits` (12 Nov 2026, owner, asked via AskUserQuestion: "Yes, build it (Recommended)"): the queue also judges what the search read too late and reads the postings a
 * score needs; a Paris search listed 30 jobs, 23 without their posting, said no "jobs left" line, and the queue never started.
 */
export const queueMax = ({left, waits = false, scored, stopped, ai}) => ((left > 0 || waits) && !stopped && ai ? Math.max(0, SCORE_CEILING - scored) : 0);
export const SCORE_QUEUE_NOTE = 'Scoring the jobs it found';
export const SCORE_QUEUE_END = 'Score queue: done';
/**
 * The scoring queue: when a Find jobs run ends with found jobs it did not score, their scores go on by themselves, best places first (engine mode score), up to the
 * run's ceiling of 60 with the search's own scores; the jobs past it stay listed with "Score". Its own run row, no notification, stoppable like any task.
 * Why (11 Nov 2026, owner, asked via AskUserQuestion: "After the run, own queue (Recommended)"; "Keep 60, rest show 'Score' (Recommended)"): a search finds 170-280
 * jobs in a person's places and scored 9-32 of them in its 3 minutes; the rest waited for another press.
 * Invariant: its last line is SCORE_QUEUE_END however it ended (done, stopped, failed), so the window's queue state (renderer/pages/score-queue.js) always clears.
 * Its row is of kind 'today' (a list refresh) but it is its own task (key 'score'): it waits its turn behind a visits read, never joins one, and none joins it.
 */
export function scoreQueue(storage, onLine, trigger = 'you', {max = SCORE_CEILING} = {}) {
  return tracked(storage, 'today', trigger, onLine, async tee => {
    try {
      const {code, result} = await run(storage, scoreQueueArgs(storage, max), tee, triggerEnv(trigger));
      return {ok: code === 0, result};
    } finally { tee(SCORE_QUEUE_END); }
  }, null, () => ({scoreQueue: true}), {note: SCORE_QUEUE_NOTE, key: 'score'});
}
/**
 * The Re-score run (Jobs call to action, Strategy's notice): new scores for the jobs that already have an old one, and nothing else: no job boards, no
 * employer pages, no new jobs, and not a "search" (lastSearchAt stays). Design (3 Nov 2026, owner): a job already in the list is never re-scored by Find jobs.
 * note: "Re-scoring 75 older scores", shown on its row from queued to finished.
 */
export function rescore(storage, onLine, trigger = 'you', {note = ''} = {}) {
  const mode = 'rescore';
  return tracked(storage, 'search', trigger, onLine, async tee => {
    const {code, result} = await run(storage, dailyArgs(storage, {mode, budget: SEARCH_BUDGET_S}), tee, triggerEnv(trigger));
    return {ok: code === 0, result};
  }, {mode}, (record, log) => ({...searchSummary(storage)(record, log), rescore: true}), {note});   // rescore: its notice is Re-score's, not "Find jobs done, no jobs added"
}
export function syncMatches(storage, onLine, trigger = 'you') {
  return tracked(storage, 'search', trigger, onLine, tee => run(storage, syncMatchesArgs(), tee, triggerEnv(trigger))
    .then(({code, result}) => ({ok: code === 0, result})), {mode: 'today'}, () => ({}));
}
// A check that ended normally (exit 0, so a GitHub run isn't marked crashed) without reading the mail: why, or null.
export function mailProblem(stdout, result, family = 'claude') {
  return mailProblemFrom(stdout, result, family);
}
export function checkMail(storage, onLine, trigger = 'you') {
  let off = false, problem = null;
  return tracked(storage, 'mail', trigger, onLine, async tee => {
    const {code, stdout, result} = await run(storage, mailArgs(storage), tee, triggerEnv(trigger));
    off = /Gmail \+ Calendar is off/.test(stdout);
    problem = code === 0 ? mailProblem(stdout, result, familyOfEngine(engineOf(storage))) : null;
    // lastMailAt paces the schedule (a failed or "not connected" check waits for the next time too);
    // lastMailOkAt sets how far back the next check looks: only a check that read the mail moves it.
    const at = new Date().toISOString();
    const ok = code === 0 && !problem;
    storage.saveSettings({lastMailAt: at, ...(ok && !off ? {lastMailOkAt: at} : {})});
    return {ok, result};
  }, {}, (record, log) => ({...mailResult(log), off, problem}));
}
// What a Gmail check recorded and its "Mail: …" summary line (also read from GitHub runs' logs, cloud-runs.js).
export function mailResult(log) {
  const start = log.indexOf('Updates:');
  // The update lines sit between "Updates:" and the "Mail: …" summary; what follows (the run-log link) isn't one.
  const after = start < 0 ? [] : log.slice(start + 1);
  const end = after.findIndex(line => /^Mail: /.test(line));
  const updates = (end < 0 ? after : after.slice(0, end)).filter(line => /^\S/.test(line) && !/^Cronjob run logged/.test(line));
  return {updates, summary: log.filter(line => /^Mail: /.test(line)).pop() || null};
}
// Find new employers (the scout), from the button, Telegram or the schedule; its time paces the next one.
// paste: a file holding a page the person pasted (Employers → Add from a page): its companies are checked first (src/scout_paste.py).
export function scout(storage, onLine, trigger = 'you', batch = null, {paste = ''} = {}) {   // null: the engine's own size for the queue (src/scout.py batch_for)
  const send = deliveryReady(storage) ? ['--send'] : [];  // no Telegram: the app shows it
  storage.saveSettings({lastScoutAt: new Date().toISOString()});
  return task(storage, 'scout', ['src', 'scout', ...send, '--log-run', ...(batch ? ['--batch', String(batch)] : []), ...(paste ? ['--paste-file', paste] : []),
    '--budget', String(SCOUT_BUDGET_S)], onLine, trigger, paste ? {note: 'Companies from a page you pasted'} : {});
}
// The day's insight when it is due, asked by the schedule while our servers run the search (lib/one-place.js); its time marks the ask so it is made once per UTC day (lib/schedule.js insightDue).
export function insight(storage, onLine, trigger = 'schedule') {
  if (!aiReadyOf(storage)) return Promise.resolve({ok: true, skipped: true});   // no AI set up: nothing to ask (a scheduled search's --insight has the same gate); asked again next tick
  storage.saveSettings({lastInsightAt: new Date().toISOString()});
  return task(storage, 'insight', insightArgs(storage), onLine, trigger);
}
// A tracked task whose work is the app's own code, not an engine command (Tailor CVs): the same banner, live log, history row and result line. Not resumed after a restart.
// Stop (owner, 7 Oct 2026: "I miss a Stop button"): doWork gets an AbortSignal and ends at its next step; the engine commands it runs are ended as for any task.
export function work(storage, kind, onLine, doWork, trigger = 'you') {
  // A task that failed says why: its first "✗ <what>: <why>" line (7 Oct 2026: a browser run where Tiffany never started read "stopped
  // unexpectedly · No final result was recorded", though its reason was right under it).
  // `doWork` returns true/false, or {ok, made}: made = how many things the run made (Tailor CVs: CVs). The row keeps it, so a run that made none never links to "what it made" (#3639).
  let made = null;
  return tracked(storage, kind, trigger, onLine, async (tee, signal) => {
    const out = await doWork(tee, signal);
    if (out && typeof out === 'object') { made = Number(out.made) || 0; return {ok: !!out.ok}; }
    return {ok: !!out};
  }, null, (record, log) => ({summary: taskSummary(kind, log), message: appMessage(log), ...(made === null ? {} : {made}), ...(record.ok ? {} : {problem: failedLine(log)})}));
}
export function task(storage, kind, args, onLine, trigger = 'you', {note = ''} = {}) {
  return tracked(storage, kind, trigger, onLine, async tee => {
    const {code, result} = await run(storage, args, tee, triggerEnv(trigger));
    return {ok: code === 0, result};
  }, {args}, (record, log) => ({summary: taskSummary(kind, log), message: appMessage(log)}), {note});
}
function searchOnce(storage, onLine, mode, trigger = 'you', {employers = false, signal = null, note = ''} = {}) {
  return (async () => {
    const startedAt = new Date().toISOString();   // "Your search changed" compares with when a refresh began, not ended (renderer/search-changed.js)
    // LinkedIn jobs (switch on, lib/linkedin-headless.js) is read beside the engine's steps on the press's own clock, for a person's own press only (ownPress); otherwise this is just searchSteps.
    const steps = () => searchSteps(storage, onLine, mode, trigger, undefined, {employers});
    const {code, result, endedByTime} = await besideSteps(storage, onLine, signal, {mode, trigger, employers, note}, steps);
    storage.saveSettings({lastSearchAt: new Date().toISOString(), lastSearchStartedAt: startedAt, lastSearchOk: code === 0});
    searchDone({startedAt, ok: code === 0, stopped: code === null, trigger, endedByTime: !!endedByTime});
    if (code !== null) offerBrowserReads(storage, run).catch(() => {});   // the run offers "Find jobs using your browser" for the sites that refused it; it never reads them (lib/refused-offer.js)   // the search report (lib/search-report.js), when Technical reports are on
    if (code !== null) saveNextStep(storage, run).catch(() => {});   // the finished run's card says what comes next, from the engine's saved plan (lib/next-step.js, plan P3)
    return {ok: code === 0, result, endedByTime: !!endedByTime};
  })();
}

export function scoreVisits(storage, onLine, trigger = 'you') {
  return tracked(storage, 'today', trigger, onLine, async tee => {
    tee(osText('Scoring the jobs read in Chrome, on this Mac…', process.platform));
    const {code, result} = await run(storage, visitsArgs(storage), tee, triggerEnv(trigger));
    return {ok: code === 0, result};
  }, null, () => ({}), {first: true});
}
