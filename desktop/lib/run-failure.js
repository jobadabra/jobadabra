// What a finished engine run reports as failed (a pure move out of telemetry-handlers.js so the ask gate can use the same verdict without that file's imports).
/** The engine's exit code for one job it stopped on purpose, its reason the last ⚠️ line (src/ai/kit.py JOB_STOPPED): not a failed run. */
export const JOB_STOPPED = 3;
const ZERO_COUNT = /\b0 (?:failed|skipped)\b/gi;   // "0 failed" is a count, not an error line (src/warning_lines.py ZERO, the same rule)
// What a run that did not end with 0 reports as failed, or null for a run the person or the app ended on purpose.
// Design (se, 4 Nov 2026; the 20 Oct fix came back as Sentry APP-4X, 3D and 7 Windows ones): a run ends in one of four ways, and only two of them are failures.
//   finished by itself      -> exit 0: no report here; non-zero: run_failed, with its error line
//   ended by the watchdog   -> run_failed ("stopped by the app: no output for N min"): a hang is a real problem
//   ended by the app on purpose (Stop, quit, restart, the press's 3 minutes) -> never a failure, whatever exit code the OS gave it
//   ended from outside the app (no exit code)                  -> never a failure
// The OS code of a stop is not a verdict (Windows taskkill /F gives 1, the engine's own SIGTERM handler 143), so the caller says who ended the run (`stopped`, lib/pipeline-run.js).
// 20 Oct 2026: such runs were reported as failed with their last ordinary line as the "error" ("Enriched 100 of 100 job(s); 0 failed", "Shared 0 employer feeds…").
// Why (7 Nov 2026, Sentry 4H 4W 4R 4T 4J 4Q): a non-zero exit with no error line is labelled "exit N, no error line", never by the last ORDINARY line (that put six titles on one unexplained exit). The tail stays in the event as data.
// It is the label, not the cause: the exit's cause waits for an event carrying `code` (lib/sentry.js runExtra).
// Guard: test/unit/main/telemetry-run-end.test.js.
/** The `run_failed` report of a run that did not end with 0, or null when it was not a failure. Takes {code (exit code or null), timedOut (the watchdog's reason or ''), stopped (the app ended it on purpose), tail (its last log lines), errorKind (a private run's error type)}; returns {error, timedOut?, cutOff}. Its data comes from lib/pipeline-run.js's close handler. Never throws. */
export function runFailure({code, timedOut, stopped = false, tail = [], errorKind = ''}) {
  if (!timedOut && (code === null || stopped || code === JOB_STOPPED)) return null;
  const error = timedOut ? `stopped by the app: ${timedOut}` : [...tail].reverse().find(line => /error|exception|traceback|failed|refused/i.test(String(line).replace(ZERO_COUNT, ''))) || errorKind || `exit ${code}, no error line`;   // errorKind: a run whose output is private (a store call) has no tail (Sentry 2C)
  return {error, ...(timedOut ? {timedOut} : {}), cutOff: /cut off|max_tokens|Unterminated string/i.test(tail.join(' '))};
}
