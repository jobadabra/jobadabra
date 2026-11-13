// The AI review of a rejected job (src/ai/rejection.py): one runner for the Jobs ⋯ menu ("Why me?") and for a rejection's feedback saved from "Add job activity".
import '../../i18n/screens-pages.js';
import {t} from '../../i18n/index.js';
import {copyField} from '../../i18n/display-copy.js';
import {jobPlace} from '../targets.js';

const running = new Set();   // job urls under review now: a second start (menu + dialog, or two saves) reads the same job once

/** True for a job whose review is due: Rejected, holding employer feedback, and no review yet (src/feedback.py save_received clears the old one). */
export const reviewDue = job => !!job && job.stage === 'Rejected' && !!job.employer_feedback && !job.rejection;

/**
 * Runs the review of `job` and says how it went with `toast` (startup.js toastMessage, handed in: this file stays below the pages that import it).
 * Calls `reload` after a good review. Returns false at once when this job is already under review. Never throws: a failure is a toast.
 */
export async function runRejectionReview(job, {toast, reload}) {
  if (!job?.url || running.has(job.url)) return false;
  running.add(job.url);
  try {
    const result = await window.pilot.reviewRejection(job.url);
    toast(result.ok ? t('pagesJobs.rejectionReviewed') : t('pagesInterviews.reviewFailed'), copyField(result, 'text'), jobPlace(job), result.ok ? 'good' : 'bad');
    if (result.ok) reload();
  } catch (error) {
    toast(t('pagesInterviews.reviewFailed'), String(error?.message || error), jobPlace(job), 'bad');
  } finally { running.delete(job.url); }
  return true;
}
