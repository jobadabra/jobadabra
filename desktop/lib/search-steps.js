// Owns: the steps of one "Find jobs" run (the search task): the first run as one search (jobs in seconds: a slice of fast feeds, 3 scored, then the rest), a later
// press as one search (waiting jobs scored first, the job boards read inside it beside the employers' pages), and the employer finder (the scout) at the end when it is due, so one action grows the sources and crawls them.
// Guarded by: test/unit/main/search-steps.test.js, search-steps-beside.test.js, test/unit/main/app-scenarios.test.js. Spec: docs/superpowers/specs/2026-10-16-first-jobs-fast.md.
import * as claudeCode from './claude-code.js';
import {dailyArgs, SEARCH_BUDGET_S, deliveryReady, triggerEnv} from './pipeline-args.js';
import {run} from './pipeline-run.js';
import {APP_STEPS} from './press-stages.js';
import {watchGuest} from './linkedin-guest-on.js';

const SCOUT_COOLDOWN_MS = 24 * 3600 * 1000;   // a press of Find jobs grows the sources at most once a day

// The employer finder is part of Find jobs: on the first run, and on a press when none ran in the last day. A schedule that has its own scout
// (Settings → How often) keeps it separate.
export function scoutDue(settings, trigger, now = Date.now(), force = false) {
  if (force) return true;   // "Search wider" from the few-jobs help or the next-step advice (its old name was about employers, until 5 Nov 2026)
  if (trigger === 'schedule' || settings.cloud?.repo) return false;
  if (trigger === 'first' || !settings.lastScoutAt) return true;
  return now - Date.parse(settings.lastScoutAt) >= SCOUT_COOLDOWN_MS;
}

// A Find jobs press on a Mac that never searched is the first run (jobs in seconds), whoever pressed: the card, the header button, ⌘K.
export const searchTrigger = settings => (settings.lastSearchAt ? 'you' : 'first');

// One deadline for the whole press (owner, 26 Oct 2026: "A find jobs session should take at most 3min"; the 06:21 press took 269 s: the job
// boards' step 177 s with no clock, then the search's own 3 minutes). Every engine step gets the press's time (JOBADABRA_SEARCH_AT) and counts
// from it (src/time_budget.py): the search ends at the press's end, minus the finder's share when it is due; the finder gets what is left. A step with
// no time left waits for the next search and says so.
export const SCOUT_SHARE_S = 45;   // the employer finder's seconds at the press's end, when it is due
const {search: SEARCH, scout: SCOUT} = APP_STEPS;   // the steps' wording: src/press/stages.py's rows, mirrored in press-stages.js
const STEP_MIN_S = 20;             // fewer seconds left: the step waits for the next search (an engine step needs a few to start)

// Why (27 Oct 2026, Gitar on #2285): the SIGTERM handler writes the row (a Notion call) and may wait EXIT_GRACE_S (3 s); the stop starts this long before 180 s
// so the step is gone by the press's end.
const STOP_MARGIN_S = 5;
const RAN_OUT = /^⏱ (?:Time is up\b|No time left\b|\d+ (?:site read\(s\) still open|task\(s\) still running) at the run's time)/;   // the engine's own ran-out-of-time lines, not its batch plans or backlogs
const clockText = s => `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;

export async function searchSteps(storage, onLine, mode, trigger = 'you', exec = run, {employers = false, now = Date.now} = {}) {
  const ai = claudeCode.aiReady(storage.settings(), !!storage.secret('ANTHROPIC_API_KEY'), !!storage.secret('OPENAI_API_KEY'));
  const pressAt = now();
  // Why (lg 2/4; owner, 13 Nov 2026, asked via AskUserQuestion: "Shared 1-day pause (Recommended)"): the engine's LinkedIn slow-down line pauses both LinkedIn reads a day (lib/linkedin-guest-on.js)
  onLine = watchGuest(storage, onLine, now);
  const env = {...triggerEnv(trigger), JOBADABRA_SEARCH_AT: String(pressAt / 1000)};
  const scout = scoutDue(storage.settings(), trigger, Date.now(), employers);
  const budget = SEARCH_BUDGET_S - (scout ? SCOUT_SHARE_S : 0);   // the search's end on the press's clock
  const spent = () => Math.floor((now() - pressAt) / 1000);
  const left = () => SEARCH_BUDGET_S - spent();
  // Why (4 Nov 2026, #3108, a tester on 0.9.2: a run that stopped at the limit read green "Completed, No jobs added"): this is the one place that knows the press ended by time (a step stopped at
  // its end, or one that never started for lack of it); it says so once in what it returns, the run record keeps it, and the pill and cards only draw it (renderer/run-status.js runStatus).
  let endedByTime = false;
  // Design (27 Oct 2026): one owner of the hard end. The engine's clock (src/time_budget.py) is only asked by the stages; this ends any step at the
  // press's 180 s whether or not it asked. SIGTERM, so the step closes its row; what it saved per item is kept, the rest waits (the next search reads it).
  // Why (27 Oct 2026, owner: build only this first step): main's search check had persona 4 at 181 s of 180; and (4 Nov 2026, #3108) this same wrapper is the one owner of the verdict "the press ended by time" (hard stop or the engine's own stop line), so the run record can say Partial.
  // `counts`: whether this step's time-up makes the SEARCH Partial; the employer finder is an add-on, so its own stop (or hard stop) does not. Why (4 Nov 2026, #3108; Gitar on #3154): the engine stops itself at
  // its budget and exits 0, usually before this hard stop, and says so on its ran-out-of-time lines (src/time_budget.py `later`, the refresh's end and "No time left", src/run_exit.py "still open at the run's time").
  // Other lines that start with the mark are plans and backlogs ("This refresh scores 40 of 90", "found job(s) wait … to be scored"): a search that finishes early with them is not Partial.
  const step = (args, what, counts = true) => exec(storage, args, line => { if (counts && RAN_OUT.test(line)) endedByTime = true; onLine(line); }, env, {stopAfterMs: Math.max(1, (SEARCH_BUDGET_S - STOP_MARGIN_S) * 1000 - (now() - pressAt))}).then(done => {
    if (done.endedByTime) { if (counts) endedByTime = true; onLine(`⏱ Time is up (${clockText(spent())}) for ${what}: what it has not reached waits for the next search`); return {...done, code: 0}; }   // a time-up is not a failure
    return done;
  });
  const timeUp = (what, partial = true) => { if (partial) endedByTime = true; onLine(`⏱ Time is up (${clockText(spent())}) for ${what}: it waits for the next search`); };   // partial=false: the employer finder is an add-on, the search itself was whole
  let code;
  let result;
  if (trigger === 'first' && ai) {
    // The first run: jobs in seconds, in one engine process. The engine reads a slice of fast feeds and scores 3 jobs first (src/first_jobs.py), then does
    // the full search; the job boards are read from second 0 in the search's own lane (src/sources/boards_first.py Beside, lanes 4a) and their jobs scored by it.
    // Why (11 Nov 2026, owner: "I approve. Move ahead." on "first search as one process, dead steps deleted"): the job boards' own step and a light run
    // scoring their jobs came after the search; in 16 of 22 first searches (each person's first search in the search-personas runs 43088269080 and
    // 43103313269) neither had any time and only printed "Time is up"; in the other 6 the search ended at 68-113 s, past the end of the boards' step
    // (boards.SHARE_S, 60 s from the press), so it read no board, and no job waited for the light run to score.
    onLine('Finding your first jobs…');
    ({code, result} = await step(dailyArgs(storage, {mode, firstJobs: true, budget}), SEARCH.what, SEARCH.counts));
  } else {
    // Why (8 Nov 2026, owner: "One process, discovery inside (Recommended)"; "If there are jobs waiting to be scored, that should be the first new thing a
    // repeated press does"): the job boards' own step in front of the search held the run lock (src/paths.py) to ~60 s while the employer read stops
    // 67.5 s after the press (src/sources/read_budget.py cut_at), so employer sites got ~4 s (run 42411469318, p7). One engine process now: it scores the
    // waiting jobs first (src/daily_search_scoring.py), reads the found boards first and beside the employer sites (owner, 26 Oct 2026: "START A JOB
    // SEARCH WITH SEARCHING ON GOOGLE!"; src/sources/boards_first.py, boards_ahead.py) and discovers the fixed boards' employers beside them.
    onLine('Searching job boards…');   // the same two lines as before: the live log, its chips and the pill read them (renderer/find-card-model.js, run-status.js)
    onLine('Checking employer career pages' + (ai ? ', then reading and scoring new jobs…' : '…'));
    ({code, result} = await step(dailyArgs(storage, {mode, budget, discoverBeside: true}), SEARCH.what, SEARCH.counts));
  }
  if (scout && left() < STEP_MIN_S) timeUp(SCOUT.what, SCOUT.counts);   // still due: the next press runs it
  else if (scout) {
    onLine('Searching wider…');
    storage.saveSettings({lastScoutAt: new Date().toISOString()});
    await step(['src', 'scout', ...(deliveryReady(storage) ? ['--send'] : []), '--log-run', '--budget', String(left())], SCOUT.what, SCOUT.counts);
  }
  return {code, result, endedByTime};
}
