// A session's state as the window shows it, from what the app reports (lib/terminals.js publicView) and Claude's
// last message. No window needed: tested in desktop/test/unit/renderer/session-state.test.js.
import '../i18n/screens-helpers.js';
import {t} from '../i18n/index.js';
import {READY_LINE, readSessionMessage} from './session-message.js';
import {backgroundStatus} from './background-status.js';
import {PAGE_LINES, displayPageLine as pageLine} from './page-lines.js';

export const SESSION_STATE = {running: [t('helpers.stageApplying'), 'info'], input: [t('helperState.questionForYou'), 'warn'], done: [t('helperState.readyReview'), 'warn'],
  ended: [t('helperState.ended'), 'neutral'], failed: [t('helperState.stopped'), 'bad'], submit: [t('helperState.readySubmit'), 'good'], submitted: [t('helpers.submitted'), 'good']};
// Claude is running in it (demo sessions say nothing: they run while not ended).
export const isLive = item => item.live ?? !item.endedAt;
// The application was submitted and Claude is no longer in it. The badge, the step and the log all read this.
export const isSubmitted = item => item?.outcome === 'submitted' && !isLive(item);
// Waiting for you after filling the form (its message says so) counts as "ready for review", like a finished one.
const ENGLISH_REVIEW_WORDS = /form (?:is )?(?:now )?(?:filled|ready|complete)|ready for (?:your )?review|ready for you to review/i;
// The skill's fixed last line says it in any language (8 Oct 2026: a session answering in French never turned "Ready for review");
// the English words stay for older sessions and a Claude that left the line out.
export const REVIEW_WORDS = {test: text => String(text || '').split(/\n/).some(line => READY_LINE.test(line.trim())) || ENGLISH_REVIEW_WORDS.test(text || '')};
// Claude asks you something when one of its own sentences (outside its report's lists) ends with "?"; a listed form
// question ("Any relatives working at Acme?") is not Claude asking.
// Claude's report lists what it needs from you (its "Needs you" part, read by structure in session-message.js), or asks a question.
export const leftForYou = item => !!item.question && (readSessionMessage(item.question).needs.length > 0 || asksYou(item));
export const asksYou = item => (item.question ? readSessionMessage(item.question).intro.some(line => /\?\**\s*$/.test(line)) : /\?\s*$/.test(item.brief || ''));
// A message that ends on a question still waits for your answer first.
// `formReady`: the form page says every required field is filled. Then what Claude asked earlier is moot: the form is
// ready for review and submit, whatever its last message says (1 Oct 2026: a card still asked for a street already typed).
// A Claude ask that closed with the app is outdated once the session's own tab reports an application page with fields (liveForm: the extension's report of it): the live page leads the card.
export const askOutdated = (item, liveForm) => !!item && item.kind !== 'form' && !isLive(item) && item.status === 'input' && !!liveForm && !liveForm.account && liveForm.total > 0;
// What the card says while the session's tab is on a step with no form to count (extension/page-mark.js, lib/review.js LINE_PAGES), as it happens (owner, 16 Oct 2026:
// "Reading this page" → "Apply button detected. Redirecting…" → "Sign in form detected" → "Logging in…" → the form's own state). [the card's line, the list's short word]
export {PAGE_LINES, pageLine};
// The card shows a step's line (no counts) when the extension marked the session's page and nothing stopped it that needs the person (owner, 15 Oct 2026). The window adds
// its Chrome-tab checks on top (pages/session-needs.js redirecting); the journey tests read this same rule on the app's own data (e2e/lib/journey-watch.mjs).
export const stepShown = (item, state) => !!item && item.outcome !== 'submitted' && !!state?.page && !item.stuck;
export const sessionReview = (item, formReady = false) => {
  // Account fields being filled never prove that the application is ready. Process exit and
  // non-submission are also not completion evidence. Keep positive legacy handoffs only.
  if (item.stage === 'account' || item.stuck || item.accountState === 'confirm') return false;
  if (!['done', 'input'].includes(item.status)) return false;
  if (formReady) return true;
  if (item.kind === 'form' || item.inChrome) return false;
  return REVIEW_WORDS.test(item.question || item.note || '') && !asksYou(item);
};
// formReady: the form page says every required field is filled (the extension's ring is green): ready to submit.
// A session whose application was submitted is finished, whatever its process did: "Submitted", never "Applying".
export const sessionState = (item, formReady = false) => (item?.outcome === 'submitted' && !isLive(item) ? SESSION_STATE.submitted
  : item.kind === 'form' && item.accountState === 'confirm' ? [t('helperState.confirmEmail'), 'info']   // the account is made and awaits its confirmation mail
  : item.kind === 'form' && item.accountState === 'refused' && !item.stuck ? [t('helperState.signInRefused'), 'warn']   // the site refused our sign-in: tried once, never retried
  : item.kind === 'form' && item.stuck === 'stopped' ? [t('helperState.stopped'), 'warn']   // the person's Stop (the sessions page, ⌘K, the extension's own button): nothing runs until Reopen form
  : item.kind === 'form' && item.stuck ? [item.stuck === 'account' ? (item.accountNeeds ? t('helperState.needsYou') : item.accountStep === 'sign_in' ? t('helperState.needsSignIn') : t('helperState.needsAccount')) : item.stuck === 'incomplete' ? t('helperState.needsYou') : item.stuck === 'email' ? t('helperState.needsEmail') : item.stuck === 'told' ? t('helperState.pageSays') : item.stuck === 'other' ? t('helperState.openPage') : item.stuck === 'site_broken' ? t('helperState.siteNotAnswering') : t('helperState.cannotReachForm'), 'warn']
  // Claude at work on a sign-in or sign-up page: it is creating the account, not filling the application (owner, 8 Oct 2026: "Applying").
  : item.kind !== 'form' && item.status === 'running' && item.stage === 'account' ? [t('helperState.creatingAccount'), 'info']
  : (item.kind === 'form' || item.inChrome) && !formReady && item.status === 'done' ? [t('helperState.formOpen'), 'info']   // the Apply button's session: no Claude, the form is open in Chrome
  : sessionReview(item, formReady) ? (formReady ? SESSION_STATE.submit : SESSION_STATE.done)
    // Claude ended without saying the form is ready: what it left for you if it listed something, else just ended (never "ready").
    : item.status === 'done' ? (leftForYou(item) ? [t('helperState.needsYou'), 'warn'] : SESSION_STATE.ended) : SESSION_STATE[item.status] || SESSION_STATE.ended);
// The dock's pills (dockBucket below) and its card order, from the same state the sessions list shows: a form whose Chrome tab was closed (`gone`) is not active, is counted
// as waiting, and sorts last, so an open form is never hidden behind closed ones (2 Oct 2026: the dock said "Form open" for two closed forms and left out the one that was open).
const WORKING = [t('helpers.stageApplying'), t('helperState.formOpen'), t('helperState.readySubmit'), t('helperState.filling'), t('helperState.submittingSoon'), t('helperState.submitting')];   // a queued hidden-browser job ("Queued") only waits: not active
// A hidden-browser job in one of these states is the person's to act on: its label is the amber "Ready for review" / "Needs you", though its session status is not 'input'
// (lib/terminals.js sets 'input' only for an asked question; background-apply-controller.js reports "Form filled…" as done and a hand-over as a plain note).
const BACKGROUND_NEEDS_YOU = new Set(['ready_for_review', 'needs_user_handoff', 'manual_submit_required']);
/**
 * The one dock bucket of a session: 'needs' (the person acts: a question, a form to review, a hand-over), 'waiting' (nothing runs now: a hidden job queued for its turn, a form whose Chrome tab
 * was closed), 'active' (working), or null (finished: submitted, ended, failed).
 * Design (#3377, owner 7 Nov 2026: "Pills add up"): every session still going is in exactly one bucket, so the dock's pills always add up to the sessions it lists; before, a hidden
 * "Ready for review", a hand-over, a queued job and a closed-tab form were in neither pill ("1 active" beside 3 sessions).
 * @param {object} item a session of the list
 * @param {(item: object) => boolean} gone whether the item's Chrome tab was closed
 * @returns {'needs'|'waiting'|'active'|null}
 */
export function dockBucket(item, gone = () => false) {
  if (isSubmitted(item) || item.background?.state === 'receipt_confirmed' || (item.endedAt && !['done', 'input'].includes(item.status))) return null;
  if (gone(item)) return 'waiting';
  if (item.status === 'input' || BACKGROUND_NEEDS_YOU.has(item.background?.state)) return 'needs';
  if (item.background?.state === 'queued') return 'waiting';
  // What is left reads its own label's tone, the one the list shows (a session's state, never a word list): amber is the person's, blue or a working word is in progress, the rest (ended, closed) is in none.
  const [label, tone] = backgroundStatus(item) || sessionState(item);
  return tone === 'warn' ? 'needs' : WORKING.includes(label) || tone === 'info' ? 'active' : null;
}
/**
 * How many sessions are in each dock pill: {active, needs, waiting}, one bucket per session still going (dockBucket); the three add up to the sessions the dock lists.
 * @param {object[]} items the sessions of the list
 * @param {(item: object) => boolean} gone whether an item's Chrome tab was closed (pages/sessions.js closedForm)
 * @returns {{active: number, needs: number, waiting: number}}
 */
export const dockCounts = (items, gone = () => false) => {
  const count = {active: 0, needs: 0, waiting: 0};
  for (const item of items) { const bucket = dockBucket(item, gone); if (bucket) count[bucket]++; }
  return count;
};
// Applying in the menu: the number is every card the Applying list shows, whatever its state (owner, 8 Oct 2026: it said 2
// with 4 cards, counting only the ones that needed you). The colour is the most urgent: amber needs you, blue working,
// green all ready to submit, else grey. `urgency`: 0-1 needs you, 2 working, 3 ready to submit.
/** Which sessions matter first: 0-1 needs you, 2 working, 3 ready to submit, 4 the rest. `ready` is the Chrome form's judged-ready flag. */
export function sessionUrgency(item, ready = false) {
  // Why (2026-10-28, #2392 review): a queued hidden job only waits its turn, so the nav badge does not count it as working; the state decides, never its label.
  if (item.background?.state === 'queued') return 4;
  if (item.status === 'input' && !sessionReview(item, ready)) return 0;
  if (sessionReview(item, ready) && !ready) return 1;
  if (isLive(item) && item.status === 'running') return 2;
  return sessionReview(item, ready) ? 3 : 4;
}
export function applyingBadge(items, urgency) {
  const levels = items.map(urgency);
  const tone = levels.some(level => level <= 1) ? 'warn' : levels.includes(2) ? 'info'
    : items.length && levels.every(level => level === 3) ? 'good' : 'neutral';
  return {count: items.length || '', tone};
}
// The menu foot's line for local sessions (#1676): "session" words only; "Applying" and "Ready to submit" are the Jobs list's server rule (pages/ready-rows.js).
/** What the sessions tray says before any session exists (owner, 5 Nov 2026: "it should show something, even an empty state, but they should be present, so that the user knows about them"). */
export const DOCK_EMPTY = {pill: 'none yet', text: 'No application sessions yet. When you apply to a job, its form shows up here.'};
/** What the tray shows: with no sessions, the 'none yet' pill and the explanation, closed or open by the person's own toggle; null when there are sessions (the tray draws them). Why (Gitar on #3321, 5 Nov 2026): the empty state is decided here, where a test can play it, not inside the DOM code. */
export const dockEmptyView = (sessions, dockOpen) => sessions.length ? null : {pill: DOCK_EMPTY.pill, text: DOCK_EMPTY.text, closed: !dockOpen};
/** Which session the tray's title and "View all" open: the one on screen or the first; null with no sessions (then they open the Sessions page, which has its own empty state). Why (code review of fb 6b/7, 5 Nov 2026): with an empty tray both links did nothing. */
export const dockLinkSession = (sessions, openId) => sessions.length ? (openId || sessions[0].id) : null;
export function sessionsFoot(needs, working, ready, all) {
  const plural = count => `${count} session${count === 1 ? '' : 's'}`;
  const [text, tone] = needs ? [`${plural(needs)} need${needs === 1 ? 's' : ''} you`, 'warn']
    : working ? [`${plural(working)} open`, 'info'] : ready ? [`${plural(ready)} filled`, 'good'] : [plural(all), 'neutral'];
  return {text, tone};
}
const DOCK_ORDER = {input: 0, running: 1, done: 2, failed: 3, ended: 4};
export const dockOrder = (item, gone = () => false) => gone(item) ? 9 : (DOCK_ORDER[item.status] ?? 5);
// Did the form page's panel answer the app (what "Open filled form" returns)? Only when it didn't is the "Reload the
// tab" repair offered: reloading a form page loses what was typed in it since the last save, so it must not be a
// button to press by habit next to Open filled form (1 Oct 2026).
export const panelAnswered = result => !!result?.taken;
// How long it worked (until it ended or waited for you), "42s", "3m 05s", "1h 02m".
export function sessionDuration(item, now = Date.now()) {
  const end = item.endedAt || item.needsYouSince;
  const seconds = Math.max(0, Math.round(((end ? new Date(end) : new Date(now)) - new Date(item.startedAt)) / 1000));
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)}h ${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}m`;
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s` : `${seconds}s`;
}
// The Sessions page's clock: every node made by ticking() (session-log, next step) shows prefix + how long since. Only those nodes: the Ready card's bars
// carry their own data-ready-since (owner, 19 Oct 2026: this clock once rewrote them as "undefinedNaNs"). Guard: test/unit/renderer/ready-card-no-garbage.test.js.
export function tickSessionClocks(root, now = Date.now()) {
  for (const node of root.querySelectorAll('[data-since][data-prefix]')) node.textContent = node.dataset.prefix + sessionDuration({startedAt: node.dataset.since}, now);
}
// The part of a text shown on its row: all of it when short, else whole sentences up to the limit (at least one).
export function firstLine(text, limit = 110) {
  if (text.length <= limit) return text;
  let shown = '';
  for (const sentence of text.split(/(?<=\.)\s+/)) {
    if (shown && shown.length + sentence.length + 1 > limit) break;
    shown = shown ? `${shown} ${sentence}` : sentence;
  }
  return shown;
}

// Which step of the application the session is at, said plainly (owner, 8 Oct 2026: show whether we are creating the employer
// account or filling the job's own form). Step numbers only when there was an account step; nothing once it is submitted.
export function sessionStage(item, ready = false) {
  if (!item || item.outcome === 'submitted') return null;
  const site = item.accountHost ? ` on ${item.accountHost.replace(/^www\./, '')}` : '';
  if (item.accountState === 'refused') return {step: 1, text: `Step 1 of 2 · Sign-in refused${site}: tried once, not retried`, tone: 'warn'};   // before the account step's own line: that one says "Sign in" as if all were well
  if (item.stage === 'account' || item.stuck === 'account') return {step: 1, text: `Step 1 of 2 · ${item.accountStep === 'sign_in' ? 'Sign in' : 'Creating your account'}${site}`, tone: 'info'};
  if (item.accountState === 'confirm') return {step: 1, text: `Step 1 of 2 · Confirm your email${site}`, tone: 'info'};
  // ready: the session is at Review (the form says every field is filled): never "Filling" beside "Ready to submit" (#1433).
  const doing = ready ? 'Application form filled' : 'Filling the application form';
  if (item.stage === 'form') return {step: 2, text: item.accountHost || item.accountState ? `Step 2 of 2 · ${item.accountState === 'created' ? 'Account created · ' : ''}${doing}` : doing, tone: 'info'};
  return null;
}

// The session's form tab is gone: the extension reports in (`formsOpen.known`) and no open tab is this session's. A form it saw
// before (`seen`: fields were reported) is closed; so is a form session's (Apply opened it; a minute for it to show up) and the
// tab of a Claude session that is no longer running (a running one may not have opened its tab yet). Owner, 8 Oct 2026: after
// closing every tab, a Claude session stuck on a sign-up page still showed its question as if the tab were there.
export function tabClosed(item, formsOpen, seen = false, now = Date.now()) {
  if (!item || item.background || !formsOpen?.known || formsOpen.ids.includes(item.id) || isSubmitted(item) || item.outcome) return false;   // a hidden-browser session has no Chrome tab to lose (renderer/background-status.js)
  if (formsOpen.unsure?.includes(item.id)) return false;   // no tab known for it and none that looks like it: not known, never "closed"
  if (seen) return true;
  if (item.kind === 'form') return now - (Date.parse(item.startedAt || '') || now) > 60 * 1000;
  return (item.kind || 'claude') === 'claude' && !isLive(item);
}

// The first look at Chrome after the app starts (or ⌘R): until the extension reports in, or CHECK_MS pass, nobody knows whether
// a session's tab is still there, so its card shows that it is checking instead of the last state it had (owner, 8 Oct 2026:
// for 2 s the old question and "Can't reach form" showed, then "The form tab was closed" replaced them).
// At least one report of the extension's (extension/report-alarm.js: every 30 s, Chrome's shortest alarm) plus a margin: at 15 s every card said "Chrome isn't
// reporting" for up to 15 s after each app start while Chrome was fine (twin, 9 Oct 2026). Guard: test/unit/renderer/session-state.test.js.
export const CHECK_MS = 45 * 1000;
const waitsOnTab = item => !!item && !isSubmitted(item) && !item.outcome && (item.kind === 'form' || ((item.kind || 'claude') === 'claude' && !isLive(item)));
// Chrome is heard and nothing says this session's tab is open or closed (the app restarted: the binding is gone, no tab matches by look).
const unsureTab = (item, formsOpen) => !!formsOpen?.known && !!formsOpen.unsure?.includes(item.id) && !formsOpen.ids.includes(item.id);
// The first look is over for this session: CHECK_MS since the window started AND since the session did (a session opened later needs its own first look while its tab binds).
const lookOver = (item, sinceStart, now) => sinceStart > CHECK_MS && !(now - Date.parse(item.startedAt || '') <= CHECK_MS);
export function checkingTabs(item, formsOpen, sinceStart, now = Date.now()) {
  if (!waitsOnTab(item) || formsOpen?.linkOff) return false;   // the app's own connection is off: nothing is being checked (see chromeSilent)
  // Heard from Chrome, yet nothing says this tab is open or closed: never "Form open" (owner, 12 Oct 2026); it checks for CHECK_MS, then tabNotFound says so.
  if (formsOpen?.known) return unsureTab(item, formsOpen) && !lookOver(item, sinceStart, now);
  return sinceStart <= CHECK_MS;
}

// After the first look the tab is still unknown (owner, 14 Oct 2026: older sessions said "Checking…" for ever after a restart): the card says "Tab not found" and offers
// to open the form again. It claims neither open nor closed (12 Oct: never "Form open" unproven; 8 Oct: never "closed" for a form open on another address); when a tab
// shows up (its address, the extension's report) the session is in `ids` and this is false again.
export function tabNotFound(item, formsOpen, sinceStart, now = Date.now()) {
  return waitsOnTab(item) && unsureTab(item, formsOpen) && lookOver(item, sinceStart, now);
}

// The session's Chrome tab as the card shows it: host and path (no query, no www), cut in the middle of the path when long;
// the full address is its tooltip. '' when no tab has reported for the session.
export function tabAddress(url, limit = 70) {
  let parsed;
  try { parsed = new URL(url); } catch { return ''; }
  const text = (parsed.hostname.replace(/^www\./, '') + decodeURIComponent(parsed.pathname)).replace(/\/$/, '');
  return text.length <= limit ? text : `${text.slice(0, limit - 21)}…${text.slice(-20)}`;
}

// After the first look (CHECK_MS) the extension still hasn't reported which tabs are open (Chrome is closed, or its Jobadabra
// extension isn't running): a session waiting on its tab can't be seen, so its card says so instead of its last state (owner, 8 Oct 2026).
// For the first WAIT_MS after the app starts or restarts, Chrome is still starting: a neutral "Waiting for Chrome…", the warning only after (owner, 15 Oct 2026).
export const WAIT_MS = 60 * 1000;
const silentCase = (item, formsOpen) => !!item && !formsOpen?.known && !isSubmitted(item) && !item.outcome && (item.kind === 'form' || ((item.kind || 'claude') === 'claude' && !isLive(item)));
// Why (29 Oct 2026, owner): `formsOpen.linkOff` is the app saying its own socket for the extension is not open (a leaked test app held the port). No report can come, so the
// 45 s "Checking…" and the 60 s "Waiting" are guesses about nothing: the warning shows at once, and says it is the connection, not Chrome.
export const chromeSilent = (item, formsOpen, sinceStart) => silentCase(item, formsOpen) && (sinceStart > WAIT_MS || !!formsOpen?.linkOff);
/** -> whether the card says the neutral "Waiting for Chrome…": no report yet, past the first look, before the warning; never when the app's own connection is off (see chromeSilent). Reads only its arguments. */
export const chromeWaiting = (item, formsOpen, sinceStart) => silentCase(item, formsOpen) && !formsOpen?.linkOff && sinceStart > CHECK_MS && sinceStart <= WAIT_MS;
/**
 * The phase of a session's card that the clock alone can change: 'silent' ("Chrome isn't reporting"), 'waiting' ("Waiting for Chrome…"), 'checking' (the first look),
 * 'lost' ("Tab not found"), or '' when none applies. Reads only its arguments.
 */
export function tabPhase(item, formsOpen, sinceStart, now = Date.now()) {
  if (chromeSilent(item, formsOpen, sinceStart)) return 'silent';
  if (chromeWaiting(item, formsOpen, sinceStart)) return 'waiting';
  if (checkingTabs(item, formsOpen, sinceStart, now)) return 'checking';
  return tabNotFound(item, formsOpen, sinceStart, now) ? 'lost' : '';
}
/**
 * Every session's tabPhase as one string: it changes exactly when some card's time-based phase does, so the window redraws then (pages/activity.js).
 * Why (30 Oct 2026, beta 41078746088): one timer at CHECK_MS redrew the cards once, so "Waiting for Chrome…" stayed up past WAIT_MS until something else redrew them.
 */
export const tabPhases = (items, formsOpen, sinceStart, now = Date.now()) => (items || []).map(item => `${item.id}:${tabPhase(item, formsOpen, sinceStart, now)}`).join(' ');
/** The pill of a card whose tab can't be seen: the connection, or Chrome. */
export const silentPill = formsOpen => (formsOpen?.linkOff ? t('helperState.connectionOff') : 'Chrome not reporting');
/** The one sentence for a closed connection (`formsOpen.linkOff`: {port, code}), on every card it stops: Chrome's, and a queued hidden-browser job's (`who`: whose extension reports).
 * Why (#2508, Gitar): another program is only the cause for EADDRINUSE, which the app retries; any other code (EACCES) is not retried, so no "updates by itself". */
export const linkOffLine = (off, who = t('helperState.extensionWho')) => (off.code === 'EADDRINUSE' ? t('helperState.linkInUse', {who, port: off.port})
  : t('helperState.linkCannotOpen', {who, port: off.port, code: off.code}));

/** The state a row shows while Cancel all applications is closing it ([label, tone]), or null: it comes before the row's own state, so a queued or filling application does not look untouched. */
export const cancellingState = item => (item?.cancelling ? ['Cancelling…', 'neutral'] : null);

/** The header button of Cancel all applications: hidden with nothing to cancel; while some are being closed it says how many and is off (owner, 7 Nov 2026: a greyed button and the old list showed nothing). */
export function cancelAllButton(list) {
  const closing = list.filter(item => item.cancelling).length;
  const text = closing ? `Cancelling ${closing} application${closing === 1 ? '' : 's'}…` : 'Cancel all applications';
  return {hidden: !cancellable(list).length, textContent: text, closing};
}
/** -> whether this application is being sent right now: Full automation pressed Submit and waits for the site's reply (lib/background-apply-store.js `submitting`). */
export const beingSent = item => item?.background?.state === 'submitting';
/**
 * -> the sessions "Cancel all applications" ends: every one not finished yet (filling, queued, waiting on the person, ready to submit); a submitted or already ended one keeps its outcome.
 * The window's button and the app's handler (lib/session-handlers.js sessionsCancelAll) read this same rule.
 * Why (5 Nov 2026, review of [ap] 3/7): one being sent is left out: cancelling it closed the tab that reads the site's reply and set the job back to Kit ready while the
 * employer may have the application; its reply, or the person, settles it.
 */
export const cancellable = items => (items || []).filter(item => !!item && item.kind !== 'read' && !item.outcome && !beingSent(item));   // a Read with Claude is not an application (pages/sessions.js stillOpen)

/**
 * -> whether the header Stop is drawn: only while its ⌘K entry pinned it visible, until `pinnedUntil` (ms). The one rule for the page's render and the entry's timer (#2512).
 * Why (5 Nov 2026, owner: "we should remove the "Stop extension" button. And we should add another button isntead … "Cancel all applications""): the header's
 * place is Cancel all's; Stop stays reachable from ⌘K, the ⋯ menu and the extension's own popup and page button.
 */
export const stopShown = (pinnedUntil = 0, now = Date.now()) => now < pinnedUntil;

// What the card says on a sign-in or sign-up page (owner, 9 Oct 2026: the account step gets its own count, what is left for you and the next press, apart from the application's
// progress). state: the form page's review state ({account, total, left, needs, pending, missing}); null when this is not an account page with fields.
export function accountCardOf(item, state) {
  if (!state?.account || !(state.total > 0)) return null;
  const need = state.needs === '1' ? t('helperState.seePageAsks') : String(state.needs || '').trim();   // the AI's word for the one thing only you can do, e.g. 'Solve the check, then press "Créer un compte"'
  const done = Math.max(0, state.total - state.left);
  const left = [...(need ? [need] : []), ...(state.pending || state.missing || [])];
  return {title: item.accountStep === 'sign_in' ? t('helperState.signInPage') : t('helperState.accountPage'), done, total: state.total, count: t('helperState.countFieldsFilled', {total: state.total}), left,
    pill: need ? {text: t('helperState.needsYouText', {need}), tone: 'warn'} : state.left ? {text: t('helperState.remainingCount', {count: state.left}), tone: 'warn'} : {text: t('helperState.allFilled'), tone: 'good'}};
}
// The short line after the title of an account stop: how far the page is, or nothing was reported yet.
export const accountProgress = state => (state?.account && state.total > 0 ? t('helperState.accountProgress', {done: Math.max(0, state.total - state.left), total: state.total}) : t('helperState.nothingFilled'));

// The account record on a session's card (owner, 10 Oct 2026): where an account was made, which terms the extension accepted (the page's own wording) and whether a code came from the
// mail. '' for an application with no account made by us (an existing account, a refused sign-in). Guarded by test/unit/renderer/account-record.test.js.
export function accountRecordLine(item) {
  if (!item || !item.accountHost || !['created', 'confirm'].includes(item.accountState)) return '';
  const terms = Array.isArray(item.accountTerms) ? item.accountTerms : [];
  return [t('helperState.accountCreatedOn', {host: item.accountHost.replace(/^www\./, '')}), ...(terms.length ? [t('helperState.termsAccepted', {terms: terms.map(term => `\u2018${term}\u2019`).join(', ')})] : []), ...(item.accountCode ? [t('helperState.codeEmail')] : [])].join(' \u00b7 ');
}

// The card's words for a session as the app itself reports it (no Chrome-tab checks): the step's line, else the session's state. [words, tone]
export const cardWords = (item, state) => (stepShown(item, state) ? [pageLine(state.page), 'neutral'] : sessionState(item, !!state?.ready));
