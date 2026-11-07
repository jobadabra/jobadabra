// The runs "Send feedback" describes, each with the warning lines the Activity page itself shows for it (renderer/run-warnings.js runWarningLines): one reader of "what a run warned", so the bundle and the screen cannot disagree. lib/feedback-bundle.js (which imports nothing) filters what may leave.
import {runWarningLines} from '../renderer/run-warnings.js';
import {notionReason} from '../renderer/notion-reason.js';
import {WARN_RUNS} from './feedback-bundle.js';

const withReason = text => { const reason = notionReason(text); return reason ? {text, reason} : text; };

/** -> the runs, the newest WARN_RUNS each with `warningLines` (its log and report lines that are warnings, each once; unfiltered: lib/feedback-bundle.js decides what leaves).
 *  A line Notion refused with a known reason is `{text, reason}`: the strict reason (renderer/notion-reason.js, the Activity page's function) is made here because the bundle imports nothing. */
export const withWarningLines = runs => (Array.isArray(runs) ? runs : []).map((run, index) => (index < WARN_RUNS ? {...run, warningLines: runWarningLines(run).map(withReason)} : run));
