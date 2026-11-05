// The runs "Send feedback" describes, each with the warning lines the Activity page itself shows for it (renderer/run-warnings.js runWarningLines): one reader of "what a run warned", so the bundle and the screen cannot disagree. lib/feedback-bundle.js (which imports nothing) filters what may leave.
import {runWarningLines} from '../renderer/run-warnings.js';
import {WARN_RUNS} from './feedback-bundle.js';

/** -> the runs, the newest WARN_RUNS each with `warningLines` (its log and report lines that are warnings, each once; unfiltered: lib/feedback-bundle.js decides what leaves). */
export const withWarningLines = runs => (Array.isArray(runs) ? runs : []).map((run, index) => (index < WARN_RUNS ? {...run, warningLines: runWarningLines(run)} : run));
