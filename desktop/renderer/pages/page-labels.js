// Display-only application stage labels preserve stored identifiers and unknown user values.
import '../../i18n/screens-pages.js';
import {t} from '../../i18n/index.js';
const stages = {
  'Recruiter lead': 'pagesJobsFinal.recruiterLead', Saved: 'pagesJobs.saved', 'Kit ready': 'pagesJobs.saved',
  Applying: 'pagesFinalLabels.applying', Applied: 'pagesExtraCommon.applied',
  'Confirmation received': 'pagesStages.confirmation', Screening: 'pagesExtraCommon.screening',
  'Interview scheduled': 'pagesJobs.interviewScheduled', Interviewing: 'pagesStages.interviewing',
  Offer: 'pagesExtraCommon.offer', Rejected: 'pagesExtraCommon.rejected',
  'No response': 'pagesStages.noResponse', Withdrawn: 'pagesStages.withdrawn',
  Closed: 'pagesControlStatus.closed', Dismissed: 'pagesControlStatus.dismissed',
};
/** Translate known stage names only at display boundaries, preserving unknown values. */
export const stageName = stage => Object.hasOwn(stages, stage) ? t(stages[stage]) : stage;
