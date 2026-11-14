// The drawer's Apply readiness buttons that go to the answers queue ("Add it", "Answer it", "Fix all N in the queue"): the job's missing questions are put in the queue first (the main process,
// lib/queue-job-missing.js), then the queue's own drawer (pages/question-review.js) opens on them; when it closes the job's stored check is read again and the job's drawer comes back on Apply readiness.
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

/** After the queue closes: the job's stored check is compared with what was just saved (no browser), and its drawer comes back on Apply readiness unless another screen took over. */
async function back(job, {away}) {
  const read = await Promise.resolve().then(() => window.pilot.applyReadinessStored(job)).catch(() => null);
  if (read && typeof read === 'object') setRead(job.url, read);
  if (away) return;
  nextPart.set(job.url, 'readiness');
  openJobPanel(job, 'application');
}

/**
 * Opens the queue on a job's missing items. `groups`: [{queue: 'details' | 'learned', labels}] (the to-dos' labels per drawer); `only` true = each drawer holds just those ("Fix all": one drawer after
 * the other, the next opening when the person closes the one before), false = the whole queue opens on the first of them ("Add it" / "Answer it"). A label the queue does not hold (set aside,
 * never asked) is left out; none found = the queue opens as it is.
 */
export async function openReadinessQueue(job, groups, only = false) {
  const queued = await Promise.resolve().then(() => window.pilot.queueJobMissing(job)).catch(error => ({ok: false, reason: String(error?.message || error)}));   // written before the queue is read
  if (!queued?.ok) window.pilot?.uiLog?.('readiness: the job\'s questions were not added to the queue', String(queued?.reason || queued?.error || 'refused').slice(0, 200));   // the queue still opens as it is, never claiming the job's items are in it
  await loadQuestions({force: true});
  const open = ([group, ...rest]) => {
    const keys = group.labels.map(label => keyFor(questionsNow(), group.queue, label)).filter(Boolean);
    return openQuestionReview({queue: group.queue, start: keys[0] || '', only: only && keys.length ? keys : null,
      onClose: closed => (rest.length && !closed.away ? open(rest) : back(job, closed))});
  };
  await open(groups);
}
