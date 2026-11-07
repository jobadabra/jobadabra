// A Full automation batch held for its form check, then confirmed job by job (spec docs/superpowers/specs/2026-11-07-full-automation-check-first.md). The one owner of held batches: the app's own reads decide the split.
// Invariants: only jobs the app read as simple forms AND the person saw under Full automation are queued as Full automation, under the batch's own confirmation; every other job goes down a mode
// (Background · you submit, In Chrome · you submit) or is not applied; the window may lower a job, never raise one; a held batch is answered once; Cancel, a raised list or an old hold queue nothing.
import {randomUUID} from 'node:crypto';
import {splitBatch, urlsOf} from '../renderer/apply-split.js';

/** How long a held batch waits for its check and the person's answer. Why (7 Nov 2026, spec): a dialog left longer starts over, so a confirmation never lands on an old check. */
export const HOLD_MS = 30 * 60000;

const details = job => ({url: job.url, title: job.title || '', company: job.company || ''});
// Why (7 Nov 2026, the owner's choice on the fa sketch): a job the check could not read is not applied in this batch; the person applies to it from its row.
const NOT_APPLIED = {unreadable: 'The form check could not read this form', unknown: 'The form check could not read this form', busy: "Jobadabra's browser was busy with another application", timeout: 'The form did not load in time', frame: 'The form sits in a frame the check cannot read', 'not eligible': 'Marked not eligible'};
const notApplied = reason => `${NOT_APPLIED[reason] || `The form check stopped here (${reason})`}. Not applied: apply to it from its row.`;
const notStarted = (jobs, reason) => ({ok: false, error: reason, outcomes: jobs.map(job => ({...details(job), status: 'not-started', reason}))});
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The held batches of this app. `read(job)` is one quick form check in the hidden browser (null when nothing was read; never throws), `stored(job)` the job's check prepared with its kit
 * when still fresh (null otherwise; the kit's owner decides freshness), `enqueue(jobs, mode, batch, eligibility)` the hidden browser's queue (lib/background-apply-controller.js),
 * `openInChrome(jobs)` the Standard batch opener (lib/apply.js), `chromeBlocked()` the extension gate (null when Chrome may open).
 */
export function createCheckFirst({read, stored = async () => null, enqueue, openInChrome, chromeBlocked = () => null, now = Date.now, uuid = () => randomUUID().slice(0, 8)}) {
  const plans = new Map();
  const live = id => {
    const plan = plans.get(String(id || ''));
    if (plan && now() - plan.at > HOLD_MS) plans.delete(plan.id);
    return plans.get(String(id || '')) || null;
  };
  const splitOf = plan => splitBatch(plan.jobs, url => plan.reads.get(url) || null, {allowIneligible: plan.eligibility?.allowIneligible === true});

  /**
   * Holds the chosen jobs of a Full automation batch instead of queueing them. `batch` and `eligibility` are what enqueue would have been given. Each job's fresh stored check is its read
   * at once; only the others are left for a live read. -> {ok, mode, check: {plan, jobs: [{url, title, company, read}]}, message}, `read` null for a job still to check.
   * Why (7 Nov 2026, owner: "we should have the check/practice prepared (alongside the application kit)"): the split shows at once from the check prepared with the kit; the live check runs only for what is missing.
   */
  async function hold(jobs, {batch = null, eligibility = null} = {}) {
    for (const old of [...plans.keys()]) live(old);   // an unanswered batch past its window leaves memory here
    const id = uuid(), held = jobs.map(job => ({...job})), reads = new Map();
    for (const job of held) { const ready = await Promise.resolve(stored(job)).catch(() => null); if (ready) reads.set(job.url, ready); }
    plans.set(id, {id, at: now(), jobs: held, batch, eligibility, reads});
    const left = held.filter(job => !reads.has(job.url)).length;
    return {ok: true, mode: 'auto', check: {plan: id, jobs: held.map(job => ({...details(job), read: reads.get(job.url) || null}))},
      message: left ? `Checking ${plural(left, 'form')} before anything is sent.` : 'Every form was checked with its application kit.'};
  }

  /** Checks one job of a held batch and keeps the read: the read, or null (no such batch or job, or nothing read). A read that lands after the batch ended is not kept. */
  async function readOne(id, url) {
    const plan = live(id), job = plan?.jobs.find(item => item.url === String(url || ''));
    if (!job) return null;
    const result = (await read(job)) || null;
    if (live(id) === plan) plan.reads.set(job.url, result);
    return result;
  }

  /**
   * The person's answer to the split: `autoUrls` are the jobs they saw under Full automation. The app splits again from its own reads: a job in the list that its reads do not allow
   * automatically queues nothing at all; a job they allow but the list left out is lowered to Background. Then each group is queued in its own mode. -> {ok, outcomes, message} | {ok: false, error, outcomes?}.
   */
  async function confirm(id, autoUrls = []) {
    const plan = live(id);
    if (!plan) return {ok: false, error: 'This check has ended. Nothing was queued: press Apply again.'};
    plans.delete(plan.id);   // one answer per held batch
    const split = splitOf(plan), seen = new Set((autoUrls || []).map(String)), allowed = new Set(urlsOf(split.auto));
    // Why (7 Nov 2026, spec, safety): the confirmation covers only jobs the person saw under Full automation AND the app's reads allow; a job raised past its read is a stale or forged list.
    if ([...seen].some(url => !allowed.has(url))) return {ok: false, error: 'The check changed while you looked. Nothing was queued: press Apply again.'};
    // Why (7 Nov 2026, coordinator, from ac's L2b): the window adds the missing details to a read after it, so it may show a simple form as needing details: such a job goes down to Background, never up.
    split.fill.push(...split.auto.filter(entry => !seen.has(entry.job.url)));
    split.auto = split.auto.filter(entry => seen.has(entry.job.url));
    const jobsOf = group => split[group].map(entry => entry.job), parts = [];
    if (split.auto.length) parts.push(await enqueue(jobsOf('auto'), 'auto', plan.batch, plan.eligibility));
    if (split.fill.length) parts.push(await enqueue(jobsOf('fill'), 'fill', {autoConfirmedAt: ''}, plan.eligibility));   // a batch of its own: no confirmation, so the store never presses Submit
    if (split.check.length) {
      const blocked = chromeBlocked();
      parts.push(blocked ? notStarted(jobsOf('check'), blocked.error || 'Chrome needs the Jobadabra extension first.') : await openInChrome(jobsOf('check')));
    }
    const outcomes = [...parts.flatMap(part => part?.outcomes || []), ...split.none.map(({job, reason}) => ({...details(job), status: 'skipped', reason: notApplied(reason)}))];
    const started = outcomes.filter(item => item.status === 'started').length;
    if (!started) return {ok: false, outcomes, error: parts.find(part => part && !part.ok)?.error || 'Nothing was started.'};
    return {ok: true, outcomes, message: `${plural(started, 'application')} started. Review them in Sessions.`};
  }

  /** Ends a held batch with nothing queued (Cancel, the dialog closed). -> {ok: true, held}: `held` says a live batch was ended, so its reads in flight may be stopped. */
  function cancel(id) { const held = !!live(id); plans.delete(String(id || '')); return {ok: true, held}; }

  return {hold, readOne, confirm, cancel, splitOf: id => { const plan = live(id); return plan ? splitOf(plan) : null; }};
}
