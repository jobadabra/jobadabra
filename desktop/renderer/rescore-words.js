// The words of Strategy's "scored using previous search settings" notice and its Re-score dialog, kept free of the DOM so the tests can check them
// (pages/strategy-rescore.js draws them). Guarded by test/unit/renderer/strategy-rescore.test.js.
import '../i18n/screens-helpers.js';
import {t} from '../i18n/index.js';
/** Format a job count using the display locale plural rules. */
export const jobs = count => t('helperFlow.jobsCount', {count});
/** Describe the count of old scores without changing those scores or starting a re-score. */
export const noticeTitle = count => t('helperFlow.scoresOld', {count, jobs: jobs(count)});
/** The notice's "why" line from the engine's counts ({method, places, changed}): "4 jobs: an older way of scoring · 9 jobs: other places..."; '' when all are 0. */
export const reasonsText = ({method = 0, places = 0, changed = 0} = {}) =>
  [method && t('helperFlow.rescoreMethod', {jobs: jobs(method)}), places && t('helperFlow.rescorePlaces', {jobs: jobs(places)}),
    changed && t('helperFlow.rescoreChanged', {jobs: jobs(changed)})].filter(Boolean).join(' · ');
/** The Re-score dialog's text from the count of old scores: what a press does (up to 60 now, press again for the rest), that Find jobs never re-scores them, the cost line. */
export const dialogLead = count => t('helperFlow.rescoreLead', {rest: count > 60 ? t('helperFlow.rescoreRest') : ''});


// Jobs' call to action, its card and the "Score first" dialog (owner, 2 Nov 2026: "a very visible call to action on the jobs list to rescore", "the old scored
// still there", "pressing Find jobs should open a dialog saying: Score first"). The same counter and the same sentence as Strategy's notice (noticeTitle),
// so the two screens never say different things.
export const callHint = t('helperFlow.rescoreCallHint');
/** What one press does, on every Re-score button (owner, 3 Nov 2026: "Re-score 60 now"): a press scores at most 60, so 100 old scores say "Re-score 60 now", 12 say "Re-score 12". */
export const pressLabel = count => count > 60 ? t('helperFlow.rescore60') : t('helperFlow.rescoreCount', {count});
export const callButton = pressLabel;
/** The re-score card's title, from the count: "Re-scoring 12 jobs". */
export const rescoringTitle = count => t('helperFlow.rescoring', {jobs: jobs(count)});
export const rescoringLead = t('helperFlow.rescoringLead');
export const staleTip = t('helperFlow.oldScoreTip');
export const scoreFirstTitle = t('helperFlow.scoreFirst');
/** The Score first dialog's text, from the count: Strategy's own sentence, why it matters for new jobs, then the cost line ("Cost: not calculated"). */
export const scoreFirstLead = count => t('helperFlow.scoreFirstLead', {notice: noticeTitle(count), lead: dialogLead(count)});
export const scoreFirstSkip = t('helperFlow.findWithoutRescore');
