// The Full automation night's answers to the extension (cloud runner task `auto`; spec docs/superpowers/specs/2026-11-08-cloud-browser-runner-design.md, "auto"; owner, 10 Nov 2026: "Build it now (Recommended)"):
// the calls the Mac's hidden browser makes to lib/background-apply-controller.js (poll, the form judge's proof, `ready`, `manual`) and lib/server-pages.js (the confirmation), answered for ONE job at a time
// from the batch's own item. The press goes only through submit-gate.js, after the site reserved the job's one attempt. The judges are the Mac's own (lib/form-judge.js, lib/confirmation-judge.js), their model calls through the site.
// Invariants: one outcome per job, the first one decided wins; after the attempt is reserved only a confirmed receipt is `submitted` and anything else is `unknown` (the person checks the employer's page), never "not sent".
// Guard: desktop/test/unit/ready-fill/auto-night.test.js; the gate's own guard desktop/test/guards/safety/cloud-submit-gate.test.js.
import {createHash, randomUUID} from 'node:crypto';
import {judgePage} from '../../desktop/lib/confirmation-judge.js';   // in the image: /desktop/lib, reached by the same path from /night
import {judgeForm} from '../../desktop/lib/form-judge.js';
import {sessionTabUrl} from '../../desktop/lib/session-tab.js';
import {proofOk} from '../../desktop/lib/submit-proof.js';
import {gateSubmit} from './submit-gate.js';

export const AUTO_OWNER = 'night-auto';   // the auto night's backgroundOwner: the extension polls with it, and nothing else is answered
export const PRESS_WINDOW_MS = 30000;   // Why (10 Nov 2026, cs 3/4): the net lets the job's own pages send for this long after a permit: past the extension's own 20 s receipt watch (submit-watch.js SUBMIT_WAIT_MS)
const JUDGMENT_MS = 120000;   // a form judgment is good for 2 minutes, as on the Mac (background-apply-controller.js judgment)

/**
 * The line of one auto night. `client` is the model client (night-ai.mjs siteClient); `reserve(jobId)` asks the site for the job's one attempt; `stopped()` asks the site whether this job was stopped (a failed ask
 * is not a Stop: the site's reserve refuses a stopped job all the same);
 * `sentAt` is when the site received the batch. judge, confirm, gate, now and uuid are injectable for tests.
 * -> {begin(job), background(body), formJudge(body), confirmation(body), blocked(status), stop(), outcome(), end(state, why), abandon(), pressing(), until(), dueAt(), attempt(), proof()}.
 */
export function createAutoLine({client, reserve, stopped = async () => false, sentAt, judge = judgeForm, confirm = judgePage, gate = gateSubmit, now = Date.now, uuid = randomUUID}) {
  let job = null, at = {}, queue = Promise.resolve();
  const judgments = new Map();
  const mine = context => !!job && context?.owner === AUTO_OWNER && context.session === job.item?.session;
  // The job's one outcome: the first decided stays. After a reserved attempt nothing but a receipt is `submitted`, and a refusal becomes `unknown`.
  // Why (10 Nov 2026, cs 3/4 review): an end decided while /reserve is in flight waits for its answer (`ending`), so a press the site reserved is never reported "not sent".
  const endOf = (own, state, why) => {
    if (own.outcome) return own.outcome;
    if (own.reserving) { own.ending ||= {state, why}; return null; }
    const pressed = !!own.attempt && state !== 'submitted';
    own.outcome = {state: pressed ? 'unknown' : state, why: String(why || '').slice(0, 40)};
    return own.outcome;
  };
  const end = (state, why) => endOf(at, state, why);
  const handOver = (why, reason = 'needs_user') => { end('not_submitted', why); return {ok: true, manual: true, reason}; };
  // Why (10 Nov 2026, cs 3/4 review): one `ready` at a time, as the Mac's controller (serial()): two overlapping ones raced the reservation and fixed the wrong outcome.
  const serial = fn => { const run = queue.then(fn); queue = run.catch(() => {}); return run; };

  async function ready(body) {
    const job_ = job, own = at, live = () => at === own && !own.outcome && !own.ending;
    if (!live() || own.attempt) return {ok: false};   // after the press only its receipt (or the deadline) decides
    const judged = judgments.get(body.proof);
    if (!judged || now() - judged.at > JUDGMENT_MS) return {ok: false, recheck: true};
    judgments.delete(body.proof);
    const proof = {...judged.answer, signature: judged.signature, page: judged.page, requiredComplete: body.requiredComplete === true, factsOnly: body.factsOnly === true, safe: body.safe === true && judged.answer.confidence >= 0.9};
    own.proof = proof;
    if (proof.botCheck) return handOver('bot_check', 'captcha_runtime');   // words-ok: our own hand-off reason id, not page knowledge
    if (proof.step === 'middle') return proof.answer === 'ready' && proof.requiredComplete && proof.safe ? {ok: true, continue: true} : handOver('incomplete_or_uncertain');
    // Why (10 Nov 2026, cs 3/4): as the Mac's store (background-apply-store.js ready): a page judged ready again with another signature starts its wait again.
    if (proofOk(proof) && (proof.signature !== own.signature || !own.readyAt)) { own.signature = proof.signature; own.readyAt = now(); }
    // A Stop the site heard ends the job unreported, as a stopped fill. The site's /reserve takes only a live row, so a Stop that crosses this check still never presses.
    const stop = own.stopped || await stopped().catch(() => false);
    if (stop && at === own) { stopOf(own); return {ok: true, manual: true, reason: 'stopped'}; }
    if (!live()) return {ok: false};
    own.reserving = true;
    let verdict;
    try {
      verdict = await gate({task: 'auto', job: {id: job_.id, url: job_.url, session: job_.item?.session}, item: job_.item, sentAt, stopped: false, proof,
        readySignature: own.signature, readyAt: own.readyAt, stage: job_.stage, kit: {eligible: job_.eligible}, status: own.status, attempted: false, now: now()}, {reserve});
    } finally { own.reserving = false; }
    if (verdict.submit) own.attempt = verdict.attempt;
    // The job ended, was stopped or was left while the site answered: no permit; a reserved attempt makes its outcome `unknown`.
    const ending = own.ending || (own.stopped && {state: 'not_submitted', why: 'stopped'}) || (at !== own && {state: 'not_submitted', why: 'left'});
    if (ending || own.outcome) { endOf(own, ending?.state || 'not_submitted', ending?.why || 'ended'); return {ok: true, manual: true, reason: 'needs_user'}; }
    if (verdict.submit) { own.until = now() + PRESS_WINDOW_MS; return {ok: true, submit: true, attempt: verdict.attempt, control: verdict.control, signature: verdict.signature}; }
    if (verdict.reason === 'waiting') { own.dueAt = verdict.dueAt; own.checked = false; return {ok: true, submit: false}; }
    return handOver(verdict.reason);
  }
  // A Stop: nothing is pressed from now on. -> true when it ended the job before any press (nothing to report); after a reservation it changes nothing.
  function stopOf(own) {
    own.stopped = true;
    if (own.attempt || own.reserving) return false;
    own.outcome ||= {state: 'stopped', why: 'stopped'};
    return own.outcome.state === 'stopped';
  }

  return {
    /** The next job of the line: everything about the one before is forgotten. `job` is the batch's ({id, url, item, stage, eligible}). */
    begin(next) { job = next; at = {commanded: false}; judgments.clear(); },
    /** POST /extension/background-apply: the poll (this job's tab, then its due recheck) and the job's own actions. */
    async background(body) {
      if (!job || body?.owner !== AUTO_OWNER) return {ok: false};
      if (body.action === 'poll') {
        const jobs = !at.commanded && !at.outcome ? [{session: job.item?.session, url: sessionTabUrl(job.url, job.item?.session), mode: 'auto'}] : [];
        at.commanded = true;
        const due = !at.outcome && !at.attempt && at.dueAt && now() >= at.dueAt && !at.checked;
        if (due) at.checked = true;
        return {ok: true, jobs, checks: due ? [{session: job.item?.session}] : [], handoffs: [], closes: []};
      }
      if (!mine(body)) return {ok: false};
      if (body.action === 'manual') return handOver(String(body.reason || 'needs_user'), String(body.reason || 'needs_user').slice(0, 80));
      if (body.action === 'ready' && !at.outcome) return serial(() => ready(body));
      return {ok: false};
    },
    /** POST /extension/account-judge: the form phase of this job's tab is judged by the Mac's form judge, with its proof kept for `ready`; every other phase answers nothing, as the fill night does. */
    async formJudge(body) {
      if (body?.phase !== 'form' || !mine(body.background)) return {};
      const answer = await judge(client, body.sketch || {});
      if (answer.error) return {ok: true, answer: '', error: answer.error};
      const proof = uuid(), signature = createHash('sha256').update(JSON.stringify(body.sketch || {})).digest('hex');
      judgments.set(proof, {answer, signature, page: String(body.sketch?.url || ''), at: now()});   // page: the address the judge saw, for the send gate (lib/submit-proof.js sendAllowedAt)
      return {ok: true, answer: answer.answer, needs: answer.needs, needsKind: answer.needsKind || '', botCheck: answer.botCheck,
        ...(typeof answer.loginWall === 'boolean' ? {loginWall: answer.loginWall} : {}), ...(typeof answer.accountCreation === 'boolean' ? {accountCreation: answer.accountCreation} : {}),
        step: answer.step || 'unsure', nextControl: answer.nextControl || '', submitControl: answer.submitControl || '', confidence: answer.confidence || 0, blockedKind: answer.blockedKind || '', background: {proof, signature}};
    },
    /** POST /extension/confirmation: the page after this job's press, judged by the Mac's confirmation judge; only this job's own reserved attempt can be confirmed. */
    async confirmation(body) {
      if (!mine(body?.background) || !at.attempt || body.background.attempt !== at.attempt) return {ok: false, confirmation: false, error: 'No matching submission attempt.'};
      const verdict = await confirm(client, {url: body.page || '', title: body.title, headings: body.headings, text: body.text, inputs: body.inputs});
      if (verdict.botCheck) return {ok: true, confirmation: false, manual: true, reason: 'captcha_runtime'};   // words-ok: our own hand-off reason id, not page knowledge
      if (!verdict.confirmation) return {ok: true, confirmation: false, error: verdict.error || ''};
      end('submitted', 'receipt');
      return {ok: true, confirmation: true};
    },
    /** The page answered 401, 403 or 429: before the press the job ends there, no retry; after it the receipt decides (no receipt is `unknown`). */
    blocked(status) { at.status = Number(status); if (!at.attempt) end('not_submitted', 'blocked_status'); },
    /** The owner stopped this job on the site: nothing is pressed from now on. -> true when it was stopped before any press (nothing to report). */
    stop: () => stopOf(at),
    /** The job's outcome ({state, why}) once decided, else null (also while a reservation is in flight). A deadline the runner sets ends it with end(). */
    outcome: () => at.outcome || null,
    end,
    /** True while this job's permit lets its own pages send (the net's one way through). */
    pressing: () => !!at.attempt && now() < (at.until || 0),
    /** When this job's permit ends (ms), or 0: the runner waits that long for the receipt. */
    until: () => at.until || 0,
    /** When a waiting job's recheck is due (ms), or 0 once it was handed out. */
    dueAt: () => (at.outcome || at.attempt || at.checked ? 0 : at.dueAt || 0),
    /** A reservation the site never answered: the job ends `unknown` and gets no permit when the answer comes late. */
    abandon() { at.reserving = false; at.ending = null; endOf(at, 'unknown', 'reserve_unanswered'); },
    attempt: () => at.attempt || '',
    /** The page's own proof as the site keeps it: no field value. */
    proof: () => (at.proof ? {signature: at.proof.signature || '', submitControl: at.proof.submitControl || '', requiredComplete: at.proof.requiredComplete === true, botCheck: typeof at.proof.botCheck === 'boolean' ? at.proof.botCheck : null} : null),
  };
}
