// Canonical per-application background state through the existing store interface; reserve a submit once before any browser click.
import {call as engineCall} from './store/engine.js';
import {KIT_SECTION, kitOf} from './store/kit-section.js';
import {randomUUID} from 'node:crypto';
import {canStart, STARTABLE_STAGES} from './apply-eligibility.js';
import {backgroundWaitNow} from './background-apply-clock.js';
import {AUTO_DEFAULTS} from '../renderer/apply-settings-model.js';
import {kitAllows, proofOk, sendAllowedAt} from './submit-proof.js';   // the page's proof and kit eligibility, one definition with the cloud browser's Submit gate (ready-fill/submit-gate.js)

export const BACKGROUND_SECTION = 'Background Apply';
const RESERVED = 'Background submit reserved';
const TERMINAL = new Set(['manual_submit_required', 'needs_user_handoff', 'receipt_confirmed', 'submitting']);
// Why (10 Nov 2026, cs 4/4, owner: "Phased: A now"): an item the cloud holds can still press, so it is not TERMINAL (queue() still refuses another mode over it), but the Mac's own claim, ready, checkpoint and reserve never act on it.
const HELD = new Set([...TERMINAL, 'cloud']);
const BEFORE_PRESS = new Set(['queued', 'preflight', 'filling', 'ready_for_review', 'waiting_to_submit']);   // a job still on its way to a press: a quit hands it over (interrupted)
// The hand-offs that end a run with nothing left to settle: the person's Stop or Cancel, a quit before the press, a mode change, a page with no form to reach (8 Nov 2026). Applying again starts a new run.
// Every other reason stays with the person (a bot check, an unknown or reserved press, a form taken to their own browser, where they may have submitted it).
const FINISHED_REASONS = new Set(['stopped', 'cancelled', 'app_closed', 'app_updated', 'mode_changed', 'no_form']);   // words-ok: our own hand-off reason ids, not page knowledge
/** Pure: true when `state` is a hand-off that ended its run with nothing left to settle and no press reserved, so applying again starts a new run. */
export const finishedHandoff = state => state?.state === 'needs_user_handoff' && !state.attempt && FINISHED_REASONS.has(state.reason);
const readState = text => { try { const state = JSON.parse(text || '{}'); return state?.version === 1 ? state : null; } catch { return null; } };

const NO_APPLICATION = 'no_application';   // the code of `appOf`'s error: no Application record, so nothing can ever be written for the job
/** Build a serialized controller over Applications sections/events; failed store writes reject before any launch or submit is authorized. */
export function createBackgroundApplyStore(storage, {call = engineCall, now = backgroundWaitNow, realNow = Date.now, uuid = randomUUID, stopped = () => false} = {}) {
  let tail = Promise.resolve();
  const serial = work => { const result = tail.then(work); tail = result.catch(() => {}); return result; };
  const ask = (entity, method, args = {}) => call(storage, entity, method, args);
  const appOf = async url => { const app = await ask('applications', 'get', {url}); if (!app) throw Object.assign(new Error('This job has no Application record. Press Apply on it first.'), {code: NO_APPLICATION}); return app; };
  const load = async app => readState(await ask('applications', 'section', {app_id: app.id, name: BACKGROUND_SECTION}));
  const save = async (app, state) => { await ask('applications', 'set_section', {app_id: app.id, name: BACKGROUND_SECTION, markdown: JSON.stringify(state)}); return state; };
  const own = (state, session, owner) => !!state && state.session === session && state.owner === owner;
  const manual = (app, state, reason) => save(app, {...state, state: reason.startsWith('captcha_') ? 'manual_submit_required' : 'needs_user_handoff', manualOverride: true, reason, handoffAt: now()});   // words-ok: our own hand-off reason id / user-facing word, not page knowledge

  async function read(url) { return load(await appOf(url)); }
  // Whether the run the store holds for this job ended without an answer (Stop, Cancel, a quit or an update before the press) and starts afresh when the person applies again, in ANY mode.
  // Why (7 Nov 2026, owner's HYPE session): only the hidden-browser path asked; Apply in Chrome reopened a tab into the ended run's session, so one card showed two truths. One rule, asked by both.
  // A Stop after the reservation keeps no attempt on the state (it saves the state from before it), so the reservation events are read too.
  async function endedRun(app, old) {
    return !!old && finishedHandoff(old) && !(await ask('events', 'list', {kind: RESERVED})).some(event => event.app_id === app.id);
  }
  /** -> whether the run held for this job's address ended without an answer, so a new application starts afresh (never a CAPTCHA or an unknown-submit hand-off, which stay with the person). */
  async function ended(url) {
    return serial(async () => { const app = await appOf(url); return endedRun(app, await load(app)); });
  }
  async function queue(url, session, mode, config) {
    return serial(async () => {
      if (!['fill', 'auto'].includes(mode)) throw new Error('Unknown background Apply mode');
      const app = await appOf(url), old = await load(app);
      // Why (2026-10-27, owner; 5 Nov 2026, owner's screenshot): reapplying or changing modes never resets a job's CAPTCHA or unknown-submit handoff (7 Nov 2026, #3363: except a live Full automation item that could still press, refused for another mode below); any other finished
      // hand-off (Stop, Cancel, a quit or update before the press) starts a new run, or the job came back as "Needs you · Try again" in its old mode and never launched.
      // The test itself is `endedRun` above, shared with Apply in Chrome (7 Nov 2026), so both modes treat an ended run the same way.
      if (old && !(await endedRun(app, old))) {
        // Why (7 Nov 2026, #3363, code review): a live Full automation item that can still press is not answered for a batch naming another mode: it would submit while the new batch says Fill. Refused, the person stops it first. One already handed over (CAPTCHA, Stop) or ended presses nothing, so it is returned as before.
        if (old.mode === 'auto' && mode !== 'auto' && !old.manualOverride && !TERMINAL.has(old.state)) throw Object.assign(new Error('This job is already queued for Full automation. Stop or cancel it in Sessions first.'), {code: 'LIVE_AUTO'});
        return old;
      }
      if (!(mode === 'auto' ? STARTABLE_STAGES.includes(app.stage) : canStart(app.stage))) throw Object.assign(new Error('This job is not eligible to start another application.'), {code: 'NOT_ELIGIBLE'});   // the picker's rule too (lib/apply-eligibility.js); Full automation is as strict as its submit gate: a job with no stage never queues
      if (!config?.chosenAt || config.mode !== mode) throw new Error('Confirm this Apply mode in Settings first.');
      return save(app, {version: 1, session, mode, chosenAt: config.chosenAt, allowIneligible: config.allowIneligible === true, ...(mode === 'auto' ? {autoConfirmedAt: config.autoConfirmedAt || ''} : {}), state: 'queued', owner: '', manualOverride: false, queuedAt: realNow()});   // Why (7 Nov 2026, owner, #3363): a batch keeps its confirmation and eligibility choice on its item.
    });
  }
  async function claim(url, session, owner) {
    return serial(async () => {
      const app = await appOf(url), state = await load(app);
      if (!owner || !state || state.session !== session || state.manualOverride || state.state === 'cloud' || (state.owner && state.owner !== owner)) return {ok: false};
      if (state.state !== 'queued') return {ok: own(state, session, owner), state};
      const next = await save(app, {...state, owner, state: 'preflight', launchedAt: now()});
      return {ok: true, state: next};
    });
  }
  async function handoff(url, session, owner, reason = 'needs_user') {
    return serial(async () => {
      const app = await appOf(url), state = await load(app);
      // Why (2026-10-28, bot review #2324): a queued job has no owner yet; Stop or a mode change must still hand it over, or a later poll fills what the person stopped.
      if (!state || state.session !== session || (state.owner && state.owner !== owner) || state.state === 'receipt_confirmed') return {ok: false};
      return state.manualOverride ? state : manual(app, state, String(reason).slice(0, 80));
    });
  }
  async function ready(url, session, owner, proof) {
    return serial(async () => {
      const app = await appOf(url), state = await load(app);
      if (!own(state, session, owner)) return {ok: false};
      if (HELD.has(state.state)) return state;
      if (!proofOk(proof)) return manual(app, state, proof?.botCheck ? 'captcha_runtime' : 'incomplete_or_uncertain');   // words-ok: our own hand-off reason id / user-facing word, not page knowledge
      const changed = state.signature !== proof.signature;
      return save(app, {...state, state: state.mode === 'fill' ? 'ready_for_review' : 'waiting_to_submit', signature: proof.signature, submitControl: proof.submitControl,
        readyAt: changed || !state.readyAt ? now() : state.readyAt, factsOnly: proof.factsOnly === true && state.factsUnknown !== true});
    });
  }
  async function checkpoint(url, session, owner, proof) {
    return serial(async () => {
      const app = await appOf(url), state = await load(app);
      if (!own(state, session, owner)) return {ok: false};
      if (HELD.has(state.state)) return state;
      if (proof?.answer !== 'ready' || proof.step !== 'middle' || proof.requiredComplete !== true || proof.safe !== true) return manual(app, state, 'incomplete_or_uncertain');
      return save(app, {...state, state: 'filling', factsUnknown: state.factsUnknown === true || proof.factsOnly !== true});
    });
  }
  async function reserve(url, session, owner, proof, config) {
    return serial(async () => {
      const app = await appOf(url), state = await load(app);
      const deny = reason => ({submit: false, reason, state: state?.state || ''});
      if (!own(state, session, owner) || state.mode !== 'auto' || state.manualOverride || HELD.has(state.state)) return deny('manual_or_already_attempted');
      const stop = async reason => { const next = await manual(app, state, reason); return {submit: false, reason, state: next.state}; };
      // Why (7 Nov 2026, owner, #3363): the item's own mode and confirmation decide, not what Settings says now; an item queued without a confirmation (an older build) is handed over, never pressed.
      if (state.mode !== 'auto' || !state.chosenAt || !state.autoConfirmedAt) return stop('mode_changed_or_not_opted_in');
      if (!sendAllowedAt(url, proof?.page)) return stop('send_not_allowed_here');   // LinkedIn, queued or landed on: filled to ready, the person sends (lib/submit-proof.js sendAllowedAt)
      if (!proofOk(proof) || proof.signature !== state.signature) return stop('page_changed_or_incomplete');
      if (proof.botCheck !== false) return stop('bot_check_unknown');   // Why (2026-10-28, owner: add bot_check to the form judge): only an explicit "no robot check" from the judge lets the automatic press go; a check, or no word about it, is the person's
      const checks = config.auto || {};   // Why (2026-10-29, owner: "remove all checks"): no facts, fit or limit gate here; the wait, the page's proof and the kit's eligibility stay
      const kit = kitOf(await ask('applications', 'section', {app_id: app.id, name: KIT_SECTION}));
      if (!kitAllows({stage: app.stage, kit, allowIneligible: state.allowIneligible})) return stop('not_eligible');   // Why (2026-11-07, owner): stage proof always applies; only explicit false is overridden by this item's saved opt-in (lib/submit-proof.js).
      const waitMs = Math.max(0, Number(checks.waitMin ?? AUTO_DEFAULTS.waitMin)) * 60000;
      if (!state.readyAt || now() < state.readyAt + waitMs) return {...deny('waiting'), dueAt: state.readyAt + waitMs};
      const reservations = await ask('events', 'list', {kind: RESERVED});
      if (reservations.some(event => event.app_id === app.id)) return stop('attempt_already_reserved');
      if (stopped()) return stop('stopped');
      const attempt = uuid();
      // Why (2026-10-27, owner): reserve before the click; a crash or lost reply consumes the attempt and never creates a retry (the daily and per-employer limits are gone, 29 Oct 2026).
      await ask('events', 'add', {app_id: app.id, kind: RESERVED, at: new Date(now()).toISOString(), source: 'Full automation', source_id: `background:${session}:${attempt}`, changes: {session, attempt}});
      const next = await save(app, {...state, state: 'submitting', attempt, submittedAt: now()});
      if (stopped()) return stop('stopped');
      return {submit: true, attempt, state: next.state, control: proof.submitControl, signature: proof.signature};
    });
  }
  async function receipt(url, session, attempt, confirmed) {
    return serial(async () => {
      const app = await appOf(url), state = await load(app);
      if (!state || state.session !== session || !attempt || state.attempt !== attempt || !state.submittedAt) return {ok: false};
      if (confirmed !== true) return manual(app, state, 'submission_outcome_unknown');
      return save(app, {...state, state: 'receipt_confirmed', receiptAt: now()});
    });
  }
  /**
   * A press the app's quit cut off: the job is still `submitting` with no receipt, and the hidden browser that pressed it died with the app, so nothing will ever read the site's reply.
   * Hands it to the person as `submission_outcome_unknown` ("check whether it went through") whichever browser owned it; the attempt stays used, so it is never reserved again.
   * `afterMs` (default 0): only a press older than that is handed over, for a reply that never came with the app still open (the extension closed); a younger press may still be answered.
   * `quit`: the job was held by an earlier run of the app; any state before the press (queued, filling, ready for review, waiting) is handed over too, as `app_closed`, or `app_updated` when `updated` (this start is the first of a new version).
   * Why (30 Oct 2026, owner: "A quit is a Stop"): #2598's restart step saw Full automation press 80 s after a restart on the wait the quit cut off, through the reused hidden browser.
   * Returns the saved state, or null when this session's job is not mid-press or not old enough (another session's record is never touched).
   */
  async function interrupted(url, session, {afterMs = 0, quit = false, updated = false} = {}) {
    return serial(async () => {
      const app = await appOf(url), state = await load(app);
      if (!state || state.session !== session) return null;
      if (quit && !state.manualOverride && BEFORE_PRESS.has(state.state)) return manual(app, state, updated ? 'app_updated' : 'app_closed');   // Why (7 Nov 2026, owner: his update restarted the app, he closed nothing): an update restart says so   // words-ok: our own hand-off reason id, not page knowledge
      if (state.state !== 'submitting' || state.receiptAt) return null;
      if (afterMs && now() - (state.submittedAt || 0) < afterMs) return null;
      return manual(app, state, 'submission_outcome_unknown');
    });
  }
  async function humanReceipt(url, session, owner, pressedAt) {
    return serial(async () => {
      const app = await appOf(url), state = await load(app);
      if (!own(state, session, owner) || !Number.isFinite(pressedAt) || pressedAt < state.queuedAt || realNow() - pressedAt > 15 * 60000) return {ok: false};
      return save(app, {...state, state: 'receipt_confirmed', humanSubmittedAt: pressedAt, receiptAt: realNow()});
    });
  }
  /**
   * cs 4/4 (model A): hands an item that has not pressed to the cloud. -> the saved `cloud` state, or null when it cannot press any more (handed over, pressed, receipt), is not Full automation, or is another session's.
   * The item keeps its own stamp (mode, chosenAt, autoConfirmedAt); the Mac then never claims, readies or reserves it again, and the next start's quit sweep leaves it (state is not BEFORE_PRESS).
   */
  async function sendToCloud(url, session) {
    return serial(async () => {
      const app = await appOf(url), state = await load(app);
      if (!state || state.session !== session || state.mode !== 'auto' || state.manualOverride || !BEFORE_PRESS.has(state.state)) return null;
      return save(app, {...state, state: 'cloud', was: state.state, cloudAt: realNow()});
    });
  }
  /** cs 4/4: a send that failed puts the item back where it was (the Mac stays on at a lock or sleep and goes on, a quit hands it over at the next start as before). -> the restored state, or null (not a cloud item). */
  async function unsend(url, session) {
    return serial(async () => {
      const app = await appOf(url), state = await load(app);
      if (!state || state.session !== session || state.state !== 'cloud' || !BEFORE_PRESS.has(state.was)) return null;
      const {was, cloudAt: _sentAt, ...rest} = state;
      return save(app, {...rest, state: was});
    });
  }
  /**
   * cs 4/4: the site's outcome for a `cloud` item ({state: submitted | not_submitted | unknown | failed, attempt, reason}). submitted is a receipt; unknown is "check whether it went through"; anything else
   * keeps the site's reason for the person. -> the saved state, or null (another session, a receipt already, not a cloud item). A press (submitted, unknown) after the person's Stop is still recorded
   * (the Stop and the press crossed): never hidden; a refusal after a Stop changes nothing.
   */
  async function fromCloud(url, session, outcome) {
    return serial(async () => {
      const app = await appOf(url), state = await load(app);
      if (!state || state.session !== session || state.receiptAt) return null;
      const pressed = ['submitted', 'unknown'].includes(outcome?.state);
      if (state.state !== 'cloud' && !(pressed && state.state === 'needs_user_handoff' && !state.attempt && state.cloudAt > 0)) return null;
      if (outcome.state === 'submitted') return save(app, {...state, state: 'receipt_confirmed', manualOverride: false, via: 'cloud', cloudAttempt: String(outcome.attempt || '').slice(0, 80), receiptAt: realNow()});
      return manual(app, state, outcome.state === 'unknown' ? 'submission_outcome_unknown' : String(outcome?.reason || 'needs_user').slice(0, 80));
    });
  }
  /** Whether a store error says the job has no Application record: nothing can ever be written for it, so a caller treats the item as gone, not as a failure to retry. A method, not an import, so lib/background-apply-cloud.js does not import this module (arch no-circular). */
  const noApplication = error => error?.code === NO_APPLICATION;
  return {queue, ended, claim, handoff, ready, checkpoint, reserve, receipt, interrupted, humanReceipt, sendToCloud, unsend, fromCloud, read, noApplication};
}
