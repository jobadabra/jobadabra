// The two checks every automatic Submit makes, wherever it presses: the page's own proof and the kit's eligibility. One definition for the Mac's Full automation (lib/background-apply-store.js reserve)
// and the cloud browser's `auto` night (ready-fill/submit-gate.js), so the two can never disagree (spec docs/superpowers/specs/2026-11-08-cloud-browser-runner-design.md, "auto").
// Pure, no imports beyond the stage list: the cloud image carries it beside lib/apply-eligibility.js. Guard: desktop/test/guards/safety/cloud-submit-gate.test.js.
import {STARTABLE_STAGES} from './apply-eligibility.js';

/**
 * Pure: true when the form judge's proof says the page may be sent: its last step, every required field filled, safe, a named sending control and a page signature.
 * The bot check is not read here: each caller refuses anything but an explicit `botCheck: false` with its own reason.
 */
export function proofOk(proof) {
  return proof?.answer === 'ready' && proof.step === 'final' && proof.requiredComplete === true && proof.safe === true &&
    typeof proof.submitControl === 'string' && !!proof.submitControl.trim() && typeof proof.signature === 'string' && !!proof.signature;
}

/**
 * Pure: true when the kit lets an automatic Submit go. The job's stage must be one an application starts from; the kit must say eligible, or say explicitly NOT eligible with the item's own opt-in
 * ("Apply to jobs marked not eligible"). Unknown eligibility is never an explicit ineligible verdict, so it never passes.
 * Why (2026-11-07, owner): stage proof always applies; only an explicit false is overridden by this item's saved opt-in.
 */
export function kitAllows({stage, kit, allowIneligible}) {
  if (!STARTABLE_STAGES.includes(stage)) return false;
  return kit?.eligible === true || (allowIneligible === true && kit?.eligible === false);
}

/**
 * Pure: may an automatic press send on the job at `url`, with no LinkedIn turn asked? Not on LinkedIn, and not on an address that cannot be read. The person's own Submit press is not an
 * automatic press and is never asked here.
 * Why (14 Nov 2026, owner, plan 4b-1): the cloud browser never sends on LinkedIn, since the LinkedIn sign-in stays on the computer (owner, 13 Nov 2026: "lets' keep Linkedin and Google
 * sessions/credentials windows/mac only"); the Mac's gate asks LinkedIn's own turn instead (lib/background-apply-store.js reserve, lib/easy-apply-limits.js sendTurn).
 */
export function sendAllowedOn(url) {
  try { new URL(String(url)); } catch { return false; }   // no readable address: no press
  return !linkedinAddress(url);
}

/** Pure: is the job's address on LinkedIn (linkedin.com or a subdomain)? An address that cannot be read is not. The one LinkedIn address rule: the send gate and Easy Apply's batches (lib/easy-apply-batch.js). */
export function linkedinAddress(url) {
  let host = '';
  try { host = new URL(String(url)).hostname.toLowerCase(); } catch { return false; }
  return host === 'linkedin.com' || host.endsWith('.linkedin.com');   // words-ok: a safety gate (CLAUDE.md "safety is code"), not page knowledge
}

/**
 * Pure: may an automatic press send here? Both the address the job was queued with and the page's own address when the judge looked (`page`, from the judge's sketch) must allow it, so a
 * short link or a redirect that lands on LinkedIn is refused too (Gitar on #4054). A proof without a page address is judged on the queued address alone.
 * @param {string} url the job's queued address
 * @param {string} [page] the page's address the form judge saw
 * @returns {boolean}
 */
export const sendAllowedAt = (url, page) => sendAllowedOn(url) && (!page || sendAllowedOn(page));
