import '../i18n/screens-helpers.js';
import {t} from '../i18n/index.js';
// What one Jobs row (the list and the Board card) draws for a job: the parts that fit the job's state and where it came from. Pure, no DOM.
// Guarded by: test/unit/renderer/job-row-model.test.js (every filter's rows) and integration/app/screen-jobs-inbound.test.js (the tester's screen).
// Why (2 Nov 2026, owner: "why the jobs list are showing in such a broken state?", a Windows tester's Inbound list): a job you applied to, a
// rejection and a recruiter's reply all said "Not checked" and "Not scored" (words about a job still waiting for your decision), a rejection
// said a bare "Unclear", and a reply with no employer drew a red "!" logo. One place decides what a row draws; the renderers only draw it.
import {isInbound} from './origin.js';
import {SENT} from './jobs-view.js';

/** What a slot says when this job has nothing to put in it (owner, 2 Nov 2026: "for the content we're missing, we should add N/A"). */
export const NA = 'N/A';

// A candidate is a job you may still apply to: not applied, not dismissed, not in an application stage, and nobody wrote to you about it.
// Only a candidate has an apply read ("Not checked") and a fit it waits for ("Not scored"); the others have what happened to them.
const isCandidate = job => !isInbound(job) && !SENT.has(job.stage) && job.status !== 'applied' && job.status !== 'dismissed' && job.stage !== 'Dismissed' && job.stage !== 'Closed';

// The rejection review's verdict in words that stand alone (src/ai/rejection.py VERDICTS); "Unclear" alone says nothing.
/** Label an original rejection verdict without rewriting its content. */
export const rejectionWords = verdict => (verdict === 'Unclear' ? t('helperTail.rejectionUnclear') : t('helperTail.whyRejected', {verdict}));

/**
 * The row's parts for one job. Every row has the same slots (an inbound reply is built like a job match: owner, 2 Nov 2026, "there should not be much
 * difference between inbound jobs and normal jobs"); a slot with nothing to say says N/A. Returns {candidate, triage, fit, who, rejection}:
 * triage: true = the apply read ("Not checked" until read), only for a candidate; false = the slot says N/A (nothing to apply to);
 * fit: true = the score ring (a score, or the wait for one), for a candidate or any scored job; false = the ring says N/A;
 * who: {name, blank} the employer, else (an opportunity that found you) the sender's agency or company; no name = a blank avatar and N/A;
 * rejection: the chip's words, or ''.
 */
export function rowModel(job) {
  const candidate = isCandidate(job);
  const name = (job.company || (isInbound(job) ? job.via : '') || '').trim();
  return {candidate, triage: candidate, fit: candidate || job.fit != null, who: {name: name || NA, blank: !name}, rejection: job.rejection ? rejectionWords(job.rejection) : ''};
}
