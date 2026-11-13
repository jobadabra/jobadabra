// The one place the cloud browser may press Submit: the `auto` task of the cloud runner (spec docs/superpowers/specs/2026-11-08-cloud-browser-runner-design.md, "auto"; owner, 10 Nov 2026: "Build it now (Recommended)").
// It presses only for task `auto`, only with the queued item's OWN stamped confirmation (never a saved setting), only on the page's own proof and the kit's eligibility (lib/submit-proof.js, shared with the Mac),
// and only after the site reserved the job's one attempt (no retry, the ~500 a day ceiling). `readiness` and `fill` never reach it: they keep no-submit.mjs as their net.
// Invariants: every refusal but `waiting` is final (the job goes back to the person, never tried again); a reservation that fails or throws never presses. Guard: desktop/test/guards/safety/cloud-submit-gate.test.js.
import {kitAllows, proofOk, sendAllowedAt} from '../../desktop/lib/submit-proof.js';   // in the image: /desktop/lib, reached by the same path from /night
// Why (10 Nov 2026, cs 1/4): a .js file, unlike its .mjs neighbours: the site's image copies every desktop/ready-fill/*.mjs and its test follows their imports, so an .mjs gate would turn the site red before cs 2/4 adds
// lib/submit-proof.js to the image. cs 2/4 copies this file by name.

export const BLOCKED_STATUS = Object.freeze([401, 403, 429]);   // the page refused us: that job ends, no retry (CLAUDE.md "Safety")
export const ITEM_HOURS = 24;   // Why (10 Nov 2026): the site keeps a batch 24 h from when it arrived (jobadabra-web api/ready.js KEEP_HOURS); an item older than its batch is not one the person sent for this night
const SKEW_MS = 60000;   // Why (10 Nov 2026, cs 1/4): the Mac's own allowance for a stamp's clock (renderer/apply-settings-model.js batchConfirmation, the same literal: the renderer may not import this file)
const HOUR = 3600000;

const timeOf = value => (typeof value === 'number' ? value : Date.parse(String(value ?? '')));
// The item states a press may still come from: queued on the Mac, then sent to the site. A Stop, Cancel all or hand-off writes another state or manualOverride (lib/background-apply-store.js) and ends it.
export const LIVE_STATES = Object.freeze(['queued', 'cloud']);

/**
 * Pure: '' when `item` is this job's own confirmed, live Full automation item, otherwise the refusal reason.
 * `job` is what the night is about to press ({id, url, session}); `item` is the confirmation the Mac sent with it ({job, url, session, state, manualOverride, mode, chosenAt, autoConfirmedAt, queuedAt, waitMin}).
 * `sentAt` is when the site received the batch (its own clock, not the Mac's): the item is good for that batch's 24 h.
 * A stamp must be a time, not in the future, and no later than the item's queueing (one written after it was not the one it was queued under); an item is this job's (id and address, both present) and this queue's (session).
 */
export function stampRefusal(job, item, now, sentAt) {
  if (!item || item.mode !== 'auto' || !item.chosenAt || !item.autoConfirmedAt) return 'not_confirmed';
  if (item.manualOverride === true || !LIVE_STATES.includes(item.state)) return 'stopped_or_handed_off';   // Stop or Cancel all is how a batch ends (CLAUDE.md "Safety"), in the cloud too
  if (!item.job || !item.url || !item.session || item.job !== job?.id || item.url !== job?.url || item.session !== job?.session) return 'other_item_stamp';
  const stamped = timeOf(item.autoConfirmedAt), queued = timeOf(item.queuedAt), sent = timeOf(sentAt);
  if (!Number.isFinite(stamped) || !Number.isFinite(queued) || stamped > now + SKEW_MS || stamped > queued + SKEW_MS || queued > now + SKEW_MS) return 'stale_stamp';
  if (!Number.isFinite(sent) || sent > now + SKEW_MS || now - sent > ITEM_HOURS * HOUR) return 'stale_stamp';
  return '';
}

/**
 * Pure: may the night press Submit on this page now? Inputs: task; job ({id, url, session}); item (the queued confirmation, above); sentAt (above); stopped (the site said this job was stopped); proof (the form judge's, as on the Mac);
 * readySignature (the page's signature when the judge first said ready: a page that changed since is not pressed); readyAt (ms, when it said ready); stage and kit (sent with the item); status (the last HTTP status the page
 * answered); attempted (this job already had its press). -> {submit: true} or {submit: false, reason, final}. `final` false only for `waiting` (the item's own wait), with dueAt.
 */
export function submitVerdict({task, job, item, sentAt, stopped = false, proof, readySignature, readyAt, stage, kit, status, attempted = false, now = Date.now()}) {
  const no = reason => ({submit: false, reason, final: true});
  if (task !== 'auto') return no('not_auto');
  const stamp = stampRefusal(job, item, now, sentAt);
  if (stamp) return no(stamp);
  if (stopped) return no('stopped_or_handed_off');
  if (BLOCKED_STATUS.includes(Number(status))) return no('blocked_status');
  if (attempted) return no('attempt_already_reserved');
  if (!sendAllowedAt(job.url, proof?.page)) return no('send_not_allowed_here');   // LinkedIn never sends from the cloud (its session stays on the computer) nor before plan 4b
  if (!proofOk(proof) || proof.signature !== readySignature || typeof readyAt !== 'number' || !Number.isFinite(readyAt)) return no('page_changed_or_incomplete');
  if (proof.botCheck !== false) return no('bot_check_unknown');   // only the judge's explicit "no robot check" lets the press go, as on the Mac
  if (!kitAllows({stage, kit, allowIneligible: item.allowIneligible})) return no('not_eligible');
  // Why (10 Nov 2026, code review of cs 1/4): the Mac reads the wait from Settings at press time; with the Mac off the item carries it, and an item without one is refused, never pressed at once on a default.
  if (typeof item.waitMin !== 'number' || !Number.isFinite(item.waitMin) || item.waitMin < 0) return no('item_incomplete');
  const waitMs = item.waitMin * 60000;
  if (now < readyAt + waitMs) return {submit: false, reason: 'waiting', final: false, dueAt: readyAt + waitMs};
  return {submit: true};
}

/**
 * The gate: the verdict, then the job's one attempt reserved at the site BEFORE the press (the site takes it in one statement and counts it toward the day's ceiling).
 * `reserve(jobId)` -> {ok: true, attempt} or {ok: false, error}. A refused or failed reservation never presses.
 * -> {submit: true, attempt, control, signature} (the permit: press `control` once) or {submit: false, reason, final}.
 */
export async function gateSubmit(input, {reserve}) {
  const verdict = submitVerdict(input);
  if (!verdict.submit) return verdict;
  const taken = await Promise.resolve().then(() => reserve(input.job.id)).catch(() => null);
  if (!taken?.ok || !taken.attempt) return {submit: false, reason: taken?.error === 'ceiling' ? 'ceiling' : taken?.error === 'already' ? 'attempt_already_reserved' : 'reserve_failed', final: true};
  return {submit: true, attempt: String(taken.attempt), control: input.proof.submitControl, signature: input.proof.signature};
}
