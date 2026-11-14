// The drawer's Apply readiness buttons that go to the answers queue ("Add it", "Answer it", "Fix all N in the queue"): the job's missing questions are put in the queue first (the main process,
// lib/queue-job-missing.js), then the queue's own drawer (pages/question-review.js) opens at the one asked for; when it closes the job's stored check is read again and the job's drawer comes back on Apply readiness.
// Why (14 Nov 2026, #4325, owner: "make it easy for him to fix all the issues so that all jobs/forms can be fully automated" · "Either using the answers queue"). The drawer imports no page (arch-check
// no-circular), so renderer/app.js (which nothing imports) hands this to job-drawer/drawer-actions.js. Guard: integration/app/screen-apply-readiness-actions.test.js.
import {keyOf} from '../question-filter.js';
import {nextPart} from '../job-drawer/drawer-actions.js';
import {loadQuestions, questionsNow} from './jobs-questions.js';
import {openQuestionReview} from './question-review.js';
import {openJobPanel} from './job-panel.js';
import {setRead} from './jobs-triage.js';

/** The queue row (of drawer `queue`) that holds `label`: a Your details item by its fact, a question by its words or one of its other wordings. -> its key or ''. */
export function keyFor(now, queue, label) {
  const same = text => keyOf(text) === keyOf(label);
  const row = (now[queue] || []).find(each => (queue === 'details' ? same(each.details?.fact || '') : same(each.question) || (each.also || []).some(other => same(other.question))));
  return row?.key || '';
}

let latest = '';   // the job whose queue was opened last: only it may bring its drawer back (Gitar on #4394: an earlier job's close must not open its drawer over a newer job's)

/** After the queue closes: the job's stored check is compared with what was just saved (no browser), and its drawer comes back on Apply readiness unless another screen took over. */
async function back(job, {away}) {
  const read = await Promise.resolve().then(() => window.pilot.applyReadinessStored(job)).catch(() => null);
  if (read && typeof read === 'object') setRead(job.url, read);
  if (away || latest !== job.url) return;
  nextPart.set(job.url, 'readiness');
  openJobPanel(job, 'application');
}

/**
 * Opens the queue for a job's missing items: `queue` 'details' | 'learned', `labels` the to-dos' labels in that drawer (a row button: its one label; Fix all: the job's items of the first drawer).
 * The queue opens scoped to this job's questions (question-review.js `scope`), on the first of them (a row button: that exact one). When the job's last one is answered the finish card offers "Back to Apply readiness" (re-reads the stored check) or "Continue with the other questions" (the global queue). A label the queue does
 * not hold (set aside, "Don't keep") is left out; none held = nothing opens and the job's check is read again.
 * Design (14 Nov 2026, owner: "Simple: open the queue at this job's first item (Recommended)" · "Close and return to the job (Recommended)"): one scope, no chain; the other drawer is one more press. Refined (owner, 14 Nov 2026): "The queue should have only the questions on this particular job" · "return back to the job apply readiness. or continue with other (general) questions".
 */
export async function openReadinessQueue(job, {queue, labels}) {
  latest = job.url;
  const queued = await Promise.resolve().then(() => window.pilot.queueJobMissing(job)).catch(error => ({ok: false, reason: String(error?.message || error)}));   // written before the queue is read
  if (queued?.skipped?.length) window.pilot?.uiLog?.('readiness: questions with no stored verdict were not queued', String(queued.skipped.length));   // counts only, never the questions
  if (!queued?.ok) window.pilot?.uiLog?.('readiness: the job\'s questions were not added to the queue', String(queued?.reason || queued?.error || 'refused').slice(0, 200));   // the queue still opens as it is, never claiming the items are in it
  await loadQuestions({force: true});
  const keys = labels.map(label => keyFor(questionsNow(), queue, label)).filter(Boolean);
  // Why (14 Nov 2026, #4401 Gitar): nothing asked for is in the queue (set aside, "Don't keep"): open nothing and read the check again, so the drawer shows what is still missing; never the whole queue.
  if (!keys.length) { window.pilot?.uiLog?.('readiness: none of the job\'s items is in the queue', String(labels.length)); await back(job, {away: false}); return; }
  await openQuestionReview({queue, start: keys[0] || '', jobKeys: keys, onClose: closed => back(job, closed)});
}
