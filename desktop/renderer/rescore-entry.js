// The Jobs bar's "old scores" row (owner, 5 Nov 2026: "let's move this into this card"): the yellow notice "N jobs were scored using previous search settings" with its Re-score
// button, now one more row of the summary card beside Cover letter and Fill your details. Free of the DOM so the tests can check it; the count is pages/rescore-run.js's (the one
// state), the words rescore-words.js's (the same sentence as Strategy's notice), the button pages/focus-suggestions.js RUN.rescore. Guarded by test/unit/renderer/rescore-entry.test.js.
import {callHint, noticeTitle, pressLabel} from './rescore-words.js';

export const RESCORE_KEY = 'rescore:stale';

/** The row for `count` old scores, [] when none or while a re-score runs (its own card says so); the row's shape is question-entries.js's `row`. No Not now: an old score is not a suggestion to dismiss. */
export function rescoreEntries({count = 0, running = false} = {}) {
  if (!(count > 0) || running) return [];
  return [{kind: 'rescore', home: 'jobs', topic: 'applying', source: 'Old scores', evidence: [], answers: [], blocking: false, key: RESCORE_KEY,
    title: noticeTitle(count), short: `${count} old score${count === 1 ? '' : 's'}`, detail: callHint, actions: [{label: pressLabel(count), do: 'rescore', count}]}];
}
