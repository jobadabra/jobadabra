// The application flow's IPC (moved out of main.js, 8 Oct 2026): Apply and Apply with Claude, the form page's review state, watch and focus, showing a
// job's form tab, un-applying, outcomes, the sign-in password and credentials, Google connection, open tabs and which forms are open, the
// extension's state and the learned answers. It hands back showForm for the browser handlers. A FLOW FILE (docs/flows/applying.md): changing
// it runs the whole scenario matrix (npm run flows). Guards: the apply, review and credentials tests in desktop/test and the e2e rows.
import * as applicationOutcomes from './outcomes.js';
import * as apply from './apply.js';
import * as credentials from './credentials.js';
import * as profileAccounts from './profile-accounts.js';
import * as extensionInstall from './extension-install.js';
import * as github from './github.js';
import * as pipeline from './pipeline.js';
import {killTree} from './kill-tree.js';
import * as questions from './questions.js';
import * as questionLists from './question-lists.js';
import * as questionDismissed from './question-dismissed.js';
import {claudeAi} from './question-ai.js';
import {answerKey} from './question-answer.js';
import * as review from './review.js';
import {noteTabMiss} from './tab-expect.js';
import * as server from './server.js';
import {listenState, unheardForms} from './server-listen.js';
import {staleExtensionNote} from './extension-target.js';
import {extensionReady} from './extension-ready.js';
import * as sitePassword from './site-password.js';
import * as terminals from './terminals.js';
import {backgroundApplyFor} from './background-apply-controller.js';
import {createCheckFirst} from './apply-check-first.js';
import fs from 'node:fs';
import {GOOGLE_KEYCHAIN, GOOGLE_SCOPES_KEYCHAIN} from './google-keys.js';
import {log as appLog} from './log.js';
import {createTakeOver} from './ladder/rung5-takeover.js';
import {SHOW_RESUME_CLAUDE} from '../renderer/claude-help.js';
import {pageKeyOf, startRun} from './ladder/rung5-takeover-teach.js';
import {extensionGate as installedGate} from './extension-gate.js';
import {listTabs, openFormTab} from './form-tab.js';
import {sessionsNamedIn, sessionsWithTab} from './session-tab.js';
import {sharedCheck} from './shared-check.js';
import {ownSecretHints} from './secrets.js';
import {withAccounts, withCompanies, withoutHost} from './site-accounts.js';
import {isTwin} from './twin.js';
import {OUTCOME_STAGES as BOARD_STAGES} from '../renderer/jobs-board-rules.js';
import {demoFormsOpen, demoPath, demoTriageMatch, demoTriageRead, blocked} from './demo.js';
import {matchReads} from './triage-match.js';
import {createReadiness} from './apply-readiness.js';
import {cloudReadOf, keepReadiness} from './apply-readiness-registry.js';
import {applyOf, batchConfirmation, modeBuilt, modeRunner} from '../renderer/apply-settings-model.js';

/** One hidden-browser form read for the Jobs page: its flags, or null when nothing was read. A failure is logged with the job, never swallowed. */
// Why (#2650, 1 Nov 2026): a browser-start error became a silent null, so a read that never reached its chip left no cause in any log.
export function triageReadOrNull(read, url, log = appLog) {
  return Promise.resolve().then(() => read({url})).catch(error => { log('apply', 'triage: the form read failed', {url, error: String(error?.message || error).slice(0, 300)}); return null; });
}
export const extensionGate = installedGate;   // what main.js hands to every handler that opens a Chrome form

// A kit answer from prepareKitFor that came from a gate (Notion, move, allowance, no AI) and not from a draft that ran: a draft that ran always answers `stopped` or `ineligible`.
// Why (8 Nov 2026, Gitar on #3578): Apply readiness reads the form after a draft that failed, never after a gate, which must start nothing.
const refusedOrDrafted = kit => (kit?.ok === false && kit.stopped !== true && !('ineligible' in kit) ? {...kit, refused: true} : kit);

// Which of a kit draft's notices show (prepareKitFor's options), by who asked Apply readiness: a press on one job says all; a batch or Ready's night says a failure only, as their
// old direct draft did (code review of R2, 8 Nov 2026: the batch's "could not be prepared" notice was lost); the Jobs check says nothing (each job's line does).
const KIT_NOTICES = {all: {}, failures: {quiet: true}, none: {quiet: true, silent: true}};
export function registerApplyHandlers(ctx) {
  const {DEMO, applyRunner = apply, background: givenBackground = null, storedCheck: givenStoredCheck = null, clock = Date.now, extensionGate = () => null, allowanceBlock, claudeConsent, cloud, here, ipcMain, log, nativeTheme = {shouldUseDarkColors: false}, needsNotion, prepareKitFor, getRecipeReporter, startClaude, storage, toWindow, track, staleNote = () => staleExtensionNote(server.extensionSeen(), server.latestExtension())} = ctx;
  // Why (7 Nov 2026, owner's 0.9.13 retest): old extension code filled the forms and nothing said so; a press that opens Chrome says it ('' when the copy is current or unknown). Not for the hidden browser: it carries its own copy.
  const withNote = result => (result?.ok ? {...result, extensionNote: staleNote()} : result);
  const needExtension = () => (DEMO ? null : extensionGate());   // a Chrome form with no extension to fill it: install it first (lib/extension-gate.js)
  const background = givenBackground || backgroundApplyFor(storage);   // a test hands in a controller over a fake store and browser
  server.setVisitRoute('/extension/background-apply', payload => background.handle(payload));
  // Apply readiness (R1, spec 2026-11-07-apply-readiness-design.md): ONE step per job, its kit when missing, then its stored form check or one fresh read in the hidden browser (lib/apply-readiness.js). The demo has no hidden browser or store: it reads what settings.demoTriageReads names (lib/demo.js).
  const matchLogged = asked => matchReads(storage, asked).catch(error => { appLog('apply', 'triage: the question match failed', {error: String(error?.message || error).slice(0, 300)}); return {}; });   // one matcher and one log line for every caller
  const readiness = keepReadiness(storage, createReadiness({storage, prepareKit: (code, name, {notices = 'none'} = {}) => prepareKitFor(code, name, KIT_NOTICES[notices] || KIT_NOTICES.none).then(refusedOrDrafted), readForm: job => cloudReadOf(storage)?.readForm(job) ?? triageReadOrNull(background.triageRead, job.url), log: appLog,
    match: asked => matchLogged(asked)}));
  const storedCheck = givenStoredCheck || (DEMO ? async () => null : readiness.storedCheck);
  const named = job => [job?.title, job?.company].filter(Boolean).join(' · ');   // the kit's notices name the job as "Role · Employer", as the old draft did
  const jobOf = job => ({url: String(job?.url || ''), code: String(job?.code || ''), title: String(job?.title || ''), kit: job?.kit === true, posted_at: String(job?.posted_at || '')});
  // Why (8 Nov 2026, R2): the demo has no engine to draft a kit, so a press on one job (`say`) answers as a blocked action, the way its old prepareKit call did; the demo's check still reads its named forms.
  const demoPress = () => { appLog('demo', 'a blocked action was called', {name: 'applyReadiness'}); return {kit: blocked('applyReadiness'), check: null, stored: false}; };
  ipcMain.handle('applyReadiness', async (_, job, options) => (DEMO && options?.say === true ? demoPress() : DEMO ? {kit: {ok: true}, check: await demoTriageRead(storage.settings(), String(job?.url || '')), stored: false} : readiness.applyReadiness(jobOf(job), {notices: options?.say === true ? 'all' : 'none'}).then(done => (done.kit?.needsNotion || done.kit?.needsMove ? {...done, ...done.kit} : done))));   // Why (#3573 review; R2, 8 Nov 2026): a store or move gate rises to the answer's top, where preload opens its dialog and repeats the call; `say` marks one job's press, whose kit notices all show   // app.log (lib/log.js), not the window log: it keeps a line only while a pipeline task runs (Gitar, #2867)
  // L2b: the check's simple forms' required questions matched against Your details in one go: {url: {missing, unjudged}}; each matched form is then stored. The demo names its answer in settings.demoTriageMatch (lib/demo.js).
  const askedOf = reads => (Array.isArray(reads) ? reads : []).map(read => ({url: String(read?.url || ''), questions: (Array.isArray(read?.questions) ? read.questions : []).map(String).slice(0, 30)})).filter(read => read.url).slice(0, 50);
  ipcMain.handle('applyReadinessMatch', (_, reads) => {
    const asked = askedOf(reads);
    return DEMO ? demoTriageMatch(storage.settings(), asked) : readiness.settle(asked);
  });
  // The held batch's own match (lib/apply-check-first.js matchAll): the same call, without readiness's store step, so it never clears the form-check dialog's waiting reads.
  const matchHeld = reads => { const asked = askedOf(reads); return DEMO ? demoTriageMatch(storage.settings(), asked) : matchLogged(asked); };
  ipcMain.handle('triageCancel', () => { readiness.cancel(); return background.cancelTriage(); });
  // A Full automation batch checks its forms first, then the person confirms the split (spec 2026-11-07-full-automation-check-first; owner, 7 Nov 2026): the held batches and their reads live in the app (lib/apply-check-first.js).
  // storedCheck(job): the check prepared with the job's kit, fresh, or null: Apply readiness's own reader (lib/apply-readiness.js), unless a test hands one in.
  const checkFirst = createCheckFirst({stored: storedCheck, match: matchHeld, read: job => (DEMO ? demoTriageRead(storage.settings(), job.url) : readiness.applyReadiness(jobOf(job)).then(done => done.check, error => { appLog('apply', 'readiness: the held batch read failed', {error: String(error?.message || error).slice(0, 200)}); return null; })),   // Why (8 Nov 2026, R2): the held batch's read goes through the same step, so a stored check is reused instead of a second form read (a fresh simple form is stored only once a question match judged it)
    enqueue: (jobs, mode, batch, eligibility) => background.enqueue(jobs, mode, batch, eligibility), openInChrome: jobs => applyRunner.openInChrome(storage, jobs), chromeBlocked: needExtension});
  const holdForCheck = async (jobs, batch, eligibility) => {
    const can = background.canQueue('auto', batch, jobs);   // the batch's own Full automation confirmation and the browser, refused before the check with enqueue's own answer
    return can.ok ? await checkFirst.hold(jobs, {batch, eligibility}) : can;
  };
  ipcMain.handle('applyCheckRead', (_, plan, url) => checkFirst.readOne(plan, url));
  ipcMain.handle('applyCheckMatch', (_, plan) => checkFirst.matchAll(plan));
  ipcMain.handle('applyCheckConfirm', async (_, plan, autoUrls) => {
    const blocked = needsNotion('apply') || await allowanceBlock();   // checked again: the answer may come many minutes after Start
    if (blocked) { checkFirst.cancel(plan); return blocked; }
    return withNote(await checkFirst.confirm(plan, Array.isArray(autoUrls) ? autoUrls : []));   // the In Chrome group opens Chrome tabs: the stale-extension note applies
  });
  ipcMain.handle('applyCheckCancel', async (_, plan) => {
    const {held} = checkFirst.cancel(plan);
    if (held && !DEMO) await background.cancelTriage();   // Why (7 Nov 2026, the owner's choice on the fa sketch): Cancel ends the whole batch, so its read in flight stops too; an ended or unknown batch stops nothing
    return {ok: true};
  });
  ipcMain.handle('apply', async (_, options) => {
    const fromSettings = options?.mode === 'settings';   // Why (27 Oct 2026, owner): read after the first-choice gate replays the held call, so Start never uses a stale mode
    // Why (7 Nov 2026, owner, #3363: "We don't want to change the settings from the Apply to jobs"; "we can choose a different apply mode every time, for every new batch"): a call with a `pick` (the dialog's card) runs
    // THIS batch in that mode and writes nothing to Settings; its Full-automation confirmation is the one this call carries (batchConfirmation). A call without a pick follows the saved mode, as before.
    const settings = fromSettings ? storage.settings() : null;   // read only for a Settings-driven call: a gate's call with no settings (extension-gate.test.js) never reaches it
    const picked = fromSettings && modeBuilt(options?.pick) ? options.pick : '';
    const batch = !picked ? null : {autoConfirmedAt: picked === 'auto' ? batchConfirmation(options.autoConfirmedAt, settings, clock()) : ''};
    const applyMode = fromSettings ? picked || applyOf(settings).mode : '';
    const mode = fromSettings ? modeRunner(applyMode) : options?.mode;   // applyOf returns a built mode only: it always has a runner
    // Why (2026-10-28, Background apply B): the hidden browser runs only the person's saved mode, never a runner name the window sends.
    if (mode === 'background' && !fromSettings) return {ok: false, error: 'Choose Background automation in Settings → Apply first.'};
    const agents = mode === 'agents', hidden = mode === 'background';
    const blocked = needsNotion('apply') || await allowanceBlock() || (agents || hidden ? null : needExtension());   // the hidden browser carries its own copy of the extension
    if (blocked) return blocked;
    if (agents && !SHOW_RESUME_CLAUDE) return {ok: false, error: 'Applying by session is not available in this version. Use Fill in Chrome.'};
    if (agents && !(await claudeConsent())) return {ok: false, error: 'Apply with Claude is off. Use Fill in Chrome, or allow it next time.'};
    const started = await applyRunner.start(storage, {...options, mode, applyMode}, undefined, undefined, undefined, undefined,
      job => readiness.applyReadiness({...jobOf(job), title: named(job)}, {notices: 'failures'}).then(done => done.kit), text => toWindow('applyProgress', text), {enqueue: (jobs, which, eligibility) => (which === 'auto' && options?.checkFirst === true ? holdForCheck(jobs, batch, eligibility) : background.enqueue(jobs, which, batch, eligibility))});
    return hidden ? started : withNote(started);
  });
  ipcMain.handle('applyOne', async (_, url, details, pick) => {
    const gate = needsNotion('apply');
    if (gate) return gate;
    // Why (7 Nov 2026, owner; R2, 8 Nov 2026): one job runs in the saved mode unless its ⋯ menu picked one (below), always with the saved eligibility preference, captured on its hidden queue item.
    // Why (8 Nov 2026, owner, R2: "Yes, as drawn"): a mode picked in the job's ⋯ menu (`pick`) is that job's only and writes nothing to Settings; a Full automation pick carries its own confirmation (batchConfirmation), as a Jobs-dialog pick does.
    const settings = storage.settings(), applySettings = applyOf(settings), picked = modeBuilt(pick?.mode) ? pick.mode : '';
    const applyMode = picked || applySettings.mode, batch = !picked ? null : {autoConfirmedAt: picked === 'auto' ? batchConfirmation(pick.autoConfirmedAt, settings, clock()) : ''};
    const hidden = modeRunner(applyMode) === 'background' ? {applyMode, enqueue: (jobs, which) => background.enqueue(jobs, which, batch, {allowIneligible: applySettings.allowIneligible})} : null;
    const blocked = await allowanceBlock() || (hidden ? null : needExtension());
    if (blocked) return blocked;
    const result = await (DEMO ? applyRunner.openOne(url, {session: 'demo'}) : applyRunner.applyOne(storage, url, details || {}, {...(hidden ? {hidden} : {})}));   // applyRunner is lib/apply.js unless a test hands in its own; a direct `apply.` call here ignored the fake (7 Nov 2026: 3 real tabs)
    if (result?.ok) track('apply_started', {how: hidden ? 'background' : 'extension'});
    return hidden ? {...result, background: true} : withNote(result);   // `background`: the window says it queued (Sessions), never "Opened in Chrome"
  });
  // Checked session workflows share the production registration with the offline app scenario tests.
  ipcMain.handle('applyWithClaude', (_, url, details = null) => startClaude(url, details));
  const takeOver = createTakeOver({enabled: SHOW_RESUME_CLAUDE, startClaude, storage, appLog, toWindow, onStarted: url => startRun(pageKeyOf(url))});   // the panel's button or countdown and the session card's: the person's own request, once per application (lib/ladder/rung5-takeover.js)
  server.setTakeOverHandler(takeOver);
  ipcMain.handle('takeOverClaude', (_, url, details, consent) => takeOver({url, host: '', consent: !!consent,
    job: details ? {title: details.title, company: details.company, location: details.location, work_mode: details.workMode} : null}));
  server.setClaudeAutoHandler(event => {   // the panel's "Always let Claude finish when I'm stuck" box: the same switch as Settings
    storage.saveSettings({claudeAuto: !!event.on});
    appLog('extension', `always let Claude finish when stuck: ${event.on ? 'on' : 'off'} (from the panel)`);
  });
  // The form page and this page in step (lib/review.js): what to track in the form, and "show me this field".
  // Demo: each form's tab opened 12 minutes ago, so the card's "open for" reads the same in every screenshot.
  ipcMain.handle('reviewStates', () => (DEMO ? JSON.parse(fs.readFileSync(demoPath(here, 'review.json'), 'utf8'))
    .map(state => ({tabAt: Date.now() - 12 * 60 * 1000, ...state})) : review.allStates()));
  ipcMain.handle('reviewWatch', (_, id, items) => {
    appLog('review', `watch ${id}: ${(items || []).length} field(s)`, {labels: (items || []).map(item => String(item.label).slice(0, 60))});
    return review.setWatch(String(id), items);
  });
  // The extension first: the form page takes the request, brings its own tab forward and scrolls to the field (no
  // macOS permission needed, never the wrong tab). Only when no page answers does the app look for the tab itself.
  const showForm = async (id, label, url, company) => {
    const key = String(id), name = String(label || '');
    if (terminals.record(key)?.background) return background.reveal(key);
    // On a Mac the form tab is found and brought forward first, through Chrome's own tab list: at once, whatever the page is
    // doing (a background tab's timers are slow). One attempt: it worked, or it says no tab is this job's form.
    if (process.platform === 'darwin' && !isTwin()) {   // a twin finds its tab through its own extension (lib/twin.js)
      // The session's own tab, by its bound id or the id in its address (lib/session-tab.js): nothing else is ever taken.
      const direct = await openFormTab({id: key, boundTab: review.tabOf(key)}).catch(() => 'none');
      if (direct !== 'tab') {
        appLog('review', `show ${key}: this session owns no open tab; nothing queued`, {went: direct, boundTab: review.tabOf(key)});
        review.forget(key);
        return {taken: false, went: 'none', found: null};
      }
      if (!name) { appLog('review', `show ${key}: went straight to the form tab`, {went: direct, boundTab: review.tabOf(key)}); return {taken: true, went: direct, found: null}; }
      // A field: the tab is in front now, so its page checks in quickly and scrolls to it.
      review.queueFocus(key, name);
      const answered = await review.delivered(key, 6000);
      if (!answered) review.cancelFocus(key);  // nobody took it: it must not fire later
      const seen = answered ? await review.focusFound(key, 3000) : null;
      appLog('review', `show ${key}: tab in front, ${answered ? 'the page took the field' : 'the page did not answer'}`, {label: name.slice(0, 60), found: seen});
      return {taken: answered, went: 'tab', found: seen};
    }
    const ready = await extensionReady(server.extensionHeard);   // Why (#2536): pages are known after any browser's first tab report, including the hidden browser's.
    if (ready.waited) appLog('review', `show ${key}: waited for the extension's first check-in`, {ms: ready.waited, seen: ready.seen});
    review.queueFocus(key, name);
    let taken = await review.delivered(key, 4000), woke = false;  // the page checks in every 2 s
    if (!taken) {
      // The tab Claude opened has no panel. Wake the extension and inject into that tab; do not reload it.
      let host = '';
      try { host = new URL(String(url || '')).hostname; } catch { /* no url */ }
      appLog('review', 'extension not on the form tab: joining it', {host});
      woke = await extensionInstall.openInChrome(`chrome-extension://${server.extensionIdNow()}/wake.html`, {browser: apply.extensionBrowser()}).catch(() => false);
      appLog('review', `wake page ${woke ? 'opened' : 'did not open'}`, {browser: apply.extensionBrowser() || 'default'});
      taken = await review.delivered(key, 6000);
    }
    if (!taken) noteTabMiss(woke ? 'join_empty' : 'wake_failed');   // the step that failed, for the Technical reports (lib/tab-expect.js)
    if (!taken) review.cancelFocus(key);  // nobody took it: it must not fire later and pull Chrome forward
    const went = taken ? 'tab' : 'none';   // no page answered: the card offers to reopen the form, nothing is opened here
    appLog('review', `show ${key}: ${taken ? 'form page answered' : `no page answered, app went to: ${went}`}`, {label: name.slice(0, 60), taken: !!taken, went});
    const found = taken && name ? await review.focusFound(key, 3000) : null;
    return {taken, went, found};
  };
  ipcMain.handle('reviewFocus', async (_, id, label, url, company) => {
    const result = await showForm(id, label, url, company);
    const seen = server.extensionSeen(), latest = server.latestExtension();
    return {...result, extension: seen?.version || '', latest, outdated: !!(seen?.version && latest && seen.version !== latest)};
  });
  ipcMain.handle('unapplyJob', (_, url) => pipeline.unapply(storage, String(url)));
  // "This wasn't submitted": only ever asked for by the user, and only from a bare Applied.
  ipcMain.handle('notSubmitted', (_, url) => {
    const job = String(url);
    appLog('applied', `not submitted: undo asked for ${job}`);
    return pipeline.notSubmitted(storage, job).then(result => {
      appLog('applied', `not submitted: ${job} -> ${result.notion || result.error} (${result.events || 0} event(s) removed)`);
      return result;
    });
  });
  // "How did it go?" on a job: written to Notion like a stage the Gmail check found, then counted anonymously (lib/outcomes.js) if reports are on.
  ipcMain.handle('markOutcome', async (_, input) => {
    const outcome = String(input?.outcome || ''), url = String(input?.url || '');
    const stage = applicationOutcomes.STAGES[outcome];
    if (!stage || !url) return {ok: false, error: 'Unknown outcome.'};
    if (DEMO) return {ok: true, stage};
    appLog('outcome', `marked ${outcome} (${stage})`, {board: applicationOutcomes.anonymous({url, outcome})?.board || ''});
    const result = await pipeline.markOutcome(storage, url, stage);
    if (result.ok && outcome !== 'withdrawn') getRecipeReporter()?.application(applicationOutcomes.anonymous({url, outcome, appliedOn: input?.appliedOn}));
    if (result.ok && outcome !== 'withdrawn') getRecipeReporter()?.reply(String(input?.bucket || ''), outcome);   // the job's score band, to see whether the score predicts replies
    return result;
  });
  // Jobs → Board: a card moved to an outcome column (renderer/jobs-board-rules.js dropFor). The same engine step as markOutcome (the stage
  // and its 📈 event, the store's rules), without the anonymous outcome report: a move on the board can be a correction.
  ipcMain.handle('setStage', async (_, url, stage) => {
    const job = String(url || ''), to = String(stage || '');
    if (!job || !BOARD_STAGES.includes(to)) return {ok: false, error: 'That stage is set by Jobadabra, not by moving a card.'};
    const result = await pipeline.markOutcome(storage, job, to).catch(error => ({ok: false, error: error.message}));
    appLog('outcome', `moved on the board to ${to}: ${result.ok ? 'saved' : result.error || 'failed'}`, {by: 'you'});
    return result;
  });
  ipcMain.handle('claudeReady', () => apply.claudeReady(storage));
  // Settings → Application assistant: the old job-site password, for accounts made before 10 Oct 2026 (each new account has its own, in Credentials). Never made here on a Mac
  // where none exists; Copy puts it on the clipboard through the engine, never printed.
  ipcMain.handle('sitePassword', async (_, action) => {
    if (DEMO) return {ok: true, password: 'Maple-Rocket-42'};
    if (process.platform === 'darwin' && !sitePassword.read()) return {ok: false, error: 'No shared password: every account made by Jobadabra has its own. Show it in Credentials.'};
    if (action === 'show' && sitePassword.read()) return {ok: true, password: sitePassword.read()};
    const code = await sitePassword.runFor(action, args => pipeline.run(storage, args).then(done => done.code));
    appLog('apply', `job-site password ${action === 'show' ? 'shown' : 'copied'}`, {ok: code === 0});
    if (code !== 0) return {ok: false, error: 'The password could not be made or read.'};
    return {ok: true, copied: true, password: action === 'show' ? sitePassword.read() : null};
  });
  // Settings → Credentials: the sites' accounts from the Keychain (attributes only), and one password when you press Show or Copy.
  ipcMain.handle('credentials', () => (DEMO ? {ok: true, rows: [{host: 'career2.successfactors.eu', email: 'you@example.com', job: 'https://jobs.migros.ch/x', created: '2026-10-08T11:54:02Z', state: 'confirmed', companies: ['Migros', 'Coop', 'Glacier Labs']}, {host: 'jobs.old-example.com', key: 'unassigned:jobs.old-example.com', unassigned: true, email: '', job: '', created: '2026-09-28T00:36:03Z'}]} : (list => ({...list, rows: withCompanies(withAccounts(list.rows, storage.settings().siteAccounts), review.allStates(), terminals.list())}))(credentials.list())));
  ipcMain.handle('credentialReveal', (_, host, why) => {
    const password = DEMO ? 'Maple-Rocket-42' : credentials.reveal(host);
    appLog('apply', `credential ${why === 'copy' ? 'copied' : 'shown'}`, {host: String(host || '').slice(0, 120), found: !!password});   // which site, never the password
    return password ? {ok: true, password} : {ok: false, error: 'Not in the Keychain any more.'};
  });
  // Delete: the site's password item, and the app's record of an account there (the next sign-in or sign-up page starts fresh). Logged: the host, never a secret.
  ipcMain.handle('credentialDelete', (_, host) => {
    if (DEMO) return {ok: true};
    const gone = credentials.forget(host);
    if (gone) storage.saveSettings({siteAccounts: withoutHost(storage.settings().siteAccounts, host)});
    appLog('apply', 'credential deleted', {host: String(host || '').slice(0, 120), ok: gone});
    return gone ? {ok: true} : {ok: false, error: 'It could not be deleted (not in the Keychain any more?).'};
  });
  // Assign: an account from before profiles (listed "not assigned") becomes this profile's; the old item goes only after the new one reads back equal. Logged: the host, never a secret.
  ipcMain.handle('credentialAssign', (_, key) => {
    const host = String(key || '').startsWith(credentials.UNASSIGNED) ? String(key).slice(credentials.UNASSIGNED.length) : '';
    if (DEMO) return {ok: true};
    const result = host ? profileAccounts.assign(host) : 'failed';
    appLog('apply', 'credential assigned to this profile', {host: host.slice(0, 120), result});
    return result === 'moved' ? {ok: true} : {ok: false, error: result === 'kept' ? 'This profile already has a different password for that site: both stay. Delete the one you do not need.' : 'It could not be moved (not in the Keychain any more?).'};
  });
  ipcMain.handle('claudePrereqs', async () => ({...apply.claudePrereqs(), inApp: await terminals.available()}));
  // Gmail and Calendar (read-only): replies and interviews, and sign-up confirmation emails for Apply with Claude.
  // The token lives in the Keychain, where the Python side (src/sources/google.py) reads it.
  // One Gmail check shared by every view (lib/shared-check.js): Settings' overview and the Gmail card ask at once.
  const googleStatus = sharedCheck(async () => {
    const {stdout} = await pipeline.run(storage, ['src.sources.google', 'status']);
    return JSON.parse(stdout.trim().split('\n').pop());  // unreadable: throws, so it isn't kept and is retried
  });
  ipcMain.handle('googleStatus', async () => {
    // Demo mode: the fictional user's account. The real check reads this Mac's Google sign-in (the Keychain, not the
    // demo folder), which put the owner's own address into the reference screenshots.
    // JOBADABRA_DEMO_GOOGLE=off shows the disconnected states (the state viewer, e2e/mail-states.mjs).
    if (DEMO) return process.env.JOBADABRA_DEMO_GOOGLE === 'off' ? {connected: false} : {connected: true, email: 'alex.morgan@example.com'};
    try { return await googleStatus(); } catch { return {connected: false}; }
  });
  let googleSignIn = null;   // the sign-in waiting for Google's redirect (up to 5 minutes): its child, so Cancel ends exactly this one
  ipcMain.handle('googleConnectCancel', () => { if (googleSignIn) { googleSignIn.cancelled = true; killTree(googleSignIn.child); } });
  ipcMain.handle('googleConnect', async (_event, {only} = {}) => {
    const gate = needsNotion('gmail');
    if (gate) return gate;
    if (googleSignIn) return {ok: false, error: 'A Google sign-in is already waiting.'};
    const mine = googleSignIn = {child: null, cancelled: false};
    const lines = [];
    // The browser's "connected" page follows the app's theme; `only` (gmail|calendar) is a reconnect asking just for the part left unticked.
    const args = ['src.sources.google', 'auth', '--theme', nativeTheme.shouldUseDarkColors ? 'dark' : 'light', ...(['gmail', 'calendar'].includes(only) ? ['--only', only] : [])];
    let code;
    try { ({code} = await pipeline.run(storage, args, line => lines.push(line), {}, {onChild: child => { mine.child = child; }})); }
    finally { googleSignIn = null; }
    if (mine.cancelled) return {ok: false, cancelled: true, error: 'Sign-in cancelled.'};
    googleStatus.forget();   // the next status asks again, so the new account shows at once
    // Always on: the new sign-in goes to the GitHub repo too, so the Gmail check there can use it.
    if (code === 0 && cloud()) github.updateRepo(storage).catch(error => log(`Google sign-in not sent to GitHub: ${error.message}`));
    return code === 0 ? {ok: true} : {ok: false, error: lines.filter(line => !/^Opening|^https?:/.test(line)).slice(-1)[0] || 'Sign-in did not complete'};
  });
  // Settings → Connections → ⋯ → Disconnect Gmail (owner, 7 Oct 2026): revoked at Google, forgotten in the Keychain and, with
  // Always on, in the GitHub repo. Logged: what was asked and what each step did, never the token.
  ipcMain.handle('googleDisconnect', async () => {
    if (DEMO) return {ok: false, error: 'Demo mode: the sign-in is not changed.'};
    const {code, stdout} = await pipeline.run(storage, ['src.sources.google', 'disconnect']);
    let result = {};
    try { result = JSON.parse(String(stdout).trim().split('\n').pop()); } catch {}
    googleStatus.forget();
    let inRepo = false;
    if (code === 0 && cloud()) inRepo = await github.removeRepoSecrets(storage, [...Object.keys(GOOGLE_KEYCHAIN), ...Object.keys(GOOGLE_SCOPES_KEYCHAIN)]).catch(error => { appLog('connections', 'Gmail secrets not removed from GitHub', {error: error.message}); return 'failed'; });
    appLog('connections', 'Gmail disconnected', {from: 'settings', code, revoked: !!result.revoked, wasConnected: !!result.was_connected, github: inRepo});
    return code === 0 && result.ok ? {ok: true, revoked: !!result.revoked, github: inRepo} : {ok: false, error: 'Gmail could not be disconnected: try again'};
  });
  ipcMain.handle('openTabs', () => server.openTabs());
  let liveAt = 0, liveList = [];
  const liveTabs = async () => { if (Date.now() - liveAt > 1500) { liveList = await listTabs(); liveAt = Date.now(); } return liveList; };   // the poll runs every 2 s: one scripting call each
  // Which sessions' forms are still open in Chrome, by the extension's own tab report. `known` is false while the
  // extension has not checked in lately: then nothing can be said about a closed tab, so the page says nothing.
  let lastFormsOpen = '';
  ipcMain.handle('formsOpen', async () => {
    if (DEMO) return demoFormsOpen(JSON.parse(fs.readFileSync(demoPath(here, 'review.json'), 'utf8')), storage.settings());   // the demo's forms, as Chrome would report them (lib/demo.js)
    const heard = server.extensionHeard(), known = !!heard && Date.now() - heard.at < 90 * 1000;   // Why (#2536): openTabs pools hidden and Chrome reports, so either keeps form knowledge alive.
    if (!known) return unheardForms(listenState());   // linkOff: our socket is not open, so no report can come (lib/server-listen.js)
    // A session whose own tab we know is open while that tab exists; for the others, a tab that looks like its form says open, nothing says closed.
    // Open is proved two ways, each exact: a tab in the extension's report naming the session in its address, or in Chrome's own list right now
    // (Mac scripting, read at each check, so a screen opened after a restart never waits for the extension's next 30 s report).
    const sessions = terminals.list(), byLook = sessionsNamedIn(sessions, server.openTabs());
    for (const id of sessionsWithTab(sessions, DEMO ? [] : await liveTabs(), sessionId => review.tabOf(sessionId))) byLook.add(id);
    const {ids, unsure} = review.formStates(sessions.map(session => session.id), byLook);
    const line = `${ids.join(',') || 'none'}${unsure.length ? ` (not known: ${unsure.join(',')})` : ''}`;
    if (line !== lastFormsOpen) { lastFormsOpen = line; appLog('review', `forms open in Chrome: ${line}`, {sessions: sessions.length}); }   // who is open, when it changed
    return {known, ids, unsure};
  });
  // latest + note: the pages show one wording for a stale copy (server.staleExtension), the same sentence the app
  // records with a failed fill.
  ipcMain.handle('extensionSeen', () => {
    const seen = server.extensionSeen();
    if (!seen) return null;
    const latest = server.latestExtension();
    return {...seen, latest, note: server.staleExtension(seen.version, latest)};
  });
  // A failed Notion read is reported (not an empty list), so the section says why instead of disappearing.
  // The two drawers (lib/question-lists.js openShown); demo: Your details items from demoDetailsReview, the reusable questions from openQuestions, the saved
  // answers that are no learning from demoNotLearned.
  ipcMain.handle('openQuestions', () => (DEMO ? Promise.resolve({details: storage.settings().demoDetailsReview || [], learned: storage.settings().openQuestions || [], letter: storage.settings().demoLetterSetup || null,
    hidden: storage.settings().hiddenQuestions || [], notLearned: storage.settings().demoNotLearned || []}) : questionLists.openShown(storage))
    .then(({details, learned, letter = null, hidden, dismissed = {}, consent = 0, fromDetails = 0, notLearned = []}) => ({ok: true, details, learned, letter, hidden, dismissed, consent, fromDetails, notLearned}),
      error => ({ok: false, error: error.message, details: [], learned: [], letter: null, hidden: [], notLearned: []})));
  // Why (PR B2b): each form label's learning (lib/learnings.js wrote it in the verdict cache), for What we learned's evidence chips (renderer/learning-evidence.js).
  ipcMain.handle('learnedLabels', () => Object.fromEntries(Object.entries(storage.settings().questionVerdicts || {}).filter(([, entry]) => entry?.learned).map(([key, entry]) => [key, entry.learned])));
  ipcMain.handle('jobQuestions', (_, url) => questionLists.jobQuestions(storage, url));
  ipcMain.handle('jobQuestionOnly', (_, question) => (DEMO ? {ok: true} : needsNotion('profile') || questionLists.onlyThisJob(storage, String(question || '')).catch(error => ({ok: false, error: error.message}))));
  // mark: the kind the window drew it with ({kind, options, list}), written with the first answer of a question that had none (lib/questions.js answer).
  // options.also: the keys of the other wordings of the same question (one item in the queue, renderer/question-filter.js): they get the same answer.
  // A Your details item of the queue (lib/details-review.js) is answered into its section or Profile line.
  ipcMain.handle('answerQuestion', (_, questionKey, answer, mark, options) => needsNotion('profile') || answerKey(storage, questionKey, answer,
    {mark: mark && typeof mark === 'object' ? mark : null, also: Array.isArray(options?.also) ? options.also.map(String).slice(0, 20) : [], ai: claudeAi(storage)})
    .catch(error => ({ok: false, error: `Notion: ${error.message}`})));
  // A drawer's "Dismiss this question" (on: true) and its "Bring back" (lib/question-dismissed.js): the one state the lists read.
  ipcMain.handle('dismissQuestion', (_, questionKey, question, on) => (DEMO ? {ok: true} : on ? questionDismissed.dismiss(storage, String(questionKey || ''), question) : questionDismissed.bringBack(storage, String(questionKey || ''))));
  // A session's ❓ fact, answered with one tick on the session page: saved to its home (Your details or the standard answers page, lib/answer-home.js).
  ipcMain.handle('rememberAnswer', (_, question, answer) => (DEMO ? Promise.resolve({ok: true}) : needsNotion('profile') || questions.remember(storage, question, answer, undefined, {ai: claudeAi(storage)}))
    .catch(error => ({ok: false, error: `Notion: ${error.message}`})));
  // Saved keys as dots plus their last 4 characters, so Settings can show which key is stored (never the key).
  ipcMain.handle('secretHints', () => ownSecretHints(storage));   // not Free AI's token in the same slot (lib/secrets.js; review of #3014)
  return {showForm};   // the browser handlers (lib/browser-handlers.js) show a job's form tab through it
}
