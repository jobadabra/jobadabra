// The step log of Apply readiness checks, timed in the app: lib/apply-readiness.js stores it in the SAME write as the check it timed, so it can never sit beside another check's outcome.
// Why (14 Nov 2026, #4360, owner chose "One write (Recommended)" after Gitar's 4th finding on #4325's second writer, keepSteps): the window timed the steps and a second save attached them to whatever check was stored.
// Invariants: a log belongs to one job url until `finish` or `drop`; steps are finished in order; at most MAX_STEPS are kept; a step name is one the window has words for (renderer/readiness-steps.js).

const MAX_STEPS = 8;
const SAME_WORDS = {judging: 'looking', planning: 'looking'};   // the read's later steps read as "Reading the form": no second line (the window's table says the same)
const KNOWN = new Set(['ready', 'drafting', 'opening', 'looking', 'pressing', 'landed', 'matching']);
const lineOf = step => SAME_WORDS[step] || step;

/**
 * Per-job step logs timed by `now()` (ms). start(url) opens one on "ready"; move(url, step) finishes the running step and begins `step` (an unknown step, the same line again or a job with no log change nothing);
 * finish(url, extra) ends it and returns [{step, ms}] (extra: finished steps to append, e.g. the match's share); drop(url) forgets it. Never throws.
 */
export function createStepLogs(now = Date.now) {
  const logs = new Map();   // url -> {steps: [{step, ms}], current, at}
  const close = (log, at) => log.steps.push({step: log.current, ms: Math.max(0, Math.round(at - log.at))});
  return {
    start: url => { logs.set(url, {steps: [], current: 'ready', at: now()}); },
    move(url, step) {
      const log = logs.get(url);
      if (!log || !KNOWN.has(lineOf(step)) || lineOf(step) === log.current) return false;
      const at = now();
      close(log, at);
      Object.assign(log, {current: lineOf(step), at});
      return true;
    },
    finish(url, extra = []) {
      const log = logs.get(url);
      if (!log) return undefined;
      close(log, now());
      logs.delete(url);
      return [...log.steps, ...extra.filter(item => KNOWN.has(item.step))].slice(0, MAX_STEPS).map(({step, ms}) => ({step, ms: Math.min(600000, Math.max(0, Math.round(ms)))}));
    },
    drop: url => { logs.delete(url); },
  };
}
