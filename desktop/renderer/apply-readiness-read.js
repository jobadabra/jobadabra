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

/**
 * One press on one job (Apply on a row, Redraft on the Profile page) through Apply readiness: its kit, then its form check, with the kit's own notices shown (`say`).
 * → the kit's answer ({ok, error?, ineligible?}), or the gate the step lifted to the top (the store, a move) for the caller's refusal line. `redraft` drafts a kit even when the job has one.
 * Why (8 Nov 2026, owner, R2: "every Apply goes through Apply readiness"): the row's Apply drafted the kit on its own path (the old prepareKit call) and never read the form first.
 */
export async function kitThroughStep(pilot, job, {redraft = false} = {}) {
  const done = await pilot.applyReadiness({url: job.url, code: job.code, title: `${job.title} · ${job.company}`, kit: redraft ? false : job.kit === true, posted_at: job.posted_at}, {say: true});
  return done?.kit || done || {ok: false};
}

/**
 * Which read a Jobs row holds after the list was read again: `held` is the read this window has, `check` the stored check the row now carries (lib/apply-readiness.js rowCheck).
 * A read made in this window (no `stored` flag) wins; a stored read follows the list, so a posting that changed drops its old check. Returns the read to hold, or null for none. Pure.
 * Why (#3997 review): the held stored read was never replaced or dropped, so a changed posting kept its old "Needs you" line and "Account needed" chip until a restart.
 */
export function heldAfterList(held, check) {
  if (held && held.stored !== true) return held;
  return check || null;
}
