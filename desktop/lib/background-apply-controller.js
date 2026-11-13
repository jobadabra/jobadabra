// Bridge canonical background state, the actual extension and its owned browser; every submit command is a persisted one-shot reservation.
import {activityText, activityHandoff} from '../i18n/activity-notices.js';
import {randomUUID, createHash} from 'node:crypto';
import {backgroundWaitNow, onBackgroundWaitMove} from './background-apply-clock.js';
import {createBackgroundApplyStore} from './background-apply-store.js';
import {createBackgroundBrowser} from './background-browser.js';
import {createTriageReader} from './triage-reader.js';
import {applyOf, AUTO_DEFAULTS} from '../renderer/apply-settings-model.js';
import * as terminalsDefault from './terminals.js';
import {sessionTabUrl} from './session-tab.js';
import {extensionToken} from './server-env.js';
import {notify as notifyDefault, stopAsked, tellWindow} from './server-hooks.js';
import {log as appLog} from './log.js';
import {appliedMessageFor} from './applied-message.js';
import {createCloudSide} from './background-apply-cloud.js';
import {cloudAutoOf} from './cloud-auto.js';
import {waitingMessageFor} from './waiting-message.js';
import * as journal from './session-journal.js';
import {easyApplyBatch, LINKEDIN_NOTICES} from './easy-apply-batch.js';


const instances = new WeakMap();
const HANDOFF = new Set(['manual_submit_required', 'needs_user_handoff']);
const NOTICES = {captcha_preflight: 'This application needs a CAPTCHA check. Open it, solve the check and press Submit yourself.', captcha_runtime: 'This application stopped at a CAPTCHA. The same form is open for you. Solve the check and press Submit yourself.', stopped: 'Background application stopped. Review and submit this form yourself.',   // words-ok: our own hand-off reason id / user-facing word, not page knowledge
  submission_outcome_unknown: 'No confirmation of this application came back. Check whether it went through, and do not send it again until you know.',
  app_closed: 'The app was closed while it held this application, so nothing was sent. Open it, check the form and submit it yourself.',
  app_updated: 'Jobadabra updated and restarted while it held this application, so nothing was sent. Open it again to continue.',
  no_form: 'Jobadabra could not find this application\'s form, so nothing was filled or sent. Open the job and apply on the site yourself.', ...LINKEDIN_NOTICES};   // words-ok: our own hand-off reason id / user-facing word, not page knowledge
export const MAX_BACKGROUND_SESSIONS = 10;
const STATE_WORDS = {ready_for_review: 'Form filled — review the same background form and Submit', waiting_to_submit: 'Filled — waiting before automatic submission; Stop is available',
  submitting: 'Submission attempted — waiting for the site receipt', cloud: 'Handed to our cloud browser: it sends this application by itself, even with your computer off'};   // words-ok: our own state words
/** What the live step log and the card's note say for a background state (a hand-over says its reason's words). */
const stateWords = state => (HANDOFF.has(state.state) ? NOTICES[state.reason] || 'This application needs you. Review and submit the same form yourself.' : STATE_WORDS[state.state] || 'Filling in the background');

// What an Apply batch says about the jobs it did not start: not eligible (the store refused), busy (the person already has the job open in Chrome) and live (still queued for Full automation, Gitar on #3409: skipped and said, never a refusal after earlier jobs of the batch were queued).
const SKIPS = {NOT_ELIGIBLE: 'skipped', LIVE_AUTO: 'live'};   // the store's error codes that skip one job and keep the batch going
const OUTCOME_STATUS = {NOT_ELIGIBLE: 'ineligible', LIVE_AUTO: 'already-queued'};
const plural = (n, why) => `${n} job${n === 1 ? ' was' : 's were'} skipped: ${why}`;
// A batch refused before any queue row: every job 'not-started' with the refusal as its reason (the one shape enqueue and canQueue answer with).
const refusedFor = (jobs, error, extra = {}) => ({ok: false, ...extra, error, outcomes: jobs.map(job => ({url: job.url, title: job.title || '', company: job.company || '', status: 'not-started', reason: error}))});
const HELD = {opened_in_browser: 'Already open in your browser: finish it there.', other: 'This application already needs you in Sessions: finish it there.'};   // words-ok: our own hand-off reason ids
const BROWSER_MISSING = "Download Jobadabra's browser first: about 200 MB, only once.";
const skippedWords = ({skipped, busy, live}) => (skipped ? ` ${plural(skipped, 'not eligible to start another application.')}` : '')
  + (busy ? ` ${plural(busy, busy === 1 ? 'it already has an application session open.' : 'they already have an application session open.')}` : '')
  + (live ? ` ${plural(live, live === 1 ? 'it is already queued for Full automation (stop or cancel it in Sessions first).' : 'they are already queued for Full automation (stop or cancel them in Sessions first).')}` : '');
const ONLY = {
  busy: n => (n === 1 ? 'This job already has an application session. Continue that session first.' : 'These jobs already have an application session. Continue those sessions first.'),
  skipped: n => `${n === 1 ? 'This job is' : 'These jobs are'} not eligible to start another application. Pick another job in Jobs and try again.`,
  live: n => `${n === 1 ? 'This job is' : 'These jobs are'} already queued for Full automation. Stop or cancel ${n === 1 ? 'it' : 'them'} in Sessions first.`,
};
const nothingStarted = tally => {
  const kinds = Object.keys(ONLY).filter(kind => tally[kind]);
  return kinds.length === 1 ? ONLY[kinds[0]](tally[kinds[0]]) : `Nothing was started.${skippedWords(tally)}`;   // several kinds: say each count
};

/**
 * The mode and confirmation a batch is queued under, or the refusal. With `batch` ({autoConfirmedAt}) they are the call's own; without it, the saved Apply mode and its saved confirmation.
 * Why (2026-10-29, owner: "go ahead" with the switch; 7 Nov 2026, #3363): Full automation runs only after the person confirmed it, in Settings → Apply or in this very call; the window's pick alone is not enough.
 * The first-choice stamp (`chosenAt`) always comes from Settings: the gate in lib/apply-choice-gate.js stays in front of every batch.
 */
function batchSettings(saved, mode, batch) {
  const chosen = batch ? {...saved, mode, autoConfirmedAt: mode === 'auto' ? batch.autoConfirmedAt || '' : ''} : saved;
  if (mode === 'auto' && !chosen.autoConfirmedAt) return {error: batch ? 'Full automation is off until you confirm it: pick it again in Apply to jobs.' : 'Full automation is off until you confirm it in Settings → Apply.'};
  if (chosen.mode !== mode || !chosen.chosenAt) return {error: 'Confirm the saved Apply mode first.'};
  return {chosen};
}

/**
 * Runs `sweep` every `every` ms (default 30 s) and logs a failure instead of throwing; returns the function that stops it. `set` and `clear` are injectable so a test never waits for a clock.
 * Why (2026-10-29, owner): the stall sweep is the app's own timer; with the extension closed nothing else asks.
 */
export function watchStalled(sweep, {every = 30000, set = setInterval, clear = clearInterval, onError = () => {}} = {}) {
  const timer = set(() => { Promise.resolve().then(sweep).catch(onError); }, every);
  return () => clear(timer);
}
/** Return this app profile's single serialized controller; settings and store are rechecked for each proposed submit. */
const APP_STARTED = Date.now() - process.uptime() * 1000;   // when this run of the app began
const STALL_MS = 3 * 60000;   // a press with no receipt this long after it was sent is handed to the person (sweepStalled)
export function backgroundApplyFor(storage) {
  if (!instances.has(storage)) instances.set(storage, createBackgroundApplyController(storage));
  return instances.get(storage);
}
/** Create the controller with injectable store/browser boundaries for deterministic fictional browser proofs; no alternative filler exists here. */
export function createBackgroundApplyController(storage, {store = null, browser = null, terminals = terminalsDefault,
  config = () => applyOf(storage.settings()), now = backgroundWaitNow, uuid = randomUUID, stop = stopAsked, notify = (...args) => notifyDefault(...args),   // Why (2026-10-28, bot review #2324; 31 Oct 2026, owner): read the late-wired notifier live; share the gated wait clock with the store so moving it wakes the same due job
 waiting = null,   // the waiting-application message sender, injectable for tests (lib/waiting-message.js)
 applied = null,   // the applied-application mail sender, injectable for tests (lib/applied-message.js)
 log = appLog, started = APP_STARTED,   // `started`: when this run of the app began; a job held before it was cut off by a quit
  // Why (#3519, owner 7 Nov 2026: "it's very slow and doesn't give you live updates"; 8 Nov 2026, "almost no live updates"): each read's step goes to the Jobs window and to its own app.log line as it starts, and where its time went is one line at its end, so the next real run names the step it stopped at.
  reader = createTriageReader({onStep: step => { tellWindow('triageStep', step); log('apply', 'triage: read step', {url: String(step.url).split(/[?#]/)[0], step: step.step}); }, onDone: summary => log('apply', 'triage: read finished', summary)}),
  port = Number(process.env.JOBADABRA_PORT || 47111), token = () => extensionToken(storage), readSession = undefined} = {}) {   // readSession: a test's LinkedIn sign-in reader, never the Keychain
  store ||= createBackgroundApplyStore(storage, {stopped: stop, now});
  // Why (2026-10-28, CI #2324): the controller is created when the apply handlers register, before any background job exists; the browser reads storage.path, so it is built on first use.
  const browserOf = () => (browser ||= createBackgroundBrowser(storage));
  const linkedin = easyApplyBatch({storage, send: (method, params) => browserOf().send(method, params), readSession, log, now});
  // Asks the owned worker to poll now (lib/background-browser.js wake), never waited for: that poll is served on the serial turn that may have asked for it.
  // A wake that fails is logged and leaves the work to the 30 s tab report (extension/report-alarm.js), never fails what asked for it.
  const wakeBrowser = what => new Promise(resolve => resolve(browserOf().wake?.())).then(ok => { if (ok === false) log('apply', `${what}: the hidden browser did not take the wake`, {}); },
    error => log('apply', `${what}: the hidden browser could not be woken`, {error: String(error?.message || error).slice(0, 120)}));
  reader.onReady?.(() => wakeBrowser('triage'));   // a read that can be handed out (lib/triage-reader.js onReady)
  const judgments = new Map();
  const latest = new Map();   // session id -> the background state this controller last wrote or read (cache, stateForPoll)
  let owner = '', pending = Promise.resolve();
  const serial = work => { const value = pending.then(work); pending = value.catch(() => {}); return value; };
  onBackgroundWaitMove(() => serial(async () => {
    if (!owner) ({owner} = await browserOf().start({port, token: token()}));
  }));
  const cache = (item, state, decision = null) => {
    const record = terminals.record(item.id);
    if (!record || !state || state.ok === false) return;   // a store refusal is not a state: the next poll reads the store again (review of [ap] 6/7)
    latest.set(item.id, state);
    const previous = record.background?.waitDecision, before = record.background?.state;
    const verdict = previous?.reason === 'authorized' ? previous : decision || previous;
    const testClock = process.env.JOBADABRA_E2E === '1' ? {waitClockOffset: now() - Date.now(), ...(verdict ? {waitDecision: verdict} : {})} : {};
    record.background = {...testClock, mode: state.mode, state: state.state, reason: state.reason || '', readyAt: state.readyAt || 0,
      dueAt: state.mode === 'auto' && state.readyAt ? state.readyAt + (config().auto?.waitMin ?? AUTO_DEFAULTS.waitMin) * 60000 : 0, manualOverride: !!state.manualOverride};
    const words = stateWords(state);
    if (state.state !== before) journal.note(item.id, journal.backgroundStep(state.state, words));   // the live step log: each new state once (lib/session-journal.js)
    terminals.report(item.id, {event: 'note', message: words});
  };
  // A run enrolled in a batch: its live step log begins (a session the store kept from an earlier run keeps its log), then its first state.
  const begin = (item, state) => {
    if (!journal.journalOf(item.id).length) journal.start(item.id, state.mode);
    cache(item, state);
  };
  // The person who is away: the app's own notification is not enough, so the chosen e-mail and Telegram hear it too (lib/waiting-message.js: one an hour, a burst is one message).
  // It never breaks the hand-over: a failure to queue it is logged.
  const tellAway = (item, note) => {
    try {
      (waiting ||= waitingMessageFor(storage)).add({id: item.id, title: item.title, company: item.company, note, open: () => { const record = terminals.record(item.id); return !!record && !record.outcome; }});
    } catch (error) { log('apply', 'waiting message not queued', {error: error.message}); }
  };
  const itemFor = session => { const item = terminals.record(String(session || '')); return item?.background ? item : null; };
  async function markManual(item, reason) {
    const state = await store.handoff(item.url, item.id, owner, reason);
    if (state.ok === false) return state;
    cloudAutoOf(storage)?.stopFor(item.id);   // the person's Stop or Cancel reaches the cloud too: it stops that job (cs 4/4). Asked of the persisted list, not of this run's cache: after a restart nothing is cached
    cache(item, state);
    log('apply', 'background application handed to the person', {session: item.id, mode: state.mode, reason});
    const note = NOTICES[reason] || 'Review and submit this application yourself.';
    notify(activityText('needsYou'), activityHandoff(reason), {view: 'sessions', session: item.id}, 'warn');
    tellAway(item, note);
    return state;
  }
  // Why (5 Nov 2026, owner's screenshot; review of [ap] 2/7): a new run under the old record kept its Stop mark, its start time from an earlier app run and its tab's
  // reports, so the poll handed it straight back. The finished old session leaves the list and the new run is a session of its own.
  async function dropFinished(old, state) {
    if (!old || state.session === old.id) return;
    await browserOf().closeSession(old.id).catch(() => false);   // a stopped run's tab may still be open: it closes with it
    terminals.remove(old.id);
    latest.delete(old.id);
  }
  /**
   * The person pressed Apply (in Chrome) on a job whose hidden-browser run ended without an answer: that run's session leaves the list and its tab closes, so the press starts a session of its own.
   * Why (7 Nov 2026, owner's HYPE session): the Chrome path reused the ended run's session, which drew the old run's "in Jobadabra's browser" card under the new Chrome tab. Same rule as enqueue (store.ended).
   * -> whether a session was released; false when none is held or the run still holds something for the person.
   */
  async function releaseEnded(url) {
    const old = terminals.byUrl(url);
    if (!old?.background || old.outcome || !(await store.ended(url))) return false;
    await browserOf().closeSession(old.id).catch(() => false);
    terminals.remove(old.id);
    latest.delete(old.id);
    log('apply', 'an ended background run left the list: the job starts afresh', {session: old.id});
    return true;
  }
  /**
   * Queues a batch in the hidden browser. `mode` is 'fill' or 'auto'. `batch` ({autoConfirmedAt}) is the call's own pick from Apply to jobs: the batch runs in `mode` with the Full-automation
   * confirmation given in THIS call; without it the batch follows the saved Apply mode and its saved confirmation. Invariant: a batch's mode and its confirmation come from the call, never from a past save;
   * every queued item keeps them (store.queue), so a later batch or a Settings change never moves a running one. `eligibility` is the normalized setting snapshot captured before selection and drafting; queued items keep that choice even if Settings changes while kits are drafted.
   * Why (7 Nov 2026, owner, #3363: "We don't want to change the settings from the Apply to jobs"; "The batch should continue with the setting it was set once the batch has been started"): a pick in the dialog
   * is that batch's mode only, never Settings'; the person's way to stop a running batch is Stop or Cancel all.
   */
  async function enqueue(jobs, mode, batch = null, eligibility = null) {
    return serial(async () => {
      // Why (7 Nov 2026, #3424, review): a preflight refusal has no queue row; distinguish it from a failed kit so the dialog says the selected job never started; canQueue answers the same through refusedFor (fa, #3564).
      const refused = (error, extra = {}) => refusedFor(jobs, error, extra);
      const configured = batchSettings(config(), mode, batch);
      const {error} = configured;
      if (error) return refused(error);
      const chosen = eligibility ? {...configured.chosen, allowIneligible: eligibility.allowIneligible === true} : configured.chosen;
      if (!browserOf().ready()) return refused(BROWSER_MISSING, {code: 'BACKGROUND_BROWSER_MISSING'});   // before any store write, so nothing waits on a browser that is not there
      const held = terminals.list().filter(item => item.background && !item.outcome);
      if (held.length + jobs.filter(job => !terminals.byUrl(job.url)).length > MAX_BACKGROUND_SESSIONS) return refused(`At most ${MAX_BACKGROUND_SESSIONS} background forms can stay open. Finish or cancel one first.`);
      const enrolled = [], outcomes = [];
      const tally = {skipped: 0, busy: 0, live: 0};
      for (const job of jobs) {
        const old = terminals.byUrl(job.url);
        const details = {url: job.url, title: job.title || '', company: job.company || ''};
        // Why (7 Nov 2026, owner screenshot #3363; #3424): skip an already-open job with its reason and count, keep other jobs starting, and preserve the reason in the batch result.
        if (old && !old.background) { tally.busy++; outcomes.push({...details, status: 'busy', reason: 'This job already has an application session open.'}); continue; }
        // Why (2026-10-28, owner screenshot): a job the store refuses as not eligible (its stage moved on since the list was read) is skipped and said, not a thrown error that reaches the window
        // as an IPC string; the other jobs still start. Any other failure (a write, a wrong mode) stops the batch with its own words.
        let state;
        // A new id each time: the store keeps an old run (its state and session) when that run still holds something for the person, and starts a new run under this id otherwise.
        try { state = await store.queue(job.url, uuid().slice(0, 8), mode, chosen); } catch (error) {
          const kind = SKIPS[error?.code];   // Gitar on #3409: a live Full automation job is skipped and said like a not-eligible one, never a refusal after earlier jobs of the batch were queued
          const reason = String(error?.message || 'Could not start this application.');
          if (!kind) { outcomes.push({...details, status: 'failed', reason}); return {ok: false, error: reason, outcomes}; }
          tally[kind]++; outcomes.push({...details, status: OUTCOME_STATUS[error?.code] || 'skipped', reason}); continue;
        }
        // Why (8 Nov 2026, owner: "Yes, build it (Recommended)"; the twin's GLOCK said "queued" while its run was open in the person's browser): the store returns a run the person
        // holds (opened in their browser, a CAPTCHA, an unknown submit) instead of a new one; it is theirs to finish, never counted as started.
        // Its card stays, or comes back when the person removed it (Gitar on #3612: else the run the store holds has no way back into Sessions).
        if (state.manualOverride) {
          if (old?.id !== state.session) { await dropFinished(old, state); begin(terminals.startForm({id: state.session, url: job.url, title: details.title, company: details.company, location: job.location || '', workMode: job.workMode || ''}), state); }
          tally.busy++; outcomes.push({...details, status: 'busy', reason: HELD[state.reason] || HELD.other}); continue;
        }
        await dropFinished(old, state);
        const item = terminals.startForm({id: state.session, url: job.url, title: job.title || '', company: job.company || '', location: job.location || '', workMode: job.workMode || ''});
        begin(item, state); enrolled.push(item.id); outcomes.push({...details, status: 'started', reason: ''});
      }
      if (!enrolled.length) return {ok: false, error: nothingStarted(tally), outcomes};   // nothing queued: no browser starts
      ({owner} = await browserOf().start({port, token: token()}));
      // Why (10 Nov 2026, hw): start() returns at once when the hidden browser already runs, and on a launch it hands the worker its owner after the worker's first report,
      // so a queued job was claimed only by the 30 s tab report: up to 30 s before its form opened. Test: test/unit/main/background-apply-wake.test.js.
      wakeBrowser('queued jobs');
      log('apply', 'queued owned background browser sessions', {mode, sessions: enrolled.length, ...tally});
      return {ok: true, mode, sessions: enrolled, outcomes, message: `${enrolled.length} application${enrolled.length === 1 ? '' : 's'} queued in the background. Review filled forms in Sessions.${skippedWords(tally)}`};
    });
  }
  /**
   * Whether `jobs` in `mode` (with `batch`, as enqueue takes them) could be queued now: {ok: true}, or the very refusal enqueue would answer (no Full automation confirmation, no browser), each job 'not-started'.
   * Why (7 Nov 2026, spec 2026-11-07-full-automation-check-first): a Full automation batch is held for its form check first; a batch that could never queue is refused before the check, not after it.
   */
  function canQueue(mode, batch = null, jobs = []) {
    const {error} = batchSettings(config(), mode, batch);
    if (error) return refusedFor(jobs, error);
    return browserOf().ready() ? {ok: true} : refusedFor(jobs, BROWSER_MISSING, {code: 'BACKGROUND_BROWSER_MISSING'});
  }
  // A stopped or changed-mode job is handed over before any command is collected; a missing record skips only its own session.
  async function stateForPoll(item) {
    // Why (5 Nov 2026, [ap] 6/7, measured: 2 store subprocesses of ~80 ms per open job on every poll, 1,508 in 30 min): this controller is the state's one writer and
    // keeps what it last wrote (cache); the store is read once per job after an app start. Every store verdict (claim, reserve…) still reads the store itself, so a job
    // in preflight still costs its claim each poll; one filling, ready or waiting costs nothing.
    let state = latest.get(item.id);
    if (!state) state = await store.read(item.url).catch(() => null);
    if (!state || state.ok === false || state.session !== item.id) return null;   // a refusal or another run's state is never kept: the next poll reads again
    latest.set(item.id, state);
    if (!state.manualOverride && (stop() || item.stuck === 'stopped')) state = await markManual(item, 'stopped');
    // Why (7 Nov 2026, owner, #3363: "The batch should continue with the setting it was set once the batch has been started"): a Settings change mid-batch no longer hands items over ('mode_changed' was here):
    // each item keeps the mode and confirmation its batch started with (store.queue), and a change applies to the next batch. Stop and Cancel all still end a batch.
    const current = config();
    return state.ok === false ? null : {state, current};
  }
  // Only an extension request can supply the e2e proof that it looked at this due job; app clock wakes are not evidence.
  function decisionForPoll(state, dueAt, via) {
    if (process.env.JOBADABRA_E2E !== '1' || via !== 'extension' || state.mode !== 'auto' || !dueAt) return null;
    if (state.state !== 'waiting_to_submit' && !HANDOFF.has(state.state)) return null;
    const reason = HANDOFF.has(state.state) ? state.reason : now() >= dueAt ? 'due' : 'waiting';
    return {via, at: now(), dueAt, state: state.state, reason};
  }
  // Collect launches (every queued job, up to MAX_BACKGROUND_SESSIONS filling at once), due rechecks and permanent handoffs without ever reissuing a reserved press.
  async function commandsForPoll(item, found, commands, via) {
    if (!found) return;
    let {state} = found;
    const dueAt = state.readyAt ? state.readyAt + (found.current.auto?.waitMin ?? AUTO_DEFAULTS.waitMin) * 60000 : 0;
    const decision = decisionForPoll(state, dueAt, via);
    if (HANDOFF.has(state.state)) { commands.handoffs.push({session: item.id, reason: state.reason, reveal: state.reason !== 'captcha_preflight'}); cache(item, state, decision); return; }   // words-ok: our own hand-off reason id / user-facing word, not page knowledge
    if (state.state === 'submitting') return;
    if (state.state === 'waiting_to_submit' && now() >= dueAt) commands.checks.push({session: item.id});
    const claimable = state.state === 'preflight' || (state.state === 'queued' && commands.active < MAX_BACKGROUND_SESSIONS);
    if (claimable && !reader.busy()) {
      const claim = await store.claim(item.url, item.id, owner);
      if (claim.ok) {
        if (state.state === 'queued') commands.active++;
        commands.filling = true; state = claim.state; commands.jobs.push({session: item.id, url: sessionTabUrl(item.url, item.id), mode: state.mode});
      }
    }
    cache(item, state, decision);
  }
  // One job's store failure (its Application record gone, an engine error) skips only that job this poll, and its kept state is dropped so the next poll reads the
  // store again. Why (5 Nov 2026, review of [ap] 6/7): with every job claimed from the kept state, one bad record rejected the whole poll: no launch, hand-off or due check for the others.
  const alone = async (item, work) => {
    try { return await work(); } catch (error) {
      latest.delete(item.id);
      log('apply', 'one background application skipped this poll', {session: item.id, error: String(error?.message || error)});
      return null;
    }
  };
  async function poll(givenOwner, via = 'app') {
    if (!owner) ({owner} = await browserOf().start({port, token: token()}));
    if (!givenOwner || givenOwner !== owner) return {ok: false, jobs: [], checks: []};
    await handOverAll(heldOpen, {quit: true});   // a poll before the start-up sweep never continues a job an earlier run held (owner, 30 Oct 2026: "A quit is a Stop")
    const open = terminals.list().filter(item => item.background && !item.outcome && !unsaved.has(item.id));   // a held job whose hand-over write threw is never continued (Gitar on #2598); the next poll tries again
    const found = [];
    for (const item of open) found.push([item, await alone(item, () => stateForPoll(item))]);
    await linkedin.settle(found, markManual);   // Why (13 Nov 2026, owner: "Today's browser (Recommended)"): before any launch, so a LinkedIn job never opens signed out or while paused
    // Why (5 Nov 2026, owner: "We want to be able to run 10 sessions in parallel, headless, and being very performant"; plan decision 3, "all of a batch, up to 10";
    // replaces #2646's one job at a time): every queued job fills at once, each in its own hidden window (extension/background-session.mjs). A job already claimed
    // (preflight) or past a multi-step form's middle step (filling) counts against the limit, whatever the list order; states are read first.
    const active = found.filter(([, each]) => each && ['preflight', 'filling'].includes(each.state.state)).length;
    const commands = {jobs: [], checks: [], handoffs: [], filling: false, active};
    for (const [item, each] of found) await alone(item, () => commandsForPoll(item, each, commands, via));
    const {jobs, checks, handoffs, filling} = commands;
    // Why (2026-10-30, owner: triage read, PR C2a): a form read and an application never share the hidden browser: a read waits for open applications, and an application waits (at most the read's timeout) for a read that is queued or out (Gitar, #2602).
    jobs.push(...readCommands({filling, open}));
    return {ok: true, jobs, checks, handoffs, closes: reader.takeEnded().map(session => ({session}))};   // pages of reads Cancel or a timeout ended: the extension closes them (#2624)
  }
  const readCommands = ({filling, open}) => {
    const next = filling || open.length ? null : reader.take();
    return next ? [{session: next.id, url: sessionTabUrl(next.url, next.id), mode: 'read'}] : [];
  };
  /** Reads one job's application form in the hidden browser without filling or pressing anything; resolves with the mode table's flags, or null when nothing could be read (no browser, an application open, a timeout). Takes the job ({url}). */
  let triageCancels = 0;   // counts Cancels, so a read that was waiting for the browser can tell one arrived
  async function triageRead(job) {
    if (!browserOf().ready() || terminals.list().some(item => item.background && !item.outcome)) return null;
    // Why (30 Oct 2026, g2's G4 step, #2636): `owner` outlives the browser it came from; a read after the hidden browser closed queued for a poll that never came and ended at the 90 s timeout. start() connects to a live browser or launches one, so every read asks.
    const generation = triageCancels;
    ({owner} = await browserOf().start({port, token: token()}));
    if (generation !== triageCancels) return null;   // Cancel came while the browser was starting: the read is never queued behind it (Gitar on #2636)
    return reader.read(job?.url);
  }
  const unsaved = new Set();   // jobs an earlier run held whose quit hand-over write threw: the poll leaves them out until one saves (Gitar on #2598)
  // Hands one background job to the person through the store's interrupted check (`options`: afterMs, quit) with its own words; -> the saved state, or null when it was not handed over.
  async function handOverInterrupted(item, options) {
    let threw = false;
    const state = await store.interrupted(item.url, item.id, options).catch(() => { threw = true; return null; });
    if (options.quit) unsaved[threw ? 'add' : 'delete'](item.id);
    if (!state) return null;
    cache(item, state);
    const note = NOTICES[state.reason] || NOTICES.submission_outcome_unknown;
    notify(activityText('needsYou'), activityHandoff(state.reason, 'outcomeUnknown'), {view: 'sessions', session: item.id}, 'warn');
    tellAway(item, note);
    log('apply', 'background application cut off handed to the person', {session: item.id, mode: state.mode, reason: state.reason, afterMs: options.afterMs || 0});
    return state;
  }
  // Hands to the person every background job of `fits` the interrupted check accepts; returns their session ids.
  async function handOverAll(fits, options) {
    const handed = [], told = options.quit && updatedStart ? {...options, updated: true} : options;   // Why (7 Nov 2026, review): a poll can reach a held job before the start-up sweep; both say "updated"
    for (const item of terminals.list().filter(entry => entry.background && !entry.outcome && fits(entry))) if (await handOverInterrupted(item, told)) handed.push(item.id);
    return handed;
  }
  let updatedStart = false;
  /** Marks this start as the first of a new version: every hand-over of a job an earlier run held then says `app_updated`, whichever (poll or sweep) reaches it first. */
  const markUpdatedStart = () => { updatedStart = true; };
  const heldBefore = (item, startedBefore = started) => Date.parse(item.startedAt) < startedBefore;   // a job an earlier run of the app held: its quit cut it off
  const heldOpen = item => heldBefore(item) && !item.background?.manualOverride;   // one not handed over yet (the cached state, so a poll asks the store only for those)
  /**
   * At start: every background job an earlier run held is handed to the person and never pressed: mid-press as "check whether it went through", before the press as `app_closed`.
   * Why (2026-10-29, owner: "Yes, go" to the crash rule): the hidden browser dies with the app (lib/browser-reaper.js), so no watcher will ever read the site's reply; without this the card said
   * "Submission attempted" for ever. Why (2026-10-29, Gitar on the PR): the sweep waits for the start-up moves, so a press this run started meanwhile is still in flight; only sessions older than this run were cut off by a quit.
   * Why (30 Oct 2026, owner: "A quit is a Stop"): a job before its press was continued after a restart, and Full automation pressed on the wait the quit cut off (#2598).
   * After `markUpdatedStart()` (the first start of a new version) the quit was the update's restart: the card says so (`app_updated`), not "closed".
   * Returns the session ids it handed over.
   */
  async function sweepInterrupted(startedBefore = started) {
    return handOverAll(entry => heldBefore(entry, startedBefore), {quit: true});
  }
  /**
   * While the app runs: a press with no receipt `afterMs` after it was sent is handed to the person too, because a reply that never arrives (the extension closed, the tab gone) has no other reader.
   * Why (2026-10-29, owner: "Hand-off PR first, then the switch"): the extension's watcher hands off after its own two reads, but with the extension closed nothing runs; this is the app's own timer. 3 minutes
   * is far past the watcher's own 20 seconds of reading (submit-watch.js SUBMIT_WAIT_MS), so a reply it is still reading is never taken from it, and short enough that a lost reply is on your list the same session.
   * Returns the session ids it handed over.
   */
  async function sweepStalled(afterMs = STALL_MS) {
    return handOverAll(entry => entry.background?.state === 'submitting', {afterMs});   // the cached state (set by every store move) spares the store a subprocess per idle session every 30 s (Gitar on #2451)
  }
  async function judgment(body, answer) {
    const context = body?.background, item = itemFor(context?.session);
    if (item && context?.owner && !owner) ({owner} = await browserOf().start({port, token: token()}));
    if (!item || !owner || context.owner !== owner) return null;
    const state = await store.read(item.url);
    if (!state || state.owner !== owner || state.session !== item.id || state.manualOverride) return null;
    const proof = uuid(), signature = createHash('sha256').update(JSON.stringify(body.sketch || {})).digest('hex');
    judgments.set(proof, {session: item.id, answer, signature, page: String(body.sketch?.url || ''), at: now()});   // page: the address the judge saw, for the send gate (lib/submit-proof.js sendAllowedAt)
    for (const [key, value] of judgments) if (now() - value.at > 120000) judgments.delete(key);
    return {proof, signature};
  }
  async function handle(payload = {}) {
    return serial(async () => {
      if (payload.action === 'poll') return poll(payload.owner, 'extension');
      if (!owner && payload.owner) ({owner} = await browserOf().start({port, token: token()}));
      if (!owner || payload.owner !== owner) return {ok: false};
      if (payload.action === 'triage-step') return {ok: reader.step(String(payload.session || ''), String(payload.step || ''))};   // which step a form read is on: no application item behind it
      if (payload.action === 'triage-read') return {ok: reader.report(String(payload.session || ''), payload)};   // a form read's answer: no application item behind it
      const item = itemFor(payload.session);
      if (!item) return {ok: false};
      if (payload.action === 'manual') {
        const state = await markManual(item, String(payload.reason || 'needs_user').slice(0, 80));
        return {ok: state.ok !== false, manual: true, reason: state.reason, reveal: state.reason !== 'captcha_preflight'};   // words-ok: our own hand-off reason id / user-facing word, not page knowledge
      }
      if (payload.action !== 'ready') return {ok: false};
      const judgment = judgments.get(payload.proof);
      if (!judgment || judgment.session !== item.id || now() - judgment.at > 120000) return {ok: false, recheck: true};
      judgments.delete(payload.proof);
      if (stop() || item.stuck === 'stopped') return {ok: true, manual: true, state: await markManual(item, 'stopped')};
      const proof = {...judgment.answer, signature: judgment.signature, page: judgment.page, requiredComplete: payload.requiredComplete === true,
        factsOnly: payload.factsOnly === true, safe: payload.safe === true && judgment.answer.confidence >= 0.9};
      if (proof.botCheck) return {ok: true, manual: true, reason: 'captcha_runtime', state: await markManual(item, 'captcha_runtime')};   // words-ok: our own hand-off reason id / user-facing word, not page knowledge
      if (proof.step === 'middle') {
        const state = await store.checkpoint(item.url, item.id, owner, proof); cache(item, state);
        return {ok: state.ok !== false, continue: state.state === 'filling', manual: HANDOFF.has(state.state), reason: state.reason};
      }
      const state = await store.ready(item.url, item.id, owner, proof); cache(item, state);
      if (state.mode === 'fill' && state.state === 'ready_for_review') {
        notify(activityText('readyTitle'), activityText('readyBody'), {view: 'sessions', session: item.id}, 'good');
        return {ok: true, review: true};
      }
      if (HANDOFF.has(state.state)) return {ok: true, manual: true, reason: state.reason};
      const permit = await store.reserve(item.url, item.id, owner, proof, config());
      const reserved = await store.read(item.url);
      cache(item, reserved, reserved && {via: 'extension', at: now(), dueAt: reserved.readyAt + (config().auto?.waitMin ?? AUTO_DEFAULTS.waitMin) * 60000, state: reserved.state, reason: permit.submit ? 'authorized' : permit.reason});
      if (permit.submit) log('apply', 'one-shot automatic submit authorized', {session: item.id, attempt: permit.attempt, signature: judgment.signature});
      return {ok: true, ...permit, manual: HANDOFF.has(permit.state)};
    });
  }
  async function reveal(id) {
    return serial(async () => {
      if (!owner) ({owner} = await browserOf().start({port, token: token()}));
      const item = itemFor(id); if (!item) return {ok: false};
      await markManual(item, 'review_requested');
      return {ok: await browserOf().reveal(id), taken: true, went: 'tab', found: null};
    });
  }
  async function outcome(context, confirmed) {
    const item = itemFor(context?.session);
    if (item && context?.owner && !owner) ({owner} = await browserOf().start({port, token: token()}));
    if (!item || context.owner !== owner) return {ok: false};
    const state = !context.attempt && confirmed === true ? await store.humanReceipt(item.url, item.id, owner, context.humanAt) : await store.receipt(item.url, item.id, context.attempt, confirmed);
    if (state.ok === false) return state;
    cache(item, state);
    // Why (8 Nov 2026, owner: "an e-mail for every automation"): only an attempt the app itself pressed (context.attempt) and the site confirmed is Full automation sending; the person's own press never is.
    if (context.attempt && confirmed === true && state.state === 'receipt_confirmed') { try { (applied ||= appliedMessageFor(storage)).add({id: item.id, title: item.title, company: item.company, at: now()}); } catch (error) { log('apply', `applied message not queued: ${error.message}`); } }   // a mail that cannot be queued never undoes the receipt
    return {ok: true};
  }
  async function cancel(id) {
    return serial(async () => {
      if (!owner) ({owner} = await browserOf().start({port, token: token()}));
      const item = itemFor(id); if (!item) return {ok: false};
      await markManual(item, 'cancelled');
      return {ok: true, closed: await browserOf().closeSession(id)};
    });
  }
  // The held tab's CDP address for the live view, only for a hidden-browser session, never another tab.
  /**
   * The person's Stop on one hidden-browser application (the card, ⌘K): handed to them in the store at once. -> the saved state, or null (unknown, already theirs, being sent or sent).
   * Why (5 Nov 2026, review of [ap] 6/7): the Stop was only a mark on the session that the next poll read, and the job's own fill report cleared it first
   * (session-flow.js reported → clearStuck), so the job went on to Ready and, in Full automation, to its press. A job being sent is left alone, as Cancel does.
   */
  // The one guarded hand-over of a hidden run (Stop, a dead end): this item's own run, not already handed over, in a state `allowed` accepts. -> the saved state, or null.
  const handOverIf = (id, allowed, reason) => serial(async () => {
    const item = itemFor(id);
    if (!item) return null;
    const state = latest.get(item.id) || await store.read(item.url).catch(() => null);   // an unreadable store hands nothing over
    if (!state || state.session !== item.id || state.manualOverride || !allowed(state.state)) return null;
    const handed = await markManual(item, reason);
    if (handed?.ok === false) return null;
    wakeBrowser('hand-over');   // the hidden tab hears it from the poll's hand-offs now, not at the 30 s report (hw, 10 Nov 2026)
    return handed;
  });
  async function stopOne(id) { return handOverIf(id, state => !['submitting', 'receipt_confirmed'].includes(state), 'stopped'); }
  /** The extension's dead end on a hidden application before its form (the stuck event, lib/session-flow.js stuck) hands the run over as 'no_form'. -> the saved state, or null.
   * Why (8 Nov 2026, owner: "please debug all the applying sessions, find the bugs"): the twin's Lufthansa run said "can't reach the form" and kept "Filling" with Stop. */
  async function deadEnd(event) {
    // Only a page with no form and nothing the person must do: an account page is the extension's own hand-off (sign_in_required), and a bot check,
    // an incomplete form or a told outcome keeps its own path (the form judge, extension/background-session.mjs observe) and stays with the person.
    if (!event?.session || event.why !== 'no-form' || event.needs) return null;
    return handOverIf(String(event.session), state => ['queued', 'preflight'].includes(state), 'no_form');   // filling: a form was reached, its steps stay the person's
  }
  async function page(id) { return itemFor(id) ? browserOf().pageSocket(id) : null; }
  // The page's own sending button for the app's Submit (the person's press): only while the form judge's ready stands, never after a hand-off.
  async function submitControl(id) {
    const item = itemFor(id); if (!item) return '';
    const state = await store.read(item.url);
    return state?.session === item.id && state.state === 'ready_for_review' && !state.manualOverride && typeof state.submitControl === 'string' ? state.submitControl : '';
  }
  // "Open in my browser": the held tab's hand-off (read(address) -> live.mjs handoffOf) is taken first, then the job is the person's and the hidden tab closes.
  async function handOver(id, read) {
    return serial(async () => {
      if (!owner) ({owner} = await browserOf().start({port, token: token()}));
      const item = itemFor(id); if (!item) return {ok: false};
      const address = await browserOf().pageSocket(id).catch(() => null);
      const handoff = address ? await read(address).catch(() => null) : null;
      await markManual(item, 'opened_in_browser');
      await browserOf().closeSession(id).catch(() => false);
      log('apply', 'background application opened in the person\'s browser', {session: item.id, handoff: !!handoff});
      return {ok: true, handoff};
    });
  }
  // cs 4/4 (lib/background-apply-cloud.js): which items the cloud may hold, the move of one, the site's outcome written back.
  const cloud = createCloudSide({store, terminals, serial, cache, itemFor, closeSession: id => browserOf().closeSession(id), notify, tellAway, applied: () => (applied ||= appliedMessageFor(storage)), log, now});
  return {cloud, enqueue, canQueue, releaseEnded, markUpdatedStart, handle, judgment, reveal, outcome, cancel, stopOne, deadEnd, page, submitControl, handOver, sweepInterrupted, sweepStalled, triageRead, cancelTriage: () => { triageCancels += 1; return reader.cancelAll(); }};
}
