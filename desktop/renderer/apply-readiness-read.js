// The Jobs page's read of one job through Apply readiness (lib/apply-readiness.js), pure so a node test can play it.
/**
 * The Jobs page's read of one job through Apply readiness (`pilot.applyReadiness`): the check as a read (`stored` when it came from the record), a kit that could not be drafted, when no form was read either, as an unreadable read that says why,
 * null when nothing was read. A drafted kit marks the job, so the next check does not draft it again. Takes the pilot bridge and the job row; never throws past the pilot's own rejection.
 * Why (#3573 review): a kit failure was a bare "Not checked" with its reason thrown away.
 */
export async function readThroughStep(pilot, job) {
  const done = await pilot.applyReadiness({url: job.url, code: job.code, title: job.title, kit: job.kit === true, posted_at: job.posted_at});
  if (job.code && done?.kit?.ok) job.kit = true;
  if (done?.check) return {...done.check, stored: done.stored === true};
  if (done?.cancelled) return null;   // Why (8 Nov 2026, review of #3578): a Stop leaves the job "Not checked", even when its kit had failed
  return done?.kit?.ok === false ? {unreadable: true, why: 'kit'} : null;   // nothing read: the chip says the kit could not be prepared, in the person's language; the kit's own (English) reason is in app.log
}
