// The words of Strategy's "scored using previous search settings" notice and its Re-score dialog, kept free of the DOM so the tests can check them
// (pages/strategy-rescore.js draws them). Guarded by test/strategy-rescore.test.js.
export const jobs = count => `${count} job${count === 1 ? '' : 's'}`;
export const noticeTitle = count => `${jobs(count)} ${count === 1 ? 'was' : 'were'} scored using previous search settings.`;
/** The notice's "why" line from the engine's counts ({method, places, changed}): "4 jobs: an older way of scoring · 9 jobs: other places..."; '' when all are 0. */
export const reasonsText = ({method = 0, places = 0, changed = 0} = {}) =>
  [method && `${jobs(method)}: an older way of scoring`, places && `${jobs(places)}: other places than your current ones`,
    changed && `${jobs(changed)}: the posting or your Profile changed since the score`].filter(Boolean).join(' · ');
/** The Re-score dialog's text from the count of old scores: what a press does (up to 60 now, press again for the rest), that Find jobs never re-scores them, the cost line. */
export const dialogLead = count => `They are scored again with your current settings, with AI, once. A re-score starts now and scores up to 60 of them${
  count > 60 ? '; press Re-score again for the rest' : ''}. Finding new jobs never re-scores them. Cost: not calculated. Your applications and their stages are not changed.`;


// Jobs' call to action, its card and the "Score first" dialog (owner, 2 Nov 2026: "a very visible call to action on the jobs list to rescore", "the old scored
// still there", "pressing Find jobs should open a dialog saying: Score first"). The same counter and the same sentence as Strategy's notice (noticeTitle),
// so the two screens never say different things.
export const callHint = 'Your old scores stay on the list, marked, until each new one arrives.';
/** What one press does, on every Re-score button (owner, 3 Nov 2026: "Re-score 60 now"): a press scores at most 60, so 100 old scores say "Re-score 60 now", 12 say "Re-score 12". */
export const pressLabel = count => count > 60 ? 'Re-score 60 now' : `Re-score ${count}`;
export const callButton = pressLabel;
/** The re-score card's title, from the count: "Re-scoring 12 jobs". */
export const rescoringTitle = count => `Re-scoring ${jobs(count)}`;
export const rescoringLead = 'Up to 60 in this re-score; press Re-score again for the rest. Your old scores stay until each new one arrives. Follow it in Recent activity.';
export const staleLabel = 'Old score';
export const staleTip = 'Scored using previous search settings. Re-score to update it.';
export const scoreFirstTitle = 'Score first';
/** The Score first dialog's text, from the count: Strategy's own sentence, why it matters for new jobs, then the cost line ("Cost: not calculated"). */
export const scoreFirstLead = count => `${noticeTitle(count)} New jobs would be ranked against old scores. ${dialogLead(count)}`;
export const scoreFirstSkip = 'Find jobs without re-scoring';
