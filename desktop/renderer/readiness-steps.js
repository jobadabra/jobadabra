// The steps of one Apply readiness check of a job, each with its own seconds, kept per job for the drawer: the one owner of that log (jobs-triage.js writes it, the drawer reads it).
// Why (14 Nov 2026, #4325, owner: "I should have * Getting started * Reading the form ... Each of them with seconds of how much it took. and then I should see the end result, the outcome";
// chose "Plain steps + seconds (Recommended)"; asked via AskUserQuestion, "Yes, store it (Recommended)": the log survives a restart). Timed here for the live list; the app times its own copy and stores it with the check (lib/readiness-step-log.js).
import {t} from '../i18n/index.js';

/** Each step the app or the dialog names -> its words' key (helperTail). The read's later steps (judging, planning) read as "Reading the form", so they join that line. */
export const STEP_KEYS = {ready: 'triageStepReady', drafting: 'triageStepDrafting', opening: 'triageStepOpening', looking: 'triageStepLooking', pressing: 'triageStepPressing',
  landed: 'triageStepLanded', judging: 'triageStepLooking', planning: 'triageStepLooking', matching: 'triageStepMatching'};
const kept = new Map();   // job url -> [{step, ms}] of its last check

/** A new log for one job's check, at `now` (ms): it starts on "Getting started". */
export const startSteps = (url, now) => ({url, steps: [], current: 'ready', at: now});

/**
 * Moves a log on to `step` at `now`: the step before it is finished with its seconds. A step with no words, or one that reads the same as the current one, changes nothing.
 * Returns true when the log moved. Invariant: `steps` holds finished steps in order; `current` is the one running (null once the log ended).
 */
export function moveStep(log, step, now) {
  if (!log?.current || !STEP_KEYS[step] || STEP_KEYS[step] === STEP_KEYS[log.current]) return false;
  log.steps.push({step: log.current, ms: Math.max(0, now - log.at)});
  Object.assign(log, {current: step, at: now});
  return true;
}

/** Ends a log at `now` (its running step is finished) and, unless `keep` is false (a read Stop cut short), keeps it as the job's last check. */
export function endSteps(log, now, {keep = true} = {}) {
  if (!log?.current) return;
  log.steps.push({step: log.current, ms: Math.max(0, now - log.at)});
  log.current = null;
  if (keep) kept.set(log.url, log.steps);
}

/** Adds one finished step to a job's kept log (the check's one question match runs after every read is in). */
export function addStep(url, step, ms) {
  if (!STEP_KEYS[step]) return;
  kept.set(url, [...(kept.get(url) || []), {step, ms: Math.max(0, ms)}]);
}

/** One finished step as the person reads it: "✓ Reading the form · 8 s" (the dialog's list; the one place the line's shape lives). */
export const stepText = (words, seconds) => `✓ ${words} · ${t('helperTail.triageStepSeconds', {count: seconds})}`;

/**
 * A job's last check as lines: [{words, seconds}] in order. This window's log first, else `stored` (the steps kept with the stored check, so they survive a restart); a step this app does not name is
 * left out. [] when there is neither.
 */
export const stepsOf = (url, stored = []) => (kept.get(url) || (Array.isArray(stored) ? stored : [])).filter(item => STEP_KEYS[item?.step])
  .map(({step, ms}) => ({words: t(`helperTail.${STEP_KEYS[step]}`), seconds: Math.round(Math.max(0, Number(ms) || 0) / 1000)}));
