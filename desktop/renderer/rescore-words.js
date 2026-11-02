// The words of Strategy's "scored using previous search settings" notice and its Re-score dialog, kept free of the DOM so the tests can check them
// (pages/strategy-rescore.js draws them). Guarded by test/strategy-rescore.test.js.
export const jobs = count => `${count} job${count === 1 ? '' : 's'}`;
export const noticeTitle = count => `${jobs(count)} ${count === 1 ? 'was' : 'were'} scored using previous search settings.`;
export const reasonsText = ({method = 0, places = 0} = {}) =>
  [method && `${jobs(method)}: an older way of scoring`, places && `${jobs(places)}: other places than your current ones`].filter(Boolean).join(' · ');
export const dialogLead = count => `They are scored again with your current settings, with AI, once. A search starts now and scores up to 60 of them${
  count > 60 ? '; the rest in the next searches' : ''}. Cost: not calculated. Your applications and their stages are not changed.`;


// Jobs' call to action, its card and the "Score first" dialog (owner, 2 Nov 2026: "a very visible call to action on the jobs list to rescore", "the old scored
// still there", "pressing Find jobs should open a dialog saying: Score first"). The same counter and the same sentence as Strategy's notice (noticeTitle),
// so the two screens never say different things.
export const callHint = 'Your old scores stay on the list, marked, until each new one arrives.';
/** The Jobs call's button, from the count: "Re-score 12 jobs". */
export const callButton = count => `Re-score ${jobs(count)}`;
/** The re-score card's title, from the count: "Re-scoring 12 jobs". */
export const rescoringTitle = count => `Re-scoring ${jobs(count)}`;
export const rescoringLead = 'Up to 60 in this search, the rest in the next ones. Your old scores stay until each new one arrives. Follow it in Recent activity.';
export const staleLabel = 'Old score';
export const staleTip = 'Scored using previous search settings. Re-score to update it.';
export const scoreFirstTitle = 'Score first';
/** The Score first dialog's text, from the count: Strategy's own sentence, why it matters for new jobs, then the cost line ("Cost: not calculated"). */
export const scoreFirstLead = count => `${noticeTitle(count)} New jobs would be ranked against old scores. ${dialogLead(count)}`;
export const scoreFirstSkip = 'Find jobs without re-scoring';
