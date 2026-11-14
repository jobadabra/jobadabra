// Puts what a job's stored Apply readiness check found missing into the answers queue, so the drawer's "Add it" / "Answer it" / "Fix all" always have the questions to open on.
// Why (14 Nov 2026, #4325, owner: "make it easy for him to fix all the issues so that all jobs/forms can be fully automated" · "Either using the answers queue"): readiness reads a form without
// filling it, so no fill ever offered its questions to the queue ("Seen twice", lib/question-verdicts.js judge, stays as it is for fills). This is the ONE other way in, one press on one job:
// a missing question is written as a ❓ line with the fill's own writer (lib/questions.js collect) and marked as blocking this job (verdicts.record), which also puts a Your details
// fact at the front of Fill your details (lib/missing-facts.js pick: a blocking fact is asked at once). Never a second queue.
import {keyOf} from '../renderer/question-filter.js';

/**
 * Queues the missing items of `job`'s stored check. `check` = (job) => the stored check or null (lib/apply-readiness.js storedCheck, which compares the saved details again, no browser).
 * Idempotent: a question already on the answers page is not added twice, and a job already marked as blocked by a question is not counted again.
 * -> {ok, items: [{kind, label}] (what the check still lacks), added: lines written, skipped: asked questions with no stored verdict, so not marked}. {ok: false, reason: 'no check'} when the job has none stored (the drawer then offers Check again).
 */
export async function queueMissing(storage, job, {check, questions, verdicts, fetcher} = {}) {
  const url = String(job?.url || ''), company = String(job?.company || '');
  const read = url ? await check({...job, url}).catch(() => null) : null;
  const missing = (read?.match?.missing || []).filter(item => item?.label);
  if (!read) return {ok: false, reason: 'no check', items: [], added: 0};
  const known = verdicts.cached(storage);
  // Why (14 Nov 2026, Gitar on #4394): only an item that carries the full question the form asked is queued; a stored check from before `asked` existed (or with its label cut) has none, and a guess from the
  // label would not match the verdict (keyOf) nor the line a fill writes later. storedCheck re-matches such a check from its stored questions first, so this is the rare leftover.
  const withAsked = missing.filter(item => item.asked);
  const asked = [...new Set(withAsked.map(item => item.asked))];
  const fresh = asked.filter(label => !(known[keyOf(label)]?.jobs || []).some(each => each.url === url));
  const trace = withAsked.filter(item => item.kind === 'answer').map(item => ({label: item.asked, required: true, reason: questions.NO_ANSWER}));
  const added = trace.length ? await questions.collect(storage, {trace}, company, fetcher, null, null, null) : 0;
  const skipped = fresh.filter(label => !known[keyOf(label)]);   // a verdict the store no longer holds (its cap) cannot be marked: said, never silently "queued" (Gitar on #4396)
  if (fresh.length) verdicts.record(storage, fresh, {url, company});
  return {ok: true, items: missing.map(({kind, label}) => ({kind, label})), added, skipped};
}
